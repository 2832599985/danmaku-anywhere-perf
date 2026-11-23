//! Hidden-WebView network bridge for Bilibili / Tencent.
//!
//! Their APIs reject requests made by the Tauri `http` plugin (reqwest):
//! Bilibili answers 412 `request was banned`, Tencent returns `ret:20607`.
//! What they accept is a request made by a real browser page on their own
//! origin. This module keeps one hidden WebView2 page per source, parked on
//! that origin's `robots.txt` (no site JS, minimal memory), and runs the fetch
//! through DevTools `Runtime.evaluate` with `awaitPromise: true`. The page
//! supplies Chromium's network stack, the correct `Origin`/`Referer`, and the
//! cookie jar; the app keeps all parsing/matching logic in TypeScript.
//!
//! CDP is used instead of WebMessage because the page→host WebMessage channel
//! never delivered events on remote `robots.txt` documents (host→page did),
//! while `Runtime.evaluate` is the same path the browser's own devtools use.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::json;
use tauri::{AppHandle, Manager, State};

const READY_TIMEOUT: Duration = Duration::from_secs(20);
const FETCH_TIMEOUT: Duration = Duration::from_secs(45);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Source {
    Bilibili,
    Tencent,
}

impl Source {
    fn key(self) -> &'static str {
        match self {
            Source::Bilibili => "bilibili",
            Source::Tencent => "tencent",
        }
    }

    fn window_label(self) -> &'static str {
        match self {
            Source::Bilibili => "bilibili-source",
            Source::Tencent => "tencent-source",
        }
    }

    fn origin_page(self) -> &'static str {
        match self {
            Source::Bilibili => "https://www.bilibili.com/robots.txt",
            Source::Tencent => "https://v.qq.com/robots.txt",
        }
    }

    fn host(self) -> &'static str {
        match self {
            Source::Bilibili => "www.bilibili.com",
            Source::Tencent => "v.qq.com",
        }
    }

    fn referer(self) -> &'static str {
        match self {
            Source::Bilibili => "https://www.bilibili.com/",
            Source::Tencent => "https://v.qq.com/",
        }
    }
}

#[derive(Serialize)]
pub struct SourceFetchResponse {
    status: u16,
    text: String,
    error: Option<String>,
}

#[derive(Deserialize)]
struct PagePayload {
    status: Option<u16>,
    text: Option<String>,
    error: Option<String>,
}

/// Shared bridge state. `ready` flips when the hidden page has finished
/// loading; no page script is involved.
pub struct SourceBridge {
    ready: Mutex<HashMap<&'static str, bool>>,
}

impl SourceBridge {
    pub fn new() -> Self {
        Self {
            ready: Mutex::new(HashMap::new()),
        }
    }

    fn is_ready(&self, source: Source) -> bool {
        *self
            .ready
            .lock()
            .unwrap()
            .get(source.key())
            .unwrap_or(&false)
    }

    fn set_ready(&self, source: Source, value: bool) {
        self.ready.lock().unwrap().insert(source.key(), value);
    }
}

/// Only the endpoints the TS providers call are forwarded. Anything else is a
/// bug or a compromised renderer; refuse it.
fn source_for_url(url: &str) -> Option<Source> {
    let parsed = url::Url::parse(url).ok()?;
    let host = parsed.host_str()?;
    let path = parsed.path();
    match host {
        "api.bilibili.com"
            if path.starts_with("/x/web-interface/search/type")
                || path.starts_with("/pgc/view/web/season")
                || path.starts_with("/x/v1/dm/list.so")
                || path.starts_with("/x/frontend/finger/spi") =>
        {
            Some(Source::Bilibili)
        }
        "pbaccess.video.qq.com"
            if path.starts_with("/trpc.videosearch.mobile_search.MultiTerminalSearch/MbSearch")
                || path.starts_with(
                    "/trpc.universal_backend_service.page_server_rpc.PageServer/GetPageData",
                ) =>
        {
            Some(Source::Tencent)
        }
        "dm.video.qq.com" if path.starts_with("/barrage/") => Some(Source::Tencent),
        _ => None,
    }
}

#[tauri::command]
pub async fn source_fetch(
    app: AppHandle,
    state: State<'_, Arc<SourceBridge>>,
    url: String,
    method: Option<String>,
    headers: Option<Vec<(String, String)>>,
    body: Option<String>,
) -> Result<SourceFetchResponse, String> {
    let bridge = state.inner().clone();
    let source = source_for_url(&url).ok_or_else(|| format!("source URL not allowed: {url}"))?;

    #[cfg(windows)]
    {
        imp::source_fetch(app, bridge, source, url, method, headers, body).await
    }
    #[cfg(not(windows))]
    {
        let _ = (app, bridge, source, url, method, headers, body);
        Err("the source bridge is Windows-only".into())
    }
}

#[tauri::command]
pub fn source_login(app: AppHandle, provider: String) -> Result<(), String> {
    #[cfg(windows)]
    {
        imp::source_login(app, provider)
    }
    #[cfg(not(windows))]
    {
        let _ = (app, provider);
        Err("the source bridge is Windows-only".into())
    }
}

#[cfg(windows)]
mod imp {
    use super::*;
    use tauri::webview::PageLoadEvent;
    use tauri::{WebviewUrl, WebviewWindow, WebviewWindowBuilder};

    pub async fn source_fetch(
        app: AppHandle,
        bridge: Arc<SourceBridge>,
        source: Source,
        url: String,
        method: Option<String>,
        headers: Option<Vec<(String, String)>>,
        body: Option<String>,
    ) -> Result<SourceFetchResponse, String> {
        let window = ensure_window(&app, &bridge, source).map_err(|e| e.to_string())?;
        wait_ready(&bridge, source).await?;

        let expression = build_expression(source, &url, method, headers, body)?;
        let params = json!({
          "expression": expression,
          "awaitPromise": true,
          "returnByValue": true,
          "userGesture": false,
        })
        .to_string();

        let (tx, rx) = tokio::sync::oneshot::channel::<String>();
        let slot = Arc::new(Mutex::new(Some(tx)));
        let slot_outer = slot.clone();
        window
            .with_webview(move |webview| unsafe {
                use webview2_com::CallDevToolsProtocolMethodCompletedHandler;
                use windows::core::HSTRING;

                let core = match webview.controller().CoreWebView2() {
                    Ok(core) => core,
                    Err(error) => {
                        if let Some(tx) = slot_outer.lock().unwrap().take() {
                            let _ = tx.send(format!("error: {error:?}"));
                        }
                        return;
                    }
                };
                let slot_for_handler = slot_outer.clone();
                let handler = CallDevToolsProtocolMethodCompletedHandler::create(Box::new(
                    move |_hr, result| {
                        if let Some(tx) = slot_for_handler.lock().unwrap().take() {
                            let _ = tx.send(result.to_string());
                        }
                        Ok(())
                    },
                ));
                if let Err(error) = core.CallDevToolsProtocolMethod(
                    &HSTRING::from("Runtime.evaluate"),
                    &HSTRING::from(params.as_str()),
                    &handler,
                ) {
                    if let Some(tx) = slot_outer.lock().unwrap().take() {
                        let _ = tx.send(format!("error: {error:?}"));
                    }
                }
            })
            .map_err(|e| e.to_string())?;

        let raw = match tokio::time::timeout(FETCH_TIMEOUT, rx).await {
            Ok(Ok(raw)) => raw,
            Ok(Err(_)) => return Err("source bridge closed".into()),
            Err(_) => return Err("source bridge timed out".into()),
        };
        parse_cdp_result(&raw)
    }

    fn parse_cdp_result(raw: &str) -> Result<SourceFetchResponse, String> {
        if let Some(message) = raw.strip_prefix("error: ") {
            return Err(message.to_string());
        }
        let root: serde_json::Value =
            serde_json::from_str(raw).map_err(|e| format!("bad CDP result: {e}"))?;
        if let Some(exception) = root
            .pointer("/result/exceptionDetails")
            .or_else(|| root.get("exceptionDetails"))
        {
            return Err(format!("page exception: {exception}"));
        }
        // `CallDevToolsProtocolMethod` hands back the method's result object, not
        // the full `{id, result}` CDP envelope: Runtime.evaluate returns
        // `{ "result": { "type": "string", "value": "..." } }`.
        let value = root
            .pointer("/result/value")
            .and_then(serde_json::Value::as_str)
            .ok_or_else(|| format!("CDP result had no string value: {raw}"))?;
        let payload: PagePayload =
            serde_json::from_str(value).map_err(|e| format!("bad page payload: {e}"))?;
        if let Some(error) = payload.error {
            Ok(SourceFetchResponse {
                status: 500,
                text: error.clone(),
                error: Some(error),
            })
        } else {
            Ok(SourceFetchResponse {
                status: payload.status.unwrap_or(200),
                text: payload.text.unwrap_or_default(),
                error: None,
            })
        }
    }

    async fn wait_ready(bridge: &Arc<SourceBridge>, source: Source) -> Result<(), String> {
        let started = std::time::Instant::now();
        while started.elapsed() < READY_TIMEOUT {
            if bridge.is_ready(source) {
                return Ok(());
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
        Err("source page did not load".into())
    }

    fn build_expression(
        source: Source,
        url: &str,
        method: Option<String>,
        headers: Option<Vec<(String, String)>>,
        body: Option<String>,
    ) -> Result<String, String> {
        // The page sets Origin/Referer/Cookie itself; forwarding them from the
        // app's own fetch would be ignored (forbidden headers) and is unnecessary.
        let headers: Vec<(String, String)> = headers
            .unwrap_or_default()
            .into_iter()
            .filter(|(name, _)| {
                !matches!(
                    name.to_ascii_lowercase().as_str(),
                    "cookie" | "origin" | "referer" | "user-agent" | "host" | "content-length"
                )
            })
            .collect();

        let mut init = serde_json::Map::new();
        init.insert(
            "method".into(),
            json!(method.unwrap_or_else(|| "GET".into())),
        );
        if !headers.is_empty() {
            init.insert("headers".into(), json!(headers));
        }
        if let Some(body) = body {
            init.insert("body".into(), json!(body));
        }
        init.insert(
            "credentials".into(),
            json!(if url.starts_with("https://dm.video.qq.com/") {
                "omit"
            } else {
                "include"
            }),
        );
        init.insert("referrer".into(), json!(source.referer()));

        let url_json = serde_json::to_string(url).map_err(|e| e.to_string())?;
        let init_json = serde_json::Value::Object(init).to_string();
        Ok(format!(
            r#"(async () => {{
  try {{
    if (location.hostname === 'www.bilibili.com' && !window.__DA_BILI_READY) {{
      try {{
        const spi = await fetch('https://api.bilibili.com/x/frontend/finger/spi', {{ credentials: 'include' }}).then(r => r.json());
        if (spi && spi.data && spi.data.b_3) {{
          document.cookie = 'buvid3=' + spi.data.b_3 + '; domain=.bilibili.com; path=/; secure; samesite=none';
          document.cookie = 'buvid4=' + spi.data.b_4 + '; domain=.bilibili.com; path=/; secure; samesite=none';
        }}
      }} catch (_) {{}}
      window.__DA_BILI_READY = true;
    }}
    const res = await fetch({url_json}, {init_json});
    if (res.status === 412) window.__DA_BILI_READY = false;
    const text = await res.text();
    return JSON.stringify({{ status: res.status, text: text }});
  }} catch (e) {{
    return JSON.stringify({{ error: String(e) }});
  }}
}})()"#
        ))
    }

    pub fn ensure_window(
        app: &AppHandle,
        bridge: &Arc<SourceBridge>,
        source: Source,
    ) -> tauri::Result<WebviewWindow> {
        if let Some(window) = app.get_webview_window(source.window_label()) {
            return Ok(window);
        }
        bridge.set_ready(source, false);

        let url = url::Url::parse(source.origin_page()).map_err(tauri::Error::InvalidUrl)?;
        let host = source.host().to_string();
        let bridge_for_page = bridge.clone();
        let window =
            WebviewWindowBuilder::new(app, source.window_label(), WebviewUrl::External(url))
                .title("danmaku-source")
                .visible(false)
                .skip_taskbar(true)
                .decorations(false)
                .focused(false)
                .on_navigation(move |url| url.host_str() == Some(host.as_str()))
                .on_page_load(move |_window, payload| {
                    if payload.event() == PageLoadEvent::Finished {
                        bridge_for_page.set_ready(source, true);
                    }
                })
                .build()?;

        Ok(window)
    }

    pub fn source_login(app: AppHandle, provider: String) -> Result<(), String> {
        let (label, url, title) = match provider.as_str() {
            "bilibili" => (
                "bilibili-login",
                "https://www.bilibili.com/",
                "登录哔哩哔哩",
            ),
            "tencent" => ("tencent-login", "https://v.qq.com/", "登录腾讯视频"),
            _ => return Err(format!("unknown source: {provider}")),
        };
        if let Some(window) = app.get_webview_window(label) {
            let _ = window.show();
            let _ = window.set_focus();
            return Ok(());
        }
        let url = url::Url::parse(url).map_err(|e| e.to_string())?;
        WebviewWindowBuilder::new(&app, label, WebviewUrl::External(url))
            .title(title)
            .inner_size(1100.0, 780.0)
            .build()
            .map(|_| ())
            .map_err(|e| e.to_string())
    }
}

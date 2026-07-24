mod stream;

/// Builds and runs the Tauri desktop application.
///
/// - Registers the dialog / fs / http plugins used by the frontend platform
///   adapter.
/// - Registers the custom, range-capable, CORS-clean `stream://` URI scheme so
///   the webview can read local video files without tainting the WebGPU
///   texture source.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_http::init())
        // Async variant so large-file range reads happen off the UI thread.
        .register_asynchronous_uri_scheme_protocol("stream", |_ctx, request, responder| {
            stream::handle(request, responder);
        })
        .run(tauri::generate_context!())
        .expect("error while running the Danmaku Player application");
}

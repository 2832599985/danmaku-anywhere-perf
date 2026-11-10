mod remux;
mod source_bridge;
mod stream;
mod thumbs;
pub mod subtitle;

use subtitle::commands::{
    subtitle_cancel, subtitle_log, subtitle_model_download, subtitle_model_status,
    subtitle_save_srt, subtitle_transcribe, TaskRegistry,
};
use subtitle::tracks::{subtitle_extract_focus, subtitle_extract_track, subtitle_list_tracks};

/// Builds and runs the Tauri desktop application.
///
/// - Registers the dialog / fs / http plugins used by the frontend platform
///   adapter.
/// - Registers the custom, range-capable, CORS-clean `stream://` URI scheme so
///   the webview can read local video files without tainting the WebGPU
///   texture source.
/// - Manages the subtitle TaskRegistry (single-flight transcription tasks) and
///   the subtitle command surface, plus the subtitle diagnostic log
///   (app_log_dir/subtitle.log — the trace for "no subtitles appeared").
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_http::init())
        .manage(TaskRegistry::default())
        .manage(std::sync::Arc::new(source_bridge::SourceBridge::new()))
        .setup(|app| {
            subtitle::logging::init(app.handle());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            subtitle_transcribe,
            subtitle_cancel,
            subtitle_model_status,
            subtitle_model_download,
            subtitle_save_srt,
            subtitle_log,
            subtitle_list_tracks,
            subtitle_extract_track,
            subtitle_extract_focus,
            remux::media_prepare,
            source_bridge::source_fetch,
            source_bridge::source_login,
            thumbs::thumb_save,
            thumbs::thumb_load,
            thumbs::thumb_delete,
        ])
        // The hidden Bilibili/Tencent bridge windows (source_bridge) are still
        // open when the player window closes, and Tauri only exits once every
        // window is gone — so each close left a background process behind.
        // The player window going away ends the app. `Destroyed` comes after
        // the page's pagehide, so the resume point/frame are already saved.
        .on_window_event(|window, event| {
            if window.label() == "main" && matches!(event, tauri::WindowEvent::Destroyed) {
                tauri::Manager::app_handle(window).exit(0);
            }
        })
        // Async variant so large-file range reads happen off the UI thread.
        .register_asynchronous_uri_scheme_protocol("stream", |_ctx, request, responder| {
            stream::handle(request, responder);
        })
        .run(tauri::generate_context!())
        .expect("error while running the Danmaku Player application");
}

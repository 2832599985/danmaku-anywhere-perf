//! Tauri command surface for the AI subtitle pipeline (CONTRACT §34).
//!
//! Rust provides the primitives; the SCHEDULE (auto-pause burst on the GPU,
//! CPU follow during playback, which lines to translate first) lives in the
//! frontend state machine `src/subtitle/generate.ts`:
//!
//! - `subtitle_transcribe` — recognize `[from, to)`, streaming each clip's
//!   cues through a Channel. Single-flight; `subtitle_cancel` stops it.
//! - `subtitle_translate` — one batch (≤ 8 lines) ja → zh.
//! - `subtitle_release` — kill engines (GPU ones only, or all) = give VRAM
//!   back. `subtitle_gpu_info` — free VRAM + what is running where.
//! - assets / data dir / per-video cache / srt export / diagnostics.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use serde::Serialize;
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager};

use super::assets::{self, AssetStatus, DownloadEvent};
use super::audio;
use super::logging;
use super::sidecar::{self, Engine, Engines};
use super::speech;
use super::storage;
use super::translator;
use super::whisper;

/// One timed subtitle line (the frontend `SubtitleCue` core shape).
#[derive(Clone, Debug, Serialize, PartialEq)]
pub struct Cue {
    /// seconds from video start
    pub start: f64,
    /// seconds from video start
    pub end: f64,
    pub text: String,
}

/// Events streamed by `subtitle_transcribe`.
#[derive(Clone, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum TranscribeEvent {
    /// the engine is up; `gpu` = what actually serves (a GPU start may have
    /// fallen back to the CPU)
    Started { gpu: bool },
    /// one clip finished: its cues + how far recognition now reaches
    #[serde(rename_all = "camelCase")]
    Clip { cues: Vec<Cue>, covered_to: f64 },
    #[serde(rename_all = "camelCase")]
    Done { covered_to: f64, language: Option<String> },
    Cancelled,
    Failed { message: String },
}

/// Single-flight registry for recognition tasks; carries the cancel flag.
#[derive(Default)]
pub struct TaskRegistry {
    current: Mutex<Option<Arc<AtomicBool>>>,
}

impl TaskRegistry {
    fn try_begin(&self) -> Result<Arc<AtomicBool>, String> {
        let mut guard = self.current.lock().unwrap_or_else(|p| p.into_inner());
        if guard.is_some() {
            return Err("已有识别任务正在进行".to_string());
        }
        let flag = Arc::new(AtomicBool::new(false));
        *guard = Some(Arc::clone(&flag));
        Ok(flag)
    }

    fn end(&self) {
        *self.current.lock().unwrap_or_else(|p| p.into_inner()) = None;
    }

    fn request_cancel(&self) -> bool {
        match self.current.lock().unwrap_or_else(|p| p.into_inner()).as_ref() {
            Some(flag) => {
                flag.store(true, Ordering::Relaxed);
                true
            }
            None => false,
        }
    }
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn subtitle_transcribe(
    app: AppHandle,
    path: String,
    from: f64,
    to: f64,
    gpu: bool,
    first_clip: Option<f64>,
    language: Option<String>,
    on_event: Channel<TranscribeEvent>,
) -> Result<(), String> {
    if path.trim().is_empty() {
        return Err("视频路径为空".to_string());
    }
    if !(from.is_finite() && to.is_finite()) || to <= from {
        return Err(format!("识别区间无效: [{from}, {to})"));
    }
    let cancel = app.state::<TaskRegistry>().try_begin()?;
    let language = language.filter(|l| !l.trim().is_empty()).unwrap_or_else(|| "ja".to_string());
    let first_clip = first_clip.unwrap_or(whisper::CLIP_SECS);
    logging::write(&format!(
        "transcribe: [{from:.1}, {to:.1}) gpu={gpu} first={first_clip} lang={language} path={path}"
    ));
    std::thread::spawn(move || {
        let started = std::time::Instant::now();
        let result = (|| {
            let lease = app.state::<Engines>().ensure(&app, Engine::Asr, gpu)?;
            let _ = on_event.send(TranscribeEvent::Started { gpu: lease.gpu });
            let mut language_seen: Option<String> = None;
            // VAD always runs from the CPU runtime (0.5 s per 5 min of audio).
            let detector = assets::path_of(&app, &assets::WHISPER_CPU)
                .ok()
                .and_then(|exe| exe.parent().map(std::path::Path::to_path_buf))
                .zip(assets::vad_model_path(&app).ok())
                .and_then(|(dir, model)| speech::Detector::new(&dir, model));
            if detector.is_none() {
                logging::write("vad: detector unavailable, keeping whisper timing");
            }
            let covered = whisper::transcribe_range(
                &lease.base,
                &path,
                from,
                to,
                first_clip,
                &language,
                detector.as_ref(),
                &cancel,
                |clip| {
                    if language_seen.is_none() {
                        language_seen = clip.language.clone();
                    }
                    let _ = on_event.send(TranscribeEvent::Clip {
                        cues: clip.cues,
                        covered_to: clip.covered_to,
                    });
                },
            )?;
            Ok::<_, String>((covered, language_seen))
        })();
        app.state::<TaskRegistry>().end();
        let event = match result {
            Ok((covered_to, language)) => {
                logging::write(&format!(
                    "transcribe done: to={covered_to:.1} in {:.1}s",
                    started.elapsed().as_secs_f64()
                ));
                TranscribeEvent::Done { covered_to, language }
            }
            Err(message) if message == audio::CANCELLED => {
                logging::write("transcribe cancelled");
                TranscribeEvent::Cancelled
            }
            Err(message) => {
                logging::write(&format!("transcribe failed: {message}"));
                // A server that failed mid-request may be wedged.
                app.state::<Engines>().stop(Engine::Asr);
                TranscribeEvent::Failed { message }
            }
        };
        let _ = on_event.send(event);
    });
    Ok(())
}

/// Stop the running recognition task. The recognition server is killed too:
/// an in-flight request ends at once, and a GPU instance frees its VRAM.
#[tauri::command]
pub fn subtitle_cancel(app: AppHandle) -> Result<(), String> {
    if app.state::<TaskRegistry>().request_cancel() {
        app.state::<Engines>().stop(Engine::Asr);
    }
    Ok(())
}

#[derive(Serialize)]
pub struct TranslateResult {
    /// one per input line; null = keep the Japanese
    lines: Vec<Option<String>>,
    gpu: bool,
}

#[tauri::command]
pub async fn subtitle_translate(
    app: AppHandle,
    lines: Vec<String>,
    gpu: bool,
) -> Result<TranslateResult, String> {
    if lines.len() > translator::BATCH {
        return Err(format!("一次最多翻译 {} 句", translator::BATCH));
    }
    tauri::async_runtime::spawn_blocking(move || {
        let engines = app.state::<Engines>();
        let lease = engines.ensure(&app, Engine::Mt, gpu)?;
        match translator::translate_batch(&lease.base, &lines) {
            Ok(lines) => Ok(TranslateResult { lines, gpu: lease.gpu }),
            Err(message) => {
                logging::write(&format!("translate failed: {message}"));
                engines.stop(Engine::Mt);
                Err(message)
            }
        }
    })
    .await
    .map_err(|e| format!("翻译线程异常: {e}"))?
}

/// Give engines back: `gpu_only` frees VRAM and keeps CPU engines warm.
#[tauri::command]
pub fn subtitle_release(app: AppHandle, gpu_only: bool) -> Result<(), String> {
    app.state::<Engines>().release(gpu_only);
    logging::write(&format!("release engines gpu_only={gpu_only}"));
    Ok(())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GpuInfo {
    /// free VRAM (MiB) on an NVIDIA card; null = not NVIDIA / unknown
    free_mb: Option<u32>,
    /// None = not running; Some(true) = on the GPU
    asr_gpu: Option<bool>,
    mt_gpu: Option<bool>,
}

#[tauri::command]
pub async fn subtitle_gpu_info(app: AppHandle) -> Result<GpuInfo, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let (asr_gpu, mt_gpu) = app.state::<Engines>().modes();
        GpuInfo {
            free_mb: sidecar::nvidia_free_mb(),
            asr_gpu,
            mt_gpu,
        }
    })
    .await
    .map_err(|e| e.to_string())
}

// --- assets + data dir ---

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetsReport {
    data_dir: String,
    default_dir: String,
    free_bytes: Option<u64>,
    assets: Vec<AssetStatus>,
}

fn assets_report(app: &AppHandle) -> Result<AssetsReport, String> {
    let dir = storage::data_dir(app)?;
    let mut list = Vec::new();
    for spec in assets::ALL {
        list.push(assets::status(app, spec)?);
    }
    Ok(AssetsReport {
        data_dir: dir.to_string_lossy().into_owned(),
        default_dir: storage::default_data_dir(app)?.to_string_lossy().into_owned(),
        free_bytes: storage::free_bytes(&dir),
        assets: list,
    })
}

#[tauri::command]
pub async fn subtitle_assets(app: AppHandle) -> Result<AssetsReport, String> {
    tauri::async_runtime::spawn_blocking(move || assets_report(&app))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn subtitle_set_data_dir(app: AppHandle, path: String) -> Result<AssetsReport, String> {
    tauri::async_runtime::spawn_blocking(move || {
        // Engines hold files under the old dir open.
        app.state::<Engines>().release(false);
        storage::set_data_dir(&app, &path)?;
        assets_report(&app)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn subtitle_asset_download(
    app: AppHandle,
    id: String,
    on_event: Channel<DownloadEvent>,
) -> Result<(), String> {
    let spec = assets::by_id(&id).ok_or_else(|| format!("未知组件: {id}"))?;
    std::thread::spawn(move || {
        logging::write(&format!("download {}", spec.id));
        if let Err(message) = assets::download(&app, spec, &on_event) {
            logging::write(&format!("download {} failed: {message}", spec.id));
            let _ = on_event.send(DownloadEvent::Failed { message });
        }
    });
    Ok(())
}

// --- per-video cache ---

/// FNV-1a over the path plus the file's size and mtime: a re-encoded file
/// at the same path must not inherit the old subtitles.
fn cache_key(video: &str) -> String {
    let meta = std::fs::metadata(video).ok();
    let size = meta.as_ref().map(|m| m.len()).unwrap_or(0);
    let mtime = meta
        .and_then(|m| m.modified().ok())
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in format!("{}|{size}|{mtime}", video.to_lowercase()).bytes() {
        hash ^= u64::from(byte);
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    format!("{hash:016x}")
}

fn cache_path(app: &AppHandle, video: &str) -> Result<std::path::PathBuf, String> {
    Ok(storage::data_dir(app)?.join("subs").join(format!("{}.json", cache_key(video))))
}

/// The cached generation state for a video (opaque JSON owned by the
/// frontend), or null.
#[tauri::command]
pub async fn subtitle_cache_load(app: AppHandle, path: String) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let file = cache_path(&app, &path)?;
        Ok(std::fs::read_to_string(file).ok())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn subtitle_cache_save(app: AppHandle, path: String, contents: String) -> Result<(), String> {
    if contents.len() > 32 * 1024 * 1024 {
        return Err("字幕缓存过大".to_string());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let file = cache_path(&app, &path)?;
        if let Some(parent) = file.parent() {
            std::fs::create_dir_all(parent).map_err(|e| format!("创建缓存目录失败: {e}"))?;
        }
        let part = file.with_extension("json.part");
        std::fs::write(&part, contents).map_err(|e| format!("写入字幕缓存失败: {e}"))?;
        std::fs::rename(&part, &file).map_err(|e| format!("写入字幕缓存失败: {e}"))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Write an exported subtitle file (path chosen in a save dialog).
/// Extension-gated on purpose.
#[tauri::command]
pub fn subtitle_save_srt(path: String, contents: String) -> Result<(), String> {
    if !path.to_lowercase().ends_with(".srt") {
        return Err("只允许写入 .srt 字幕文件".to_string());
    }
    std::fs::write(&path, contents).map_err(|e| format!("写入字幕失败: {e}"))
}

/// Frontend diagnostic line → subtitle.log.
#[tauri::command]
pub fn subtitle_log(line: String) -> Result<(), String> {
    logging::write(&format!("[front] {line}"));
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cache_key_is_stable_and_case_insensitive() {
        let a = cache_key(r"D:\NoSuchDir\Ep01.mkv");
        assert_eq!(a, cache_key(r"d:\nosuchdir\ep01.MKV"));
        assert_ne!(a, cache_key(r"D:\NoSuchDir\Ep02.mkv"));
        assert_eq!(a.len(), 16);
    }

    #[test]
    fn transcribe_events_serialize_camel_case() {
        let json = serde_json::to_string(&TranscribeEvent::Clip {
            cues: vec![],
            covered_to: 1.5,
        })
        .unwrap();
        assert_eq!(json, r#"{"type":"clip","cues":[],"coveredTo":1.5}"#);
    }
}

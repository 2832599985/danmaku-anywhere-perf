//! Tauri command surface for the subtitle pipeline.
//!
//! `subtitle_transcribe` returns immediately; the pipeline runs on a worker
//! thread and streams progress/results back through a `Channel`:
//! Extracting → Transcribing → Done { cues } | Failed { message } | Cancelled.
//! `subtitle_cancel` flips the registry's cancellation flag; the ffmpeg child
//! is killed and the temp audio removed on the worker thread.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use serde::Serialize;
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager, State};

use super::asr::{self, AsrModel};
use super::audio;
use super::models::{self, DownloadEvent, ModelStatus};

/// One timed subtitle line (matches the frontend `SubtitleCue` shape).
#[derive(Clone, Debug, Serialize)]
pub struct Cue {
    /// seconds from video start
    pub start: f64,
    /// seconds from video start
    pub end: f64,
    /// may contain \n for multi-line display
    pub text: String,
}

/// Progress/result events streamed to the frontend.
#[derive(Clone, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum SubtitleEvent {
    /// audio extraction running; percent is None when total duration is unknown
    Extracting { percent: Option<f32> },
    /// model inference running over the extracted audio
    Transcribing { percent: f32 },
    /// incremental cues: mount these on screen while inference continues
    /// (streamed every few segments so subtitles appear within seconds)
    Partial { cues: Vec<Cue> },
    /// translation pass — optional, only when translating
    #[allow(dead_code)]
    Translating { percent: f32 },
    /// pipeline finished; full cue list (sorted by start)
    Done { cues: Vec<Cue> },
    /// task was cancelled by the user or a media switch
    Cancelled,
    /// unrecoverable pipeline failure
    Failed { message: String },
}

/// Single-flight registry for transcription tasks; carries the cancel flag.
#[derive(Default)]
pub struct TaskRegistry {
    current: Mutex<Option<Arc<AtomicBool>>>,
}

impl TaskRegistry {
    /// Register a new task; errors when one is already running.
    fn try_begin(&self) -> Result<Arc<AtomicBool>, String> {
        let mut guard = self
            .current
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if guard.is_some() {
            return Err("已有转录任务正在进行".to_string());
        }
        let flag = Arc::new(AtomicBool::new(false));
        *guard = Some(Arc::clone(&flag));
        Ok(flag)
    }

    /// Clear the slot when the worker finishes (success, error or cancel).
    fn end(&self) {
        *self
            .current
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = None;
    }

    fn request_cancel(&self) {
        if let Some(flag) = self
            .current
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .as_ref()
        {
            flag.store(true, Ordering::Relaxed);
        }
    }
}

#[tauri::command]
pub fn subtitle_transcribe(
    app: AppHandle,
    path: String,
    duration_secs: Option<f64>,
    language: Option<String>,
    on_event: Channel<SubtitleEvent>,
) -> Result<(), String> {
    if path.trim().is_empty() {
        return Err("视频路径为空".to_string());
    }
    let cancel = {
        let registry: State<TaskRegistry> = app.state();
        registry.try_begin()?
    };

    // The channel is Clone; the AppHandle is Send + Sync. Everything blocking
    // (ffmpeg spawn/wait, model inference) happens on this thread so the IPC
    // reply is never held.
    std::thread::spawn(move || {
        let result = run_pipeline(
            &app,
            &path,
            duration_secs,
            language.as_deref().unwrap_or("auto"),
            &on_event,
            &cancel,
        );
        let registry: State<TaskRegistry> = app.state();
        registry.end();
        let event = match result {
            Ok(cues) => SubtitleEvent::Done { cues },
            Err(message) if message == audio::CANCELLED => SubtitleEvent::Cancelled,
            Err(message) => SubtitleEvent::Failed { message },
        };
        let _ = on_event.send(event);
    });
    Ok(())
}

#[tauri::command]
pub fn subtitle_cancel(app: AppHandle) -> Result<(), String> {
    let registry: State<TaskRegistry> = app.state();
    registry.request_cancel();
    Ok(())
}

/// Persist a generated/translated subtitle file next to the video. Frontend
/// serializes the cues; Rust writes the file (bypasses the webview's
/// read-only fs capability). Extension-gated on purpose.
#[tauri::command]
pub fn subtitle_save_srt(path: String, contents: String) -> Result<(), String> {
    if !path.to_lowercase().ends_with(".srt") {
        return Err("只允许写入 .srt 字幕文件".to_string());
    }
    std::fs::write(&path, contents).map_err(|e| format!("写入字幕失败: {e}"))
}

// --- model management ---

#[tauri::command]
pub fn subtitle_model_status(app: AppHandle) -> Result<Vec<ModelStatus>, String> {
    let mut statuses = Vec::new();
    for spec in models::downloadable_models() {
        statuses.push(models::model_status(&app, spec)?);
    }
    // The VAD ships inside the app; report it as always-present.
    statuses.push(ModelStatus {
        id: models::SILERO_VAD_ID,
        downloaded: true,
        bundled: true,
        size_bytes: 0,
        size_label: "内置".to_string(),
    });
    Ok(statuses)
}

#[tauri::command]
pub fn subtitle_model_download(
    app: AppHandle,
    id: String,
    on_event: Channel<DownloadEvent>,
) -> Result<(), String> {
    let spec = models::spec_by_id(&id).ok_or_else(|| format!("未知模型: {id}"))?;
    // Downloads are independent of the transcription single-flight (fetching a
    // model while a task runs is harmless); no registry interaction.
    std::thread::spawn(move || {
        let result = models::download_model(&app, spec, &on_event);
        if let Err(message) = result {
            let _ = on_event.send(DownloadEvent::Failed { message });
        }
    });
    Ok(())
}

/// Resolve the installed models the pipeline needs, or explain what's missing.
fn resolve_models(app: &AppHandle) -> Result<(AsrModel, std::path::PathBuf), String> {
    let sense = models::resolve_pipeline_models(app)?;
    let tokens = sense.tokens.ok_or("SenseVoice tokens.txt 缺失")?;
    let asr = AsrModel {
        model: sense.model,
        tokens,
    };
    let vad = models::vad_model_path(app)?;
    Ok((asr, vad))
}

/// The STREAMING pipeline: ffmpeg extracts 30 s segments in the background
/// while each ready segment is VAD-segmented + recognized immediately and its
/// cues are pushed as Partial events. First subtitles appear as soon as the
/// FIRST segment is extracted (a couple of seconds), not after the whole
/// episode. Every step checks the cancel flag.
fn run_pipeline(
    app: &AppHandle,
    path: &str,
    duration_secs: Option<f64>,
    language: &str,
    on_event: &Channel<SubtitleEvent>,
    cancel: &Arc<AtomicBool>,
) -> Result<Vec<Cue>, String> {
    // Resolve models BEFORE spawning ffmpeg so a missing model fails fast
    // with the download hint (rather than after a full extraction).
    let (asr_model, vad_model) = resolve_models(app)?;
    let recognizer = asr::create_recognizer(&asr_model, language)?;

    let _ = on_event.send(SubtitleEvent::Extracting { percent: None });
    let extraction = audio::extract_audio_segmented(path, duration_secs, cancel, {
        let on_event = on_event.clone();
        move |percent| {
            let _ = on_event.send(SubtitleEvent::Extracting { percent });
        }
    })?;
    let total_segments = extraction.total.unwrap_or(0);

    let _ = on_event.send(SubtitleEvent::Transcribing { percent: 0.0 });
    let mut all_cues: Vec<Cue> = Vec::new();
    let mut processed = 0usize;
    // Blocking recv: the recognizer waits for the next EXTRACTED segment.
    // Extraction (IO) and inference (CPU) overlap; when inference is faster
    // than extraction the loop simply paces with ffmpeg.
    while let Some(result) = extraction.next_segment() {
        let seg_path = result?;
        if cancel.load(Ordering::Relaxed) {
            return Err(audio::CANCELLED.to_string());
        }
        // Segment i covers [i * SEGMENT_SECS, (i+1) * SEGMENT_SECS).
        let offset = processed as f64 * audio::SEGMENT_SECS;
        let seg_cues = asr::transcribe_segment(
            &seg_path,
            &vad_model,
            &recognizer,
            cancel,
            |mut cues| {
                for cue in &mut cues {
                    cue.start += offset;
                    cue.end += offset;
                }
                let _ = on_event.send(SubtitleEvent::Partial { cues });
            },
        )?;
        all_cues.extend(seg_cues);
        processed += 1;
        let percent = if total_segments > 0 {
            processed as f32 / total_segments as f32
        } else {
            0.0
        };
        let _ = on_event.send(SubtitleEvent::Transcribing { percent });
    }
    if cancel.load(Ordering::Relaxed) {
        return Err(audio::CANCELLED.to_string());
    }
    all_cues.sort_by(|a, b| a.start.partial_cmp(&b.start).unwrap_or(std::cmp::Ordering::Equal));
    Ok(all_cues)
}

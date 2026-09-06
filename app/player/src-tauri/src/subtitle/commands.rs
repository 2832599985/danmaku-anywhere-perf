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
use tauri::{AppHandle, Manager, State};
use tauri::ipc::Channel;

use super::audio;

/// One timed subtitle line (matches the frontend `SubtitleCue` shape).
#[derive(Clone, Serialize)]
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
    /// model inference running over the extracted audio (constructed in stage 3)
    #[allow(dead_code)]
    Transcribing { percent: f32 },
    /// translation pass (stage 4) — optional, only when translating
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
        let result = run_pipeline(&path, duration_secs, &on_event, &cancel);
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

/// The transcription pipeline. Stage 2 wires extraction + plumbing; the ASR
/// step (stage 3) slots in at `asr_stage`.
fn run_pipeline(
    path: &str,
    duration_secs: Option<f64>,
    on_event: &Channel<SubtitleEvent>,
    cancel: &Arc<AtomicBool>,
) -> Result<Vec<Cue>, String> {
    let _ = on_event.send(SubtitleEvent::Extracting { percent: None });
    // Keep the WAV alive for the whole pipeline; Drop cleans it up.
    let _audio = audio::extract_audio(path, duration_secs, cancel, |percent| {
        let _ = on_event.send(SubtitleEvent::Extracting { percent });
    })?;
    if cancel.load(Ordering::Relaxed) {
        return Err(audio::CANCELLED.to_string());
    }

    // TODO(stage 3): Silero-VAD segmentation + sherpa-onnx SenseVoice/Whisper
    // inference over `_audio.path`, emitting Transcribing percent events.

    Ok(Vec::new())
}

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
    start_secs: Option<f64>,
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
        let result = run_pipeline(
            &app,
            &path,
            start_secs.unwrap_or(0.0).max(0.0),
            duration_secs,
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
/// while each ready segment is pushed into ONE streaming VAD + recognizer and
/// FOLLOW-PLAYHEAD pipeline: recognition starts at the CURRENT PLAYBACK
/// position (so what's on screen gets subtitles first), runs to the end,
/// then back-fills everything before the start position. Seek during a run
/// reprioritizes: `subtitle_seek` cancels the current region and the
/// frontend restarts from the new playhead (its cues for already-covered
/// regions come from the partial track already mounted).
///
/// Within one region the streaming invariants hold: one VAD instance sees
/// the whole region so speech spanning an extraction boundary stays a single
/// cue; region boundaries align to 30 s grid lines (the seek start is
/// snapped down), so consecutive regions share boundaries exactly and a
/// sentence at a region seam is only ever split along the grid, never
/// mid-word across different runs.
///
/// COLD-START BUDGET (≤5 s to first cue): ffmpeg input-seeks to the
/// playhead (`-ss` before `-i`, fast) and spawns immediately; extraction
/// (IO) overlaps model loading (CPU).
fn run_pipeline(
    app: &AppHandle,
    path: &str,
    start_secs: f64,
    duration_secs: Option<f64>,
    on_event: &Channel<SubtitleEvent>,
    cancel: &Arc<AtomicBool>,
) -> Result<Vec<Cue>, String> {
    // Load the models first: ONE recognizer serves both regions (the model
    // load is the expensive part; VAD is per-region by design).
    let (asr_model, vad_model) = resolve_models(app)?;

    let mut all_cues: Vec<Cue> = Vec::new();
    // Region A: playhead → end. Region B (back-fill): 0 → playhead.
    let regions = [(start_secs, duration_secs), (0.0, Some(start_secs))];
    for (region_start, region_end) in regions {
        if cancel.load(Ordering::Relaxed) {
            return Err(audio::CANCELLED.to_string());
        }
        // Skip empty regions (no duration known, or starting at 0).
        let Some(region_end) = region_end else {
            continue;
        };
        if region_end - region_start < audio::SEGMENT_SECS * 0.5 {
            continue;
        }
        let region_len = region_end - region_start;

        let _ = on_event.send(SubtitleEvent::Extracting { percent: None });
        let extraction = audio::extract_audio_segmented(
            path,
            region_start,
            Some(region_len),
            cancel,
            {
                let on_event = on_event.clone();
                move |percent| {
                    let _ = on_event.send(SubtitleEvent::Extracting { percent });
                }
            },
        )?;
        let total_segments = extraction.total.unwrap_or(0);

        // Fresh VAD per region; its timestamps are region-relative.
        let mut transcriber =
            asr::StreamingTranscriber::new(&asr_model, &vad_model, "zh", Arc::clone(cancel))?;

        let _ = on_event.send(SubtitleEvent::Transcribing { percent: 0.0 });
        let mut processed = 0usize;
        while let Some(result) = extraction.next_segment() {
            let seg_path = result?;
            if cancel.load(Ordering::Relaxed) {
                return Err(audio::CANCELLED.to_string());
            }
            let mut seg_cues = transcriber.push_wav(&seg_path)?;
            for cue in &mut seg_cues {
                cue.start += region_start;
                cue.end += region_start;
            }
            if !seg_cues.is_empty() {
                all_cues.extend(seg_cues.iter().cloned());
                let _ = on_event.send(SubtitleEvent::Partial { cues: seg_cues });
            }
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
        // Trailing speech still buffered in the VAD.
        let mut tail = transcriber.finish()?;
        for cue in &mut tail {
            cue.start += region_start;
            cue.end += region_start;
        }
        if !tail.is_empty() {
            all_cues.extend(tail.iter().cloned());
            let _ = on_event.send(SubtitleEvent::Partial { cues: tail });
        }
    }
    Ok(all_cues)
}

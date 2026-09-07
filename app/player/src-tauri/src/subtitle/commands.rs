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
use super::logging;
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
    end_secs: Option<f64>,
    on_event: Channel<SubtitleEvent>,
) -> Result<(), String> {
    if path.trim().is_empty() {
        return Err("视频路径为空".to_string());
    }
    let start = start_secs.unwrap_or(0.0).max(0.0);
    let end = end_secs.unwrap_or(f64::MAX);
    logging::write(&format!(
        "cmd transcribe: start={start:.2} end={end:.2} path={path}"
    ));
    let cancel = {
        let registry: State<TaskRegistry> = app.state();
        registry.try_begin()?
    };

    // The channel is Clone; the AppHandle is Send + Sync. Everything blocking
    // (ffmpeg spawn/wait, model inference) happens on this thread so the IPC
    // reply is never held.
    std::thread::spawn(move || {
        let result = run_pipeline(&app, &path, start, end, &on_event, &cancel);
        let registry: State<TaskRegistry> = app.state();
        registry.end();
        let event = match result {
            Ok(cues) => {
                logging::write(&format!("pipeline done: {} cues", cues.len()));
                SubtitleEvent::Done { cues }
            }
            Err(message) if message == audio::CANCELLED => {
                logging::write("pipeline cancelled");
                SubtitleEvent::Cancelled
            }
            Err(message) => {
                logging::write(&format!("pipeline failed: {message}"));
                SubtitleEvent::Failed { message }
            }
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

/// Frontend diagnostic line → subtitle.log (the trace for "no subtitles").
#[tauri::command]
pub fn subtitle_log(app: AppHandle, line: String) -> Result<(), String> {
    let _ = &app;
    logging::write(&format!("[front] {line}"));
    Ok(())
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

/// FOLLOW-PLAYHEAD window pipeline. Recognition covers exactly
/// [start_secs, end_secs] — a bounded lookahead ahead of the playhead that
/// the frontend chooses (e.g. +150 s), never the whole file. This is the
/// "分段生成 while playing" shape: one short task finishes in ~2 s and stops,
/// so the CPU is free between windows and the capsule never sits at "100%
/// then keeps running" (the old whole-file backfill that made the player
/// stall). As playback approaches the covered end, the frontend opens the
/// next window.
///
/// One VAD + one recognizer per task (model load is the expensive part and
/// happens once). Segment times are region-relative; the task adds start.
///
/// COLD START (first cue ≤5 s): ffmpeg input-seeks to `start_secs` (`-ss`
/// before `-i`, fast, no decode-from-0) and spawns immediately; the ~1-2 s
/// model load overlaps the first segment's extraction.
fn run_pipeline(
    app: &AppHandle,
    path: &str,
    start_secs: f64,
    end_secs: f64,
    on_event: &Channel<SubtitleEvent>,
    cancel: &Arc<AtomicBool>,
) -> Result<Vec<Cue>, String> {
    let region_len = (end_secs - start_secs).max(0.0);
    if region_len < audio::SEGMENT_SECS * 0.4 {
        // Window too short to bother (e.g. playhead already near the video
        // end and the frontend clamped) — succeed with nothing.
        logging::write(&format!(
            "window too short: start={start_secs:.2} end={end_secs:.2} — skipped"
        ));
        return Ok(Vec::new());
    }

    // 1. Spawn ffmpeg (extraction proceeds on its own thread).
    let _ = on_event.send(SubtitleEvent::Extracting { percent: None });
    logging::write(&format!(
        "extract window: start={start_secs:.2} len={region_len:.2} (5 segments of 30s expected: {})",
        (region_len / 30.0).ceil() as usize
    ));
    let extraction =
        audio::extract_audio_segmented(path, start_secs, Some(region_len), cancel, {
            let on_event = on_event.clone();
            move |percent| {
                let _ = on_event.send(SubtitleEvent::Extracting { percent });
            }
        })?;
    let total_segments = extraction.total.unwrap_or(0);

    // 2. Load the model while ffmpeg extracts. Fixed Chinese recognition.
    let (asr_model, vad_model) = resolve_models(app)?;
    logging::write(&format!(
        "models resolved: model={} vad={}",
        asr_model.model.display(),
        vad_model.display()
    ));
    let recognizer = asr::create_recognizer(&asr_model, "zh")?;

    // 3. Consume the window segment by segment. Extraction (IO) and
    // inference (CPU) overlap; the loop paces with ffmpeg.
    let _ = on_event.send(SubtitleEvent::Transcribing { percent: 0.0 });
    let mut all_cues: Vec<Cue> = Vec::new();
    let mut processed = 0usize;
    while let Some(result) = extraction.next_segment() {
        let seg_path = result?;
        if cancel.load(Ordering::Relaxed) {
            return Err(audio::CANCELLED.to_string());
        }
        let mut seg_cues = asr::transcribe_segment(
            &seg_path,
            &vad_model,
            &recognizer,
            cancel,
            |_| {},
        )?;
        if seg_cues.is_empty() {
            logging::write(&format!(
                "segment {processed}: 0 cues (silence or recognition empty)"
            ));
        }
        // Segment i holds audio [start + i*30, start + (i+1)*30); its VAD
        // times are file-relative and MUST be shifted by the segment's own
        // offset, not just the window start. Missing this term put every
        // segment's cues 30s/60s/90s… EARLY — subtitles jumping sentences
        // ahead of the speech, re-syncing only at each segment boundary.
        let offset = start_secs + processed as f64 * audio::SEGMENT_SECS;
        for cue in &mut seg_cues {
            cue.start += offset;
            cue.end += offset;
        }
        if !seg_cues.is_empty() {
            logging::write(&format!(
                "partial: +{} cues (first at {:.2})",
                seg_cues.len(),
                seg_cues.first().map(|c| c.start).unwrap_or(0.0)
            ));
            all_cues.extend(seg_cues.iter().cloned());
            let _ = on_event.send(SubtitleEvent::Partial { cues: seg_cues });
        }
        processed += 1;
        let percent = if total_segments > 0 {
            (processed as f32 / total_segments as f32).min(1.0)
        } else {
            0.0
        };
        let _ = on_event.send(SubtitleEvent::Transcribing { percent });
    }
    if cancel.load(Ordering::Relaxed) {
        return Err(audio::CANCELLED.to_string());
    }
    logging::write(&format!("window complete: {} total cues", all_cues.len()));
    Ok(all_cues)
}

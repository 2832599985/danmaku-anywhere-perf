//! Audio extraction via ffmpeg, SEGMENTED for streaming.
//!
//! The player accepts containers the webview cannot decode audio for
//! (mkv/avi/flv/ts, AC3/DTS tracks), so extraction runs in Rust through an
//! ffmpeg binary. Resolution order:
//!   1. `ffmpeg.exe` next to the main executable (the Tauri `externalBin`
//!      sidecar location in release builds — see `binaries/README.md`)
//!   2. `ffmpeg` on PATH (dev machines)
//!
//! Instead of one whole-file WAV, ffmpeg writes fixed-length 16 kHz mono
//! segments (`-f segment`), so the pipeline can transcribe-and-STREAM segment
//! by segment: first subtitles appear while extraction of the rest of the
//! episode is still running. Extraction and inference run on two threads with
//! a bounded queue of ready segment files.

use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{mpsc, Arc};
use std::time::{SystemTime, UNIX_EPOCH};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

/// Suppresses the console window ffmpeg would open in release builds
/// (`windows_subsystem = "windows"` keeps the app windowless, but spawned
/// children do not inherit that).
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Segment length in seconds. Small enough that the first segment finishes
/// extracting in a couple of seconds, large enough that per-segment ffmpeg
/// overhead stays negligible.
pub const SEGMENT_SECS: f64 = 30.0;
/// Upper bound on segments buffered between extractor and recognizer.
const QUEUE_BOUND: usize = 4;

/// Locate the ffmpeg binary. Errors only when neither the sidecar location
/// nor PATH provides one (surfaced as a user-facing message).
pub fn resolve_ffmpeg() -> Result<PathBuf, String> {
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            #[cfg(windows)]
            let candidate = dir.join("ffmpeg.exe");
            #[cfg(not(windows))]
            let candidate = dir.join("ffmpeg");
            if candidate.is_file() {
                return Ok(candidate);
            }
        }
    }
    // Rely on the OS PATH lookup; existence is checked by `spawn`'s error.
    Ok(PathBuf::from("ffmpeg"))
}

pub const CANCELLED: &str = "__cancelled__";

/// A streaming extraction session: files appear in the output dir as ffmpeg
/// progresses; `segments()` yields them in order until the process exits.
/// Segment 0 corresponds to `start_secs` in the VIDEO's timeline (callers add
/// that offset to derive absolute cue times).
pub struct SegmentedExtraction {
    /// Directory holding seg-000000.wav, seg-000001.wav, …
    pub dir: PathBuf,
    /// Video-timeline position of segment 0 (seconds).
    pub start_secs: f64,
    /// Bound-checked channel of segment file paths, closed on completion.
    rx: mpsc::Receiver<Result<PathBuf, String>>,
    /// Total segments expected (None when duration unknown).
    pub total: Option<usize>,
}

impl Drop for SegmentedExtraction {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.dir);
    }
}

/// Start a segmented extraction. Returns once ffmpeg has SPAWNED (it keeps
/// running on a background thread, feeding the channel). Cancelling kills
/// ffmpeg; the Drop cleans the temp dir.
///
/// `start_secs`: extraction BEGINS here (playhead position) instead of 0 —
/// the follow-playhead mode: subtitles for what is on screen RIGHT NOW
/// arrive first; regions before/behind are back-filled later by re-running
/// with different start points.
pub fn extract_audio_segmented(
    video: &str,
    start_secs: f64,
    duration_secs: Option<f64>,
    cancel: &Arc<AtomicBool>,
    mut on_percent: impl FnMut(Option<f32>) + Send + 'static,
) -> Result<SegmentedExtraction, String> {
    let ffmpeg = resolve_ffmpeg()?;
    let dir = temp_seg_dir();

    let total = duration_secs.map(|d| (d / SEGMENT_SECS).ceil() as usize);

    let mut command = Command::new(&ffmpeg);
    command
        .args([
            "-y",
            "-hide_banner",
            "-loglevel",
            "error",
        ]);
    // Seek to the playhead BEFORE -i so ffmpeg input-seeks (fast, keyframe-
    // accurate enough for audio) rather than decoding everything from 0.
    if start_secs > 0.0 {
        command.args(["-ss", &start_secs.to_string()]);
    }
    command
        .args([
            "-i",
            video,
            "-vn",
            "-ac",
            "1",
            "-ar",
            "16000",
            "-acodec",
            "pcm_s16le",
            // fixed-length WAV segments: seg-000000.wav, seg-000001.wav, …
            "-f",
            "segment",
            "-segment_time",
            &SEGMENT_SECS.to_string(),
            "-reset_timestamps",
            "1",
            // machine-readable `key=value` progress lines on stdout
            "-progress",
            "pipe:1",
            "-nostats",
        ])
        .arg(dir.join("seg-%06d.wav"))
        .stdout(Stdio::piped())
        // Capture stderr so a failed spawn can report ffmpeg's actual error
        // instead of a generic "extraction failed" (diagnosability matters:
        // the same command succeeds from a shell).
        .stderr(Stdio::piped());

    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);

    let mut child = command.spawn().map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            "未找到 ffmpeg（请将 ffmpeg.exe 放到程序目录或加入 PATH）".to_string()
        } else {
            format!("启动 ffmpeg 失败: {e}")
        }
    })?;

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "无法读取 ffmpeg 输出".to_string())?;
    // Take stderr too: read it AFTER the stdout loop so a failure message can
    // be appended to the generic error (ffmpeg writes its last words here).
    let mut stderr = child
        .stderr
        .take()
        .ok_or_else(|| "无法读取 ffmpeg 错误输出".to_string())?;

    let (tx, rx) = mpsc::sync_channel::<Result<PathBuf, String>>(QUEUE_BOUND);
    let done_count = Arc::new(AtomicUsize::new(0));
    let done_for_thread = Arc::clone(&done_count);
    let cancel_for_thread = Arc::clone(cancel);
    let dir_for_thread = dir.clone();

    // Watcher thread: parse ffmpeg progress, announce each completed segment
    // on the channel. `tx` closes when the thread ends = extraction complete.
    std::thread::spawn(move || {
        let dir = dir_for_thread;
        let cancel = cancel_for_thread;
        let mut announced = 0usize;
        for line in BufReader::new(stdout).lines() {
            if cancel.load(Ordering::Relaxed) {
                let _ = child.kill();
                let _ = child.wait();
                let _ = tx.send(Err(CANCELLED.to_string()));
                return;
            }
            let line = match line {
                Ok(line) => line,
                Err(_) => break,
            };
            if let Some(us) = line.strip_prefix("out_time_us=") {
                if let Ok(micros) = us.trim().parse::<f64>() {
                    let seconds = micros / 1_000_000.0;
                    let seg_index = (seconds / SEGMENT_SECS).floor() as usize;
                    // A segment file is complete once ffmpeg is past it.
                    while announced < seg_index {
                        let path = dir.join(format!("seg-{announced:06}.wav"));
                        if path.is_file() {
                            let _ = tx.send(Ok(path));
                            done_for_thread.store(announced + 1, Ordering::Relaxed);
                        }
                        announced += 1;
                    }
                    if let Some(total) = total {
                        let percent =
                            (seconds / (total as f64 * SEGMENT_SECS)).clamp(0.0, 1.0) as f32;
                        on_percent(Some(percent));
                    }
                }
            }
        }
        let status = match child.wait() {
            Ok(status) => status,
            Err(e) => {
                let _ = tx.send(Err(format!("等待 ffmpeg 失败: {e}")));
                return;
            }
        };
        if cancel.load(Ordering::Relaxed) {
            let _ = tx.send(Err(CANCELLED.to_string()));
            return;
        }
        if !status.success() {
            let mut detail = String::new();
            use std::io::Read;
            let _ = stderr.read_to_string(&mut detail);
            let detail = detail.trim();
            let message = if detail.is_empty() {
                "音频提取失败（容器或音轨编码可能不受 ffmpeg 支持）".to_string()
            } else {
                format!("音频提取失败: {}", &detail[..detail.len().min(300)])
            };
            let _ = tx.send(Err(message));
            return;
        }
        // Final flush: announce every remaining segment file in order.
        loop {
            let path = dir.join(format!("seg-{announced:06}.wav"));
            if !path.is_file() {
                break;
            }
            let _ = tx.send(Ok(path));
            done_for_thread.store(announced + 1, Ordering::Relaxed);
            announced += 1;
        }
        // Channel close = extraction complete (tx dropped here).
    });

    Ok(SegmentedExtraction {
        dir,
        start_secs,
        rx,
        total,
    })
}

impl SegmentedExtraction {
    /// Block for the next ready segment file; None once extraction finished.
    pub fn next_segment(&self) -> Option<Result<PathBuf, String>> {
        self.rx.recv().ok()
    }
}

fn temp_seg_dir() -> PathBuf {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let dir = std::env::temp_dir().join(format!("danmaku-player-audio-{nanos}"));
    // ffmpeg's segment muxer will not create the directory itself.
    std::fs::create_dir_all(&dir).ok();
    dir
}

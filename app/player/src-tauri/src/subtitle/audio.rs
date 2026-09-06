//! Audio extraction via ffmpeg.
//!
//! The player accepts containers the webview cannot decode audio for
//! (mkv/avi/flv/ts, AC3/DTS tracks), so extraction runs in Rust through an
//! ffmpeg binary. Resolution order:
//!   1. `ffmpeg.exe` next to the main executable (the Tauri `externalBin`
//!      sidecar location in release builds — see `binaries/README.md`)
//!   2. `ffmpeg` on PATH (dev machines)
//!
//! Output: 16 kHz mono s16le WAV in the system temp dir (whisper/SenseVoice
//! input format), deleted by the caller when the pipeline finishes.

use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

/// Suppresses the console window ffmpeg would open in release builds
/// (`windows_subsystem = "windows"` keeps the app windowless, but spawned
/// children do not inherit that).
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

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

/// Temp WAV sink for the current extraction.
pub struct ExtractedAudio {
    pub path: PathBuf,
}

impl Drop for ExtractedAudio {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.path);
    }
}

/// Extract a 16 kHz mono WAV from `video`.
///
/// `duration_secs` (from the frontend's playback mirror) drives progress
/// percentages; without it extraction reports an indeterminate progress
/// (None). `on_percent` receives 0..1 (called with the raw fraction; the
/// caller clamps) — or None when the total duration is unknown. Cancelling
/// kills ffmpeg and removes the partial output.
pub fn extract_audio(
    video: &str,
    duration_secs: Option<f64>,
    cancel: &Arc<AtomicBool>,
    mut on_percent: impl FnMut(Option<f32>),
) -> Result<ExtractedAudio, String> {
    let ffmpeg = resolve_ffmpeg()?;
    let out_path = temp_wav_path();

    let mut command = Command::new(&ffmpeg);
    command
        .args([
            "-y",
            "-hide_banner",
            "-loglevel",
            "error",
            "-i",
            video,
            "-vn",
            "-ac",
            "1",
            "-ar",
            "16000",
            "-acodec",
            "pcm_s16le",
            // machine-readable `key=value` progress lines on stdout
            "-progress",
            "pipe:1",
            "-nostats",
        ])
        .arg(&out_path)
        .stdout(Stdio::piped())
        .stderr(Stdio::null());

    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);

    let mut child = command
        .spawn()
        .map_err(|e| {
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

    let mut emitted: Option<f32> = None;
    for line in BufReader::new(stdout).lines() {
        if cancel.load(Ordering::Relaxed) {
            let _ = child.kill();
            let _ = child.wait();
            return Err(CANCELLED.to_string());
        }
        let line = match line {
            Ok(line) => line,
            Err(_) => break,
        };
        // `out_time_us=1234567` (ffmpeg ≥ 4.x) / `out_time_ms=` (microseconds,
        // despite the name, in ffmpeg 4.x era builds we also accept it).
        let fraction = if let Some(us) = line.strip_prefix("out_time_us=") {
            parse_us(us).map(|us| us / 1_000_000.0)
        } else if let Some(ms) = line.strip_prefix("out_time_ms=") {
            parse_us(ms).map(|us| us / 1_000_000.0)
        } else {
            None
        };
        if let (Some(seconds), Some(total)) = (fraction, duration_secs) {
            if total > 0.0 {
                let percent = (seconds / total).clamp(0.0, 1.0) as f32;
                // Throttle identical/rounding-noise updates.
                if emitted.map_or(true, |last| percent - last >= 0.005) {
                    emitted = Some(percent);
                    on_percent(Some(percent));
                }
            }
        }
    }

    let status = child.wait().map_err(|e| format!("等待 ffmpeg 失败: {e}"))?;
    if cancel.load(Ordering::Relaxed) {
        return Err(CANCELLED.to_string());
    }
    if !status.success() {
        return Err(
            "音频提取失败（容器或音轨编码可能不受 ffmpeg 支持）".to_string()
        );
    }
    if !out_path.is_file() {
        return Err("ffmpeg 未产出音频文件".to_string());
    }

    Ok(ExtractedAudio { path: out_path })
}

pub const CANCELLED: &str = "__cancelled__";

fn parse_us(raw: &str) -> Option<f64> {
    raw.trim().parse::<f64>().ok()
}

fn temp_wav_path() -> PathBuf {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    std::env::temp_dir().join(format!("danmaku-player-audio-{nanos}.wav"))
}

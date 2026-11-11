//! Audio extraction via ffmpeg.
//!
//! The player accepts containers the webview cannot decode audio for
//! (mkv/avi/flv/ts, AC3/DTS tracks), so extraction runs in Rust through an
//! ffmpeg binary. Resolution order:
//!   1. `ffmpeg.exe` next to the main executable (the Tauri `externalBin`
//!      sidecar location in release builds — see `binaries/README.md`)
//!   2. `ffmpeg` on PATH (dev machines)
//!
//! Recognition works on one CLIP at a time (whisper slices, see whisper.rs):
//! ffmpeg input-seeks to the clip start (`-ss` before `-i`, no decode from 0)
//! and writes 16 kHz mono PCM WAV. A 120 s clip takes ~0.1-0.3 s.

use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

/// Suppresses the console window ffmpeg would open in release builds
/// (`windows_subsystem = "windows"` keeps the app windowless, but spawned
/// children do not inherit that). Shared with `tracks.rs` and `sidecar.rs`.
#[cfg(windows)]
pub(crate) const CREATE_NO_WINDOW: u32 = 0x0800_0000;

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

/// Write `[start, start + len)` of the video's audio to `out` as 16 kHz mono
/// WAV. Polls `cancel` and kills ffmpeg when it flips.
pub fn extract_wav(
    video: &str,
    start: f64,
    len: f64,
    out: &Path,
    cancel: &AtomicBool,
) -> Result<(), String> {
    let ffmpeg = resolve_ffmpeg()?;
    let mut command = Command::new(&ffmpeg);
    command.args(["-y", "-hide_banner", "-loglevel", "error", "-nostdin"]);
    if start > 0.0 {
        command.args(["-ss", &format!("{start:.3}")]);
    }
    command
        .arg("-i")
        .arg(video)
        .args(["-t", &format!("{len:.3}"), "-vn", "-ac", "1", "-ar", "16000", "-acodec", "pcm_s16le"])
        .arg(out)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
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
    loop {
        if cancel.load(Ordering::Relaxed) {
            let _ = child.kill();
            let _ = child.wait();
            return Err(CANCELLED.to_string());
        }
        match child.try_wait() {
            Ok(Some(status)) if status.success() => return Ok(()),
            Ok(Some(_)) => {
                let mut detail = String::new();
                if let Some(mut stderr) = child.stderr.take() {
                    use std::io::Read;
                    let _ = stderr.read_to_string(&mut detail);
                }
                let detail = detail.trim();
                return Err(if detail.is_empty() {
                    "音频提取失败（容器或音轨编码可能不受 ffmpeg 支持）".to_string()
                } else {
                    format!("音频提取失败: {}", detail.chars().take(300).collect::<String>())
                });
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(20)),
            Err(e) => return Err(format!("等待 ffmpeg 失败: {e}")),
        }
    }
}

/// A unique temp WAV path for one clip (caller deletes it).
pub fn temp_wav() -> PathBuf {
    std::env::temp_dir().join(format!("danmaku-player-clip-{}.wav", uuid::Uuid::new_v4().simple()))
}

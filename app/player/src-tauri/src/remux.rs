//! Container remuxing for files the WebView2 media stack cannot demux.
//!
//! WebView2 (Chromium) opens MP4/MOV/WebM/MKV, but its demuxer refuses FLV,
//! MPEG-TS and AVI outright (`PipelineStatus::DEMUXER_ERROR_COULD_NOT_OPEN:
//! FFmpegDemuxer: open context failed`) even when the elementary streams inside
//! are exactly what it decodes — H.264 + AAC, as anime downloads usually are.
//! The container is the only problem, so `ffmpeg -c copy` rewrites it: every
//! packet is copied bit-for-bit (no re-encode, no quality loss) and a 22-minute
//! 1080p FLV takes ~0.35 s.
//!
//! The result is cached under `<app cache dir>/media` keyed by source path +
//! size + mtime, so re-opening a file is instant and an edited file gets a new
//! entry instead of a stale one. The ORIGINAL path is what the frontend keeps
//! in the playlist (`path`): resume history, sibling danmaku (`01.xml`),
//! embedded-subtitle probing and learned filename rules all keep working on the
//! real file; only the URL handed to the `<video>` element points at the copy.

use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use sha2::{Digest, Sha256};
use tauri::Manager;

use crate::subtitle::audio;

/// Containers the WebView2 media stack cannot demux. Keep in sync with
/// `REMUX_EXTENSIONS` in `src/platform/types.ts` (the frontend uses that copy
/// only to decide whether to announce the conversion up front).
const NEEDS_REMUX: &[&str] = &["flv", "ts", "avi"];

/// A copy that takes longer than this is treated as wedged (a huge file on a
/// dying drive, or ffmpeg waiting on something). The child is killed.
const REMUX_TIMEOUT: Duration = Duration::from_secs(300);

/// Upper bound on the cache directory. Remuxes are as large as their source,
/// so an unbounded cache would quietly eat a season's worth of disk. Oldest
/// entries are dropped first; a dropped entry simply remuxes again on open.
const CACHE_LIMIT_BYTES: u64 = 2 * 1024 * 1024 * 1024;

/// Serializes remuxes: two episodes of a batch opening at once would otherwise
/// fight for the disk, and the same file asked for twice (main element +
/// progress-bar thumbnail decoder) must produce one copy, not two.
static REMUX_LOCK: Mutex<()> = Mutex::new(());

#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreparedMedia {
    /// Absolute path to play: the source itself, or the cached converted copy.
    pub path: String,
    /// True when this call produced a new copy (false for cache hits and for
    /// files whose container needs no conversion).
    pub remuxed: bool,
}

/// Lower-case extension (no dot) of a path, or "" when it has none.
fn extension_of(path: &Path) -> String {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .unwrap_or_default()
}

/// True when the container has to be rewritten before the webview can open it.
pub fn needs_remux(path: &Path) -> bool {
    NEEDS_REMUX.contains(&extension_of(path).as_str())
}

/// Cache file for `source`, keyed on its identity (path + size + mtime).
fn cache_target(source: &Path, cache_dir: &Path) -> Result<PathBuf, String> {
    let meta = std::fs::metadata(source).map_err(|e| format!("无法读取文件信息: {e}"))?;
    let modified = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let mut hasher = Sha256::new();
    hasher.update(source.to_string_lossy().to_lowercase().as_bytes());
    hasher.update(meta.len().to_le_bytes());
    hasher.update(modified.to_le_bytes());
    let digest = hasher.finalize();
    let mut key = String::with_capacity(32);
    for byte in digest.iter().take(16) {
        key.push_str(&format!("{byte:02x}"));
    }
    Ok(cache_dir.join(format!("{key}.mp4")))
}

/// A cached copy is usable only when it is a real, non-empty file.
fn usable(path: &Path) -> bool {
    std::fs::metadata(path)
        .map(|m| m.is_file() && m.len() > 0)
        .unwrap_or(false)
}

/// Run ffmpeg to completion (with a deadline) and return its stderr on failure.
fn run_ffmpeg(command: std::process::Command) -> Result<(), String> {
    let output = crate::subtitle::tracks::run_with_timeout(
        command,
        "ffmpeg（容器转换）",
        REMUX_TIMEOUT,
        &|| false,
    )?;
    if output.status.success() {
        return Ok(());
    }
    let detail = String::from_utf8_lossy(&output.stderr);
    Err(detail.trim().to_string())
}

/// `-c copy` into `target`. MP4 first (faststart puts the index in front, the
/// form WebView2 likes best); MKV when a codec cannot live in MP4.
fn remux(source: &Path, target: &Path) -> Result<(), String> {
    let ffmpeg = audio::resolve_ffmpeg()?;
    let part = target.with_extension("part.mp4");
    let _ = std::fs::remove_file(&part);

    let attempt = |extra: &[&str], out: &Path| -> Result<(), String> {
        let mut command = std::process::Command::new(&ffmpeg);
        command
            .args(["-y", "-hide_banner", "-loglevel", "error", "-nostdin", "-i"])
            .arg(source)
            // Video + audio only: subtitle/data streams are read from the
            // ORIGINAL file by the player's own pipeline, and some of them
            // cannot be muxed into MP4 at all.
            .args(["-map", "0:v:0", "-map", "0:a:0?", "-c", "copy"])
            .args(extra)
            .arg(out);
        run_ffmpeg(command)
    };

    let result = attempt(&["-movflags", "+faststart"], &part).and_then(|()| {
        if usable(&part) {
            Ok(())
        } else {
            Err("转换后没有产生可播放的文件".to_string())
        }
    });
    if result.is_ok() {
        std::fs::rename(&part, target).map_err(|e| format!("无法保存转换结果: {e}"))?;
        return Ok(());
    }

    // Codec the MP4 muxer cannot hold (e.g. an AVI carrying something exotic):
    // Matroska accepts nearly everything.
    let _ = std::fs::remove_file(&part);
    let mkv = target.with_extension("mkv");
    let part = target.with_extension("part.mkv");
    let _ = std::fs::remove_file(&part);
    let fallback = attempt(&["-f", "matroska"], &part).and_then(|()| {
        if usable(&part) {
            std::fs::rename(&part, &mkv).map_err(|e| format!("无法保存转换结果: {e}"))
        } else {
            Err("转换后没有产生可播放的文件".to_string())
        }
    });
    fallback.map_err(|second| {
        let first = result.err().unwrap_or_default();
        if second.is_empty() {
            first
        } else {
            format!("{first}；{second}")
        }
    })
}

/// Drop the oldest cache entries once the directory exceeds [`CACHE_LIMIT_BYTES`].
fn prune(cache_dir: &Path, keep: &Path) {
    prune_to(cache_dir, keep, CACHE_LIMIT_BYTES);
}

fn prune_to(cache_dir: &Path, keep: &Path, limit: u64) {
    let Ok(entries) = std::fs::read_dir(cache_dir) else {
        return;
    };
    let mut files: Vec<(SystemTime, u64, PathBuf)> = entries
        .flatten()
        .filter_map(|entry| {
            let path = entry.path();
            let meta = entry.metadata().ok()?;
            if !meta.is_file() {
                return None;
            }
            Some((meta.modified().ok()?, meta.len(), path))
        })
        .collect();
    let mut total: u64 = files.iter().map(|(_, size, _)| *size).sum();
    if total <= limit {
        return;
    }
    files.sort_by_key(|(modified, _, _)| *modified);
    for (_, size, path) in files {
        if total <= limit {
            break;
        }
        if path == keep {
            continue;
        }
        if std::fs::remove_file(&path).is_ok() {
            total = total.saturating_sub(size);
        }
    }
}

/// Ensure a webview-playable file exists for `source` and return its path.
/// Never converts a container that already plays.
pub fn prepare(source: &Path, cache_dir: &Path) -> Result<PreparedMedia, String> {
    let unchanged = || PreparedMedia {
        path: source.to_string_lossy().into_owned(),
        remuxed: false,
    };
    if !needs_remux(source) {
        return Ok(unchanged());
    }
    if !source.is_file() {
        // Missing file: let the <video> element report it the way it always has.
        return Ok(unchanged());
    }

    let target = cache_target(source, cache_dir)?;
    let mkv = target.with_extension("mkv");
    for hit in [&target, &mkv] {
        if usable(hit) {
            return Ok(PreparedMedia {
                path: hit.to_string_lossy().into_owned(),
                remuxed: false,
            });
        }
    }

    let _turn = REMUX_LOCK.lock().unwrap_or_else(|p| p.into_inner());
    // Another request for the same file may have finished while we waited.
    for hit in [&target, &mkv] {
        if usable(hit) {
            return Ok(PreparedMedia {
                path: hit.to_string_lossy().into_owned(),
                remuxed: false,
            });
        }
    }

    std::fs::create_dir_all(cache_dir).map_err(|e| format!("无法创建缓存目录: {e}"))?;
    remux(source, &target)?;
    let produced = if usable(&target) { target } else { mkv };
    prune(cache_dir, &produced);
    Ok(PreparedMedia {
        path: produced.to_string_lossy().into_owned(),
        remuxed: true,
    })
}

/// Tauri command: resolve a local path to something the webview can play.
#[tauri::command]
pub async fn media_prepare(app: tauri::AppHandle, path: String) -> Result<PreparedMedia, String> {
    let cache_dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| format!("无法定位缓存目录: {e}"))?
        .join("media");
    tauri::async_runtime::spawn_blocking(move || prepare(Path::new(&path), &cache_dir))
        .await
        .map_err(|e| format!("容器转换任务失败: {e}"))?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "danmaku-remux-test-{}-{}",
            std::process::id(),
            name
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("temp dir");
        dir
    }

    #[test]
    fn only_unplayable_containers_are_remuxed() {
        for ext in ["flv", "ts", "avi", "FLV", "Ts"] {
            assert!(
                needs_remux(Path::new(&format!("C:\\a.{ext}"))),
                "{ext} must be remuxed"
            );
        }
        for ext in ["mp4", "mkv", "webm", "mov", "ogv", "m4v"] {
            assert!(
                !needs_remux(Path::new(&format!("C:\\a.{ext}"))),
                "{ext} plays natively"
            );
        }
        assert!(!needs_remux(Path::new("C:\\no-extension")));
    }

    #[test]
    fn the_cache_key_tracks_content_changes() {
        let dir = temp_dir("key");
        let a = dir.join("a.flv");
        let b = dir.join("b.flv");
        std::fs::write(&a, b"first").expect("write");
        std::fs::write(&b, b"first").expect("write");

        let key_a = cache_target(&a, &dir).expect("key");
        let key_b = cache_target(&b, &dir).expect("key");
        assert_ne!(key_a, key_b, "different files must not share a cache entry");
        assert_eq!(key_a, cache_target(&a, &dir).expect("key"), "stable");

        // A rewritten file (different size) gets a new key, so a stale copy can
        // never be served for it.
        std::fs::write(&a, b"second, longer").expect("rewrite");
        assert_ne!(key_a, cache_target(&a, &dir).expect("key"));
    }

    #[test]
    fn a_missing_file_is_left_to_the_video_element() {
        let dir = temp_dir("missing");
        let missing = dir.join("gone.flv");
        let prepared = prepare(&missing, &dir).expect("no error for a missing file");
        assert_eq!(prepared.path, missing.to_string_lossy());
        assert!(!prepared.remuxed);
    }

    #[test]
    fn playable_containers_are_returned_untouched() {
        let dir = temp_dir("plain");
        let file = dir.join("a.mp4");
        std::fs::write(&file, b"not really an mp4").expect("write");
        let prepared = prepare(&file, &dir).expect("no conversion");
        assert_eq!(prepared.path, file.to_string_lossy());
        assert!(!prepared.remuxed);
    }

    #[test]
    fn pruning_drops_the_oldest_entries_first() {
        let dir = temp_dir("prune");
        let payload = vec![0u8; 1024];
        let mut written = Vec::new();
        for name in ["old.mp4", "mid.mp4", "new.mp4"] {
            let path = dir.join(name);
            std::fs::write(&path, &payload).expect("write");
            // Distinct mtimes: the prune orders by them.
            std::thread::sleep(Duration::from_millis(20));
            written.push(path);
        }
        // 2.5 KiB fits two entries, so the oldest must go and the file we just
        // produced must survive.
        prune_to(&dir, &written[2], 2_500);
        assert!(!written[0].exists(), "the oldest entry should be evicted");
        assert!(written[2].exists(), "the entry just produced must survive");
        assert!(written[1].exists());
    }
}

//! "Continue watching" thumbnails: the frame a video was last left on, as a
//! small JPEG in `<app cache>/thumbs`.
//!
//! Files, not the webview's localStorage: the capture that matters most is
//! the one taken while the window closes, and a localStorage write made in
//! that moment never reached disk (WebView2 commits DOM storage lazily, and the
//! process is gone first). Here the frontend awaits the write before letting
//! the window close.

use std::fs;
use std::path::{Path, PathBuf};
use tauri::Manager;

/// Thumbnails kept; the least recently written are deleted past this.
const THUMB_MAX: usize = 12;

/// FNV-1a: a file name that stays the same across builds (std's hasher is
/// not guaranteed to).
fn file_name(key: &str) -> String {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in key.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x0100_0000_01b3);
    }
    format!("{hash:016x}.jpg")
}

fn thumbs_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_cache_dir()
        .map_err(|e| format!("无法定位缓存目录: {e}"))?
        .join("thumbs"))
}

/// Delete the oldest `.jpg` files past `max`.
fn prune(dir: &Path, max: usize) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    let mut files: Vec<(std::time::SystemTime, PathBuf)> = entries
        .filter_map(Result::ok)
        .map(|e| e.path())
        .filter(|p| p.extension().and_then(|e| e.to_str()) == Some("jpg"))
        .filter_map(|p| {
            let modified = fs::metadata(&p).and_then(|m| m.modified()).ok()?;
            Some((modified, p))
        })
        .collect();
    if files.len() <= max {
        return;
    }
    files.sort_by(|a, b| b.0.cmp(&a.0));
    for (_, path) in files.into_iter().skip(max) {
        let _ = fs::remove_file(path);
    }
}

fn save(dir: &Path, key: &str, data: &[u8]) -> Result<(), String> {
    fs::create_dir_all(dir).map_err(|e| format!("无法创建缩略图目录: {e}"))?;
    let target = dir.join(file_name(key));
    // Write-then-rename: a close mid-write never leaves a torn JPEG behind.
    let tmp = target.with_extension("jpg.tmp");
    fs::write(&tmp, data).map_err(|e| format!("写入缩略图失败: {e}"))?;
    fs::rename(&tmp, &target).map_err(|e| format!("写入缩略图失败: {e}"))?;
    prune(dir, THUMB_MAX);
    Ok(())
}

#[tauri::command]
pub async fn thumb_save(app: tauri::AppHandle, key: String, data: Vec<u8>) -> Result<(), String> {
    let dir = thumbs_dir(&app)?;
    tauri::async_runtime::spawn_blocking(move || save(&dir, &key, &data))
        .await
        .map_err(|e| format!("缩略图任务失败: {e}"))?
}

#[tauri::command]
pub async fn thumb_load(app: tauri::AppHandle, key: String) -> Result<Option<Vec<u8>>, String> {
    let path = thumbs_dir(&app)?.join(file_name(&key));
    Ok(fs::read(path).ok())
}

#[tauri::command]
pub async fn thumb_delete(app: tauri::AppHandle, key: String) -> Result<(), String> {
    let path = thumbs_dir(&app)?.join(file_name(&key));
    let _ = fs::remove_file(path);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("danmaku-thumbs-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn file_name_is_stable_and_distinct() {
        assert_eq!(file_name("C:\\a.mkv"), file_name("C:\\a.mkv"));
        assert_ne!(file_name("C:\\a.mkv"), file_name("C:\\b.mkv"));
        assert!(file_name("x").ends_with(".jpg"));
    }

    #[test]
    fn save_overwrites_and_prunes_the_oldest() {
        let dir = temp_dir("prune");
        for i in 0..(THUMB_MAX + 3) {
            save(&dir, &format!("video-{i}"), &[i as u8]).unwrap();
            // mtime resolution: keep the order unambiguous.
            std::thread::sleep(std::time::Duration::from_millis(15));
        }
        save(&dir, "video-0", &[42]).unwrap();
        let count = fs::read_dir(&dir).unwrap().count();
        assert_eq!(count, THUMB_MAX);
        // The newest survive; video-0 was rewritten last, so it is kept too.
        assert_eq!(fs::read(dir.join(file_name("video-0"))).unwrap(), vec![42]);
        assert!(fs::read(dir.join(file_name(&format!("video-{}", THUMB_MAX + 2)))).is_ok());
        assert!(fs::read(dir.join(file_name("video-1"))).is_err());
        let _ = fs::remove_dir_all(&dir);
    }
}

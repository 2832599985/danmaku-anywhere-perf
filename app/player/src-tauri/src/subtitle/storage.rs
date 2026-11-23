//! Where the subtitle pipeline keeps its bulk data: models (~3 GB), sidecar
//! runtimes (up to ~1.2 GB with CUDA) and the per-video subtitle cache.
//!
//! NOT under `%APPDATA%` by default: on a typical machine that is the system
//! drive, which is exactly the drive with no room left (the user's C: was
//! full). The default is chosen ONCE and then persisted, so a later change in
//! free space can never silently move the models out from under the app:
//!   1. the drive the exe lives on, when that is not C:
//!   2. else the fixed non-C drive with the most free space
//!   3. else (single-drive machine) `app_data_dir`
//! as `<drive>:\DanmakuPlayerData`. The settings page can point it elsewhere.
//!
//! The choice itself (a few bytes) lives in `app_config_dir/subtitle-data-dir.txt`.
//! `DANMAKU_PLAYER_DATA_DIR` overrides everything (tests, dev machines).

use std::path::{Path, PathBuf};

use tauri::Manager;

const POINTER_FILE: &str = "subtitle-data-dir.txt";
const DIR_NAME: &str = "DanmakuPlayerData";
pub const ENV_OVERRIDE: &str = "DANMAKU_PLAYER_DATA_DIR";

fn pointer_file(app: &tauri::AppHandle) -> Option<PathBuf> {
    app.path().app_config_dir().ok().map(|d| d.join(POINTER_FILE))
}

/// The active data directory (created on demand).
pub fn data_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = if let Some(dir) = std::env::var_os(ENV_OVERRIDE).filter(|v| !v.is_empty()) {
        PathBuf::from(dir)
    } else if let Some(saved) = pointer_file(app)
        .and_then(|p| std::fs::read_to_string(p).ok())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
    {
        PathBuf::from(saved)
    } else {
        let chosen = default_data_dir(app)?;
        // Persist the first choice: free space changes, the location must not.
        persist(app, &chosen);
        chosen
    };
    std::fs::create_dir_all(&dir).map_err(|e| format!("创建数据目录失败 {}: {e}", dir.display()))?;
    Ok(dir)
}

fn persist(app: &tauri::AppHandle, dir: &Path) {
    if let Some(file) = pointer_file(app) {
        if let Some(parent) = file.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let _ = std::fs::write(file, dir.to_string_lossy().as_bytes());
    }
}

/// Point the pipeline at a new directory. Existing files are NOT moved (the
/// settings page says so); the caller re-reads the asset status afterwards.
pub fn set_data_dir(app: &tauri::AppHandle, dir: &str) -> Result<PathBuf, String> {
    let dir = PathBuf::from(dir.trim());
    if !dir.is_absolute() {
        return Err("数据目录必须是绝对路径".to_string());
    }
    std::fs::create_dir_all(&dir).map_err(|e| format!("无法使用该目录: {e}"))?;
    persist(app, &dir);
    Ok(dir)
}

/// The directory the app would pick on a fresh install (see module docs).
pub fn default_data_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    if let Some(letter) = std::env::current_exe().ok().as_deref().and_then(drive_letter) {
        if letter != 'C' {
            return Ok(PathBuf::from(format!("{letter}:\\{DIR_NAME}")));
        }
    }
    if let Some(letter) = roomiest_fixed_drive() {
        return Ok(PathBuf::from(format!("{letter}:\\{DIR_NAME}")));
    }
    app.path()
        .app_data_dir()
        .map(|d| d.join(DIR_NAME))
        .map_err(|e| format!("无法解析数据目录: {e}"))
}

fn drive_letter(path: &Path) -> Option<char> {
    let s = path.to_str()?;
    let mut chars = s.chars();
    let letter = chars.next()?.to_ascii_uppercase();
    (letter.is_ascii_alphabetic() && chars.next() == Some(':')).then_some(letter)
}

/// Free bytes on the volume holding `path` (None when unknown).
#[cfg(windows)]
pub fn free_bytes(path: &Path) -> Option<u64> {
    use windows::core::HSTRING;
    use windows::Win32::Storage::FileSystem::GetDiskFreeSpaceExW;
    // The API wants an existing directory; walk up until one exists.
    let mut probe = path.to_path_buf();
    while !probe.exists() {
        probe = probe.parent()?.to_path_buf();
    }
    let mut free: u64 = 0;
    // SAFETY: valid NUL-terminated wide string; out-pointer to a local.
    unsafe { GetDiskFreeSpaceExW(&HSTRING::from(probe.as_os_str()), Some(&mut free), None, None) }
        .ok()?;
    Some(free)
}

#[cfg(not(windows))]
pub fn free_bytes(_path: &Path) -> Option<u64> {
    None
}

#[cfg(windows)]
fn roomiest_fixed_drive() -> Option<char> {
    use windows::core::HSTRING;
    use windows::Win32::Storage::FileSystem::GetDriveTypeW;
    const DRIVE_FIXED: u32 = 3;
    ('D'..='Z')
        .filter(|letter| {
            let root = format!("{letter}:\\");
            // SAFETY: valid NUL-terminated wide string.
            unsafe { GetDriveTypeW(&HSTRING::from(root.as_str())) == DRIVE_FIXED }
        })
        .filter_map(|letter| free_bytes(Path::new(&format!("{letter}:\\"))).map(|f| (letter, f)))
        // Below 8 GB the drive cannot hold the models anyway.
        .filter(|(_, free)| *free > 8 * 1024 * 1024 * 1024)
        .max_by_key(|(_, free)| *free)
        .map(|(letter, _)| letter)
}

#[cfg(not(windows))]
fn roomiest_fixed_drive() -> Option<char> {
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn drive_letter_parses_windows_paths_only() {
        assert_eq!(drive_letter(Path::new(r"d:\Apps\player.exe")), Some('D'));
        assert_eq!(drive_letter(Path::new(r"C:\x")), Some('C'));
        assert_eq!(drive_letter(Path::new(r"\\server\share\x")), None);
        assert_eq!(drive_letter(Path::new("relative")), None);
    }
}

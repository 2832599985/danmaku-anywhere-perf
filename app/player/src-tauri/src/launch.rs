//! Files handed to the exe on its command line — Explorer's 「打开方式」 /
//! file association passes `"<exe>" "<path>"`.
//!
//! - First instance: the paths are parked in [`LaunchFiles`] and the page takes
//!   them once it is ready (`launch_files_take`); emitting at setup time would
//!   fire before the page has a listener.
//! - Already running: the single-instance plugin hands the second launch's
//!   argv to [`forward`], which emits `open-files` to the live window and
//!   brings it to the front instead of opening a second player.

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use tauri::{AppHandle, Emitter, Manager};

#[derive(Default)]
pub struct LaunchFiles(Mutex<Vec<String>>);

impl LaunchFiles {
    pub fn new(paths: Vec<String>) -> Self {
        Self(Mutex::new(paths))
    }
}

/// Existing files among `args` (argv without the exe), resolved against `cwd`.
/// Flags (`--foo`) and anything that is not a file are ignored.
pub fn files_from_args<I: IntoIterator<Item = String>>(args: I, cwd: &Path) -> Vec<String> {
    args.into_iter()
        .filter(|arg| !arg.starts_with('-'))
        .map(|arg| {
            let path = PathBuf::from(&arg);
            if path.is_absolute() {
                path
            } else {
                cwd.join(path)
            }
        })
        .filter(|path| path.is_file())
        .map(|path| path.to_string_lossy().into_owned())
        .collect()
}

/// The first instance's command-line files; empty on every later call.
#[tauri::command]
pub fn launch_files_take(state: tauri::State<'_, LaunchFiles>) -> Vec<String> {
    std::mem::take(&mut *state.0.lock().unwrap_or_else(|e| e.into_inner()))
}

/// A second launch while running: open its files here and surface the window.
pub fn forward(app: &AppHandle, argv: Vec<String>, cwd: String) {
    let files = files_from_args(argv.into_iter().skip(1), Path::new(&cwd));
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
    if !files.is_empty() {
        let _ = app.emit_to("main", "open-files", files);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_existing_files_and_drops_flags_and_missing() {
        let dir = std::env::temp_dir().join("danmaku-launch-test");
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("ep1.mkv");
        std::fs::write(&file, b"x").unwrap();

        let got = files_from_args(
            [
                "--flag".to_string(),
                "ep1.mkv".to_string(),
                file.to_string_lossy().into_owned(),
                "missing.mkv".to_string(),
                dir.to_string_lossy().into_owned(),
            ],
            &dir,
        );
        assert_eq!(got.len(), 2);
        assert!(got.iter().all(|p| p.ends_with("ep1.mkv")));
        std::fs::remove_dir_all(&dir).unwrap();
    }
}

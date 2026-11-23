//! Subtitle pipeline diagnostics: append-only log file so a "no subtitles"
//! report can be pinpointed from the exact hop that dropped it (frontend
//! decision, model resolve, ffmpeg spawn, segment announce, cue emit, mount).
//! Written to Tauri's app_log_dir/subtitle.log; every line is timestamped.

use std::fs::OpenOptions;
use std::io::Write;
use std::path::PathBuf;
use std::sync::Mutex;
use std::sync::OnceLock;
use std::time::{SystemTime, UNIX_EPOCH};

static LOG_PATH: OnceLock<PathBuf> = OnceLock::new();
static LOCK: Mutex<()> = Mutex::new(());

/// UTC timestamp, no external deps (Hinnant's civil-from-days, 10 lines).
fn stamp() -> String {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    let secs = now.as_secs();
    let ms = now.subsec_millis();
    let days = (secs / 86_400) as i64;
    let tod = secs % 86_400;
    // civil-from-days
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    format!("{y:04}-{m:02}-{d:02} {h:02}:{mi:02}:{s:02}.{ms:03}",
        h = tod / 3600, mi = (tod % 3600) / 60, s = tod % 60)
}

/// Resolve the log path once at startup.
pub fn init(app: &tauri::AppHandle) {
    use tauri::Manager;
    if let Ok(dir) = app.path().app_log_dir() {
        let _ = std::fs::create_dir_all(&dir);
        let _ = LOG_PATH.set(dir.join("subtitle.log"));
    }
}

/// Append one line. Never panics, never blocks long: diagnostics must not be
/// able to take the pipeline down (panic=abort profile!).
pub fn write(line: &str) {
    let Some(path) = LOG_PATH.get() else { return };
    let Ok(_guard) = LOCK.lock() else { return };
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(file, "[{}] {}", stamp(), line);
    }
}

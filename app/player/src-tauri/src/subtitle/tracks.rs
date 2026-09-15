//! Embedded subtitle tracks: list the subtitle streams inside a container and
//! convert one of them to SRT text.
//!
//! Why this exists at all: the webview cannot see them. `<video>` exposes only
//! WebVTT text tracks that were mounted as a sidecar `<track>` element, so a
//! subtitle stream inside Matroska / MP4 / WebM is invisible to it, in every
//! Chromium-based host. The tracks have to be demuxed outside the webview and
//! fed to the cue pipeline the player already has.
//!
//! Same binaries as the ASR pipeline ([`super::audio::resolve_ffmpeg`]): ffmpeg
//! next to the executable, then PATH. `resolve_ffprobe` also looks in the
//! resolved ffmpeg's own directory — winget/build layouts ship the pair
//! together, so a PATH ffmpeg implies a PATH ffprobe next to it.
//!
//!   - `subtitle_list_tracks` — `ffprobe -select_streams s` → index, codec,
//!     language, title, disposition. Bitmap codecs (PGS/VobSub/DVB) are listed
//!     with `text: false` so the UI can say "图形字幕，暂不支持" instead of
//!     pretending the file carries no subtitles.
//!   - `subtitle_extract_track` — `ffmpeg -map 0:<index> -f srt -` → SRT on
//!     stdout, which `parseSubtitleText` already understands. Text codecs
//!     (subrip / ass / ssa / mov_text / webvtt / …) all convert; bitmaps error
//!     out rather than mounting an empty cue list.

use std::path::PathBuf;
use std::process::Command;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

use super::audio;

/// Subtitle codecs whose streams carry TEXT. Everything else the container can
/// hold (hdmv_pgs_subtitle, dvd_subtitle, dvb_subtitle, xsub, …) is a bitmap
/// and would need OCR.
const TEXT_CODECS: &[&str] = &[
    "subrip",
    "srt",
    "ass",
    "ssa",
    "mov_text",
    "webvtt",
    "text",
    "subviewer",
    "subviewer1",
    "microdvd",
    "mpl2",
    "realtext",
    "sami",
    "stl",
    "jacosub",
    "vplayer",
    "pjs",
];

/// Upper bound on cached probe results (one episode each; probing is cheap but
/// this spares the ffprobe spawn on every settings render).
const TRACKS_CACHE: usize = 8;
/// Upper bound on cached conversions — each entry is a whole episode's SRT, so
/// this stays small: only the track(s) actually looked at.
const EXTRACT_CACHE: usize = 4;

/// One subtitle stream inside the container.
#[derive(Clone, Debug, Serialize)]
pub struct SubtitleTrack {
    /// Absolute stream index, exactly what `-map 0:<index>` wants.
    pub index: u32,
    /// ffmpeg codec name (`subrip`, `ass`, `hdmv_pgs_subtitle`, …).
    pub codec: String,
    /// ISO/639-2 tag as stored (`chi`, `jpn`, `eng`), when present.
    pub language: Option<String>,
    /// Stream title — fansub groups put 简体/繁体/English here.
    pub title: Option<String>,
    /// false = bitmap subtitles: listed, but not convertible to text.
    pub text: bool,
    /// ffmpeg's `default` disposition.
    pub default: bool,
    /// ffmpeg's `forced` disposition (partial translation for foreign lines).
    pub forced: bool,
}

#[derive(Deserialize)]
struct ProbeOutput {
    #[serde(default)]
    streams: Vec<ProbeStream>,
}

#[derive(Deserialize)]
struct ProbeStream {
    index: u32,
    codec_name: Option<String>,
    #[serde(default)]
    disposition: Disposition,
    #[serde(default)]
    tags: Tags,
}

#[derive(Default, Deserialize)]
struct Disposition {
    #[serde(default)]
    default: u8,
    #[serde(default)]
    forced: u8,
}

#[derive(Default, Deserialize)]
struct Tags {
    language: Option<String>,
    title: Option<String>,
}

/// `ffprobe.exe` on Windows, `ffprobe` elsewhere.
fn ffprobe_name() -> &'static str {
    if cfg!(windows) {
        "ffprobe.exe"
    } else {
        "ffprobe"
    }
}

/// Locate the ffprobe binary: next to the executable (the sidecar location),
/// then next to a resolved ffmpeg, then PATH.
pub fn resolve_ffprobe() -> Result<PathBuf, String> {
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let candidate = dir.join(ffprobe_name());
            if candidate.is_file() {
                return Ok(candidate);
            }
        }
    }
    if let Ok(ffmpeg) = audio::resolve_ffmpeg() {
        // A bare "ffmpeg" (PATH lookup) has an empty parent — nothing to probe.
        if let Some(dir) = ffmpeg.parent().filter(|d| !d.as_os_str().is_empty()) {
            let candidate = dir.join(ffprobe_name());
            if candidate.is_file() {
                return Ok(candidate);
            }
        }
    }
    Ok(PathBuf::from("ffprobe"))
}

#[cfg(windows)]
fn hide_console(command: &mut Command) {
    command.creation_flags(audio::CREATE_NO_WINDOW);
}

#[cfg(not(windows))]
fn hide_console(_command: &mut Command) {}

/// Trim/lower-case a tag, treating blank and `und` (undetermined) as absent.
fn clean_tag(value: Option<String>) -> Option<String> {
    let value = value?.trim().to_lowercase();
    if value.is_empty() || value == "und" {
        None
    } else {
        Some(value)
    }
}

/// Probe results, keyed by (path, 0) — the index is always 0 here, it exists
/// only so both caches can share one helper.
static TRACKS_FOUND: Mutex<Vec<((String, u32), Vec<SubtitleTrack>)>> = Mutex::new(Vec::new());
/// Converted SRT text, keyed by (path, stream index).
static EXTRACTED: Mutex<Vec<((String, u32), String)>> = Mutex::new(Vec::new());

/// Newest-first lookup that also refreshes recency.
fn cached<K: PartialEq, V: Clone>(cache: &Mutex<Vec<(K, V)>>, key: &K) -> Option<V> {
    let mut guard = cache.lock().unwrap_or_else(|p| p.into_inner());
    let position = guard.iter().position(|(k, _)| k == key)?;
    let entry = guard.remove(position);
    let value = entry.1.clone();
    guard.insert(0, entry);
    Some(value)
}

fn remember<K: PartialEq, V>(cache: &Mutex<Vec<(K, V)>>, key: K, value: V, cap: usize) {
    let mut guard = cache.lock().unwrap_or_else(|p| p.into_inner());
    guard.retain(|(k, _)| *k != key);
    guard.insert(0, (key, value));
    guard.truncate(cap);
}

/// Probe the container for subtitle streams (cached). Never fails because the
/// file has none — an empty list is a valid answer.
pub fn list_tracks(path: &str) -> Result<Vec<SubtitleTrack>, String> {
    let path = path.trim();
    if path.is_empty() {
        return Err("缺少视频路径".to_string());
    }
    let key = (path.to_string(), 0u32);
    if let Some(tracks) = cached(&TRACKS_FOUND, &key) {
        return Ok(tracks);
    }

    let probe = resolve_ffprobe()?;
    let mut command = Command::new(&probe);
    command.args([
        "-v",
        "error",
        "-select_streams",
        "s",
        // NOTE: the disposition section must be spelled `stream_disposition`.
        // Asking for `disposition` inside `stream=` is silently ignored —
        // ffprobe emits no error and no field, so `default`/`forced` would read
        // as "false" for every track with no way to tell.
        "-show_entries",
        "stream=index,codec_name:stream_disposition:stream_tags=language,title",
        "-of",
        "json",
        path,
    ]);
    hide_console(&mut command);
    let output = command
        .output()
        .map_err(|e| format!("无法运行 ffprobe（{}）: {e}", probe.display()))?;
    if !output.status.success() {
        let detail = String::from_utf8_lossy(&output.stderr);
        return Err(format!("ffprobe 读取失败: {}", detail.trim()));
    }
    let parsed: ProbeOutput = serde_json::from_slice(&output.stdout)
        .map_err(|e| format!("ffprobe 输出无法解析: {e}"))?;

    let tracks: Vec<SubtitleTrack> = parsed
        .streams
        .into_iter()
        .map(|stream| {
            let codec = stream.codec_name.unwrap_or_default();
            SubtitleTrack {
                index: stream.index,
                text: TEXT_CODECS.contains(&codec.as_str()),
                codec,
                language: clean_tag(stream.tags.language),
                title: stream.tags.title.map(|t| t.trim().to_string()),
                default: stream.disposition.default == 1,
                forced: stream.disposition.forced == 1,
            }
        })
        .collect();

    remember(&TRACKS_FOUND, key, tracks.clone(), TRACKS_CACHE);
    Ok(tracks)
}

/// Convert one subtitle stream to SRT text (cached by path + stream index).
pub fn extract_track(path: &str, index: u32) -> Result<String, String> {
    let path = path.trim();
    if path.is_empty() {
        return Err("缺少视频路径".to_string());
    }
    // Refuse bitmap tracks up front: letting ffmpeg fail would surface its
    // "Subtitle encoding currently only possible from text to text" wording.
    if let Some(track) = list_tracks(path)?.into_iter().find(|t| t.index == index) {
        if !track.text {
            return Err(format!(
                "这条是图形字幕（{}），需要 OCR 才能转成文字，暂不支持",
                track.codec
            ));
        }
    }

    let key = (path.to_string(), index);
    if let Some(text) = cached(&EXTRACTED, &key) {
        return Ok(text);
    }

    let ffmpeg = audio::resolve_ffmpeg()?;
    let mut command = Command::new(&ffmpeg);
    command.args([
        "-v",
        "error",
        "-nostdin",
        "-i",
        path,
        "-map",
        &format!("0:{index}"),
        "-f",
        "srt",
        "-",
    ]);
    hide_console(&mut command);
    let output = command
        .output()
        .map_err(|e| format!("无法运行 ffmpeg（{}）: {e}", ffmpeg.display()))?;
    if !output.status.success() {
        let detail = String::from_utf8_lossy(&output.stderr);
        return Err(format!("字幕提取失败: {}", detail.trim()));
    }
    let text = String::from_utf8_lossy(&output.stdout)
        .trim_start_matches('\u{feff}')
        .to_string();
    if text.trim().is_empty() {
        return Err("这条字幕轨是空的".to_string());
    }
    remember(&EXTRACTED, key, text.clone(), EXTRACT_CACHE);
    Ok(text)
}

#[tauri::command]
pub async fn subtitle_list_tracks(path: String) -> Result<Vec<SubtitleTrack>, String> {
    tauri::async_runtime::spawn_blocking(move || list_tracks(&path))
        .await
        .map_err(|e| format!("字幕轨道任务失败: {e}"))?
}

#[tauri::command]
pub async fn subtitle_extract_track(path: String, index: u32) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || extract_track(&path, index))
        .await
        .map_err(|e| format!("字幕提取任务失败: {e}"))?
}

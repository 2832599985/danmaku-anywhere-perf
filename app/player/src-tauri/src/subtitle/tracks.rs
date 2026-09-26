//! Embedded subtitle tracks: list the subtitle streams inside a container and
//! read them out as text.
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
//!   - `subtitle_extract_track` — one stream as text: ASS/SSA streams are
//!     copied out as an ASS script (their styles, `\pos` signs and margins are
//!     the point of them), everything else (subrip / mov_text / webvtt / …) is
//!     converted to SRT. Bitmaps error out rather than mounting an empty cue
//!     list. An optional `span` reads only the minutes around the playhead:
//!     subtitle packets are interleaved through the whole file, so a whole
//!     track costs a read of every byte of it — about a second for a 1 GB
//!     episode on an NVMe drive, many seconds on a hard disk or a share —
//!     while a span of a dialogue track costs a fraction of that. The
//!     frontend shows the span first, then swaps in the whole track.
//!     A whole-track read extracts EVERY text track of the file in the same
//!     pass (the cost is the read, not the number of outputs), so switching
//!     to another track afterwards is answered from the cache.
//!   - `subtitle_extract_cancel` — the frontend opened another file: kill the
//!     extractions still reading the old one instead of letting them compete
//!     with the new video for the disk.
//!
//! Timestamps are kept exactly as the container stores them (`-copyts`):
//! Chromium's `<video>` clock does not rebase them to zero either, so for a
//! file whose first packet is not at 0 a rebased track would run early by
//! that amount.

use std::io::Read;
use std::path::PathBuf;
use std::process::{Command, Output, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};

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
/// Upper bound on cached whole tracks. One read fills an entry per text track
/// of the file (fansub releases carry two or three); each is 50–200 KB.
const EXTRACT_CACHE: usize = 12;
/// Deadline for one ffprobe run. A local probe takes ~50 ms; this only bites
/// when the process is wedged (unreachable network share, a stuck scanner).
const PROBE_TIMEOUT: Duration = Duration::from_secs(20);
/// Deadline for reading a span (a couple of minutes of the file).
const SPAN_TIMEOUT: Duration = Duration::from_secs(30);
/// Deadline for reading a whole track. It runs in the background once a span
/// is on screen, and has to read every byte of the file: ~1 s for a 1 GB
/// episode on NVMe, but minutes for a 4 GB rip on a slow share.
const EXTRACT_TIMEOUT: Duration = Duration::from_secs(600);
/// Extra seconds read past a span's end: the read starts at the keyframe at or
/// before `start`, and a cue can straddle the end.
const SPAN_MARGIN_SECS: f64 = 5.0;

/// The file the player has open, as announced by `subtitle_extract_focus`.
/// Reads of any OTHER file are killed: once the user has moved on, finishing
/// them only competes with the new video for the same disk. Empty = no focus
/// announced (tests, first launch): nothing is cancelled.
static FOCUS: Mutex<String> = Mutex::new(String::new());

/// Serializes whole-track reads. Two of them would read the same file start
/// to end side by side (the open-time read and a pick in the track list); the
/// second one waits and then finds its track in the cache.
static FULL_EXTRACTION: Mutex<()> = Mutex::new(());

/// Distinguishes the temp directories of whole-track reads.
static TEMP_SEQUENCE: AtomicU64 = AtomicU64::new(0);

/// Stretch of the media timeline to read (seconds, the `<video>` clock).
#[derive(Clone, Copy, Debug, Deserialize)]
pub struct ExtractSpan {
    pub start: f64,
    pub end: f64,
}

/// What one extraction produced.
#[derive(Clone, Debug, Serialize)]
pub struct ExtractedTrack {
    /// The subtitle text: an ASS script or SRT, per `format`.
    pub text: String,
    /// `"ass"` or `"srt"` — which reader the frontend should use.
    pub format: &'static str,
    /// false = only the requested span was read; the full track is still to
    /// be fetched.
    pub complete: bool,
}

/// How a stream is best carried to the frontend.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum TrackFormat {
    /// Copied verbatim as an ASS script (styles, positions, margins intact).
    Ass,
    /// Converted to SubRip.
    Srt,
}

impl TrackFormat {
    fn for_codec(codec: &str) -> Self {
        if codec == "ass" || codec == "ssa" {
            TrackFormat::Ass
        } else {
            TrackFormat::Srt
        }
    }

    fn name(self) -> &'static str {
        match self {
            TrackFormat::Ass => "ass",
            TrackFormat::Srt => "srt",
        }
    }

    /// ffmpeg output options that produce this format.
    fn output_args(self) -> [&'static str; 4] {
        match self {
            // Stream copy: the script comes out exactly as muxed.
            TrackFormat::Ass => ["-c:s", "copy", "-f", "ass"],
            TrackFormat::Srt => ["-c:s", "srt", "-f", "srt"],
        }
    }
}

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

/// Run a command to completion, killing it when `timeout` passes.
///
/// `Command::output()` has no deadline: a wedged ffprobe/ffmpeg would leave
/// the picker saying "提取中…" forever and the file's subtitles never
/// arriving. Stdout and stderr are drained on their own threads so a large
/// SRT cannot fill the pipe and deadlock the child while we poll it.
/// `cancelled` is polled alongside the deadline; when it returns true the
/// child is killed and the call fails with [`audio::CANCELLED`].
fn run_with_timeout(
    mut command: Command,
    name: &str,
    timeout: Duration,
    cancelled: &dyn Fn() -> bool,
) -> Result<Output, String> {
    hide_console(&mut command);
    command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = command
        .spawn()
        .map_err(|e| format!("无法运行 {name}: {e}"))?;
    let drain = |pipe: Option<Box<dyn Read + Send>>| {
        thread::spawn(move || {
            let mut bytes = Vec::new();
            if let Some(mut pipe) = pipe {
                let _ = pipe.read_to_end(&mut bytes);
            }
            bytes
        })
    };
    let stdout = drain(
        child
            .stdout
            .take()
            .map(|p| Box::new(p) as Box<dyn Read + Send>),
    );
    let stderr = drain(
        child
            .stderr
            .take()
            .map(|p| Box::new(p) as Box<dyn Read + Send>),
    );

    let started = Instant::now();
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if cancelled() => {
                let _ = child.kill();
                let _ = child.wait();
                let _ = stdout.join();
                let _ = stderr.join();
                return Err(audio::CANCELLED.to_string());
            }
            Ok(None) if started.elapsed() >= timeout => {
                let _ = child.kill();
                let _ = child.wait();
                // The pipes close with the process, so the drain threads end.
                let _ = stdout.join();
                let _ = stderr.join();
                return Err(format!(
                    "{name} 超过 {} 秒没有结束，已中止",
                    timeout.as_secs()
                ));
            }
            Ok(None) => thread::sleep(Duration::from_millis(20)),
            Err(e) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(format!("等待 {name} 失败: {e}"));
            }
        }
    };
    Ok(Output {
        status,
        stdout: stdout.join().unwrap_or_default(),
        stderr: stderr.join().unwrap_or_default(),
    })
}

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
/// Whole converted tracks, keyed by (path, stream index). Spans are never
/// cached: they are superseded by the full track a moment later.
static EXTRACTED: Mutex<Vec<((String, u32), ExtractedTrack)>> = Mutex::new(Vec::new());

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
    let output = run_with_timeout(
        command,
        &format!("ffprobe（{}）", probe.display()),
        PROBE_TIMEOUT,
        &|| out_of_focus(path),
    )?;
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

/// True when the player has moved on to another file than `path`.
fn out_of_focus(path: &str) -> bool {
    let focus = FOCUS.lock().unwrap_or_else(|p| p.into_inner());
    is_other_file(&focus, path)
}

/// `focus` names a file and it is not `path` (no focus cancels nothing).
fn is_other_file(focus: &str, path: &str) -> bool {
    !focus.is_empty() && focus != path
}

/// ffmpeg arguments that read `span` of one stream to stdout.
fn span_args(path: &str, index: u32, format: TrackFormat, span: ExtractSpan) -> Vec<String> {
    let start = span.start.max(0.0);
    let stop = span.end.max(start + 1.0);
    let mut args: Vec<String> = vec![
        "-v".into(),
        "error".into(),
        "-nostdin".into(),
        "-copyts".into(),
        // `-seek_timestamp` makes `-ss` an absolute timestamp, the clock the
        // cues come out in (`-copyts`); otherwise it is relative to the file's
        // start time. The input `-t` bounds how much of the file is READ —
        // without it a sparse track would be scanned to the end.
        "-seek_timestamp".into(),
        "1".into(),
        "-ss".into(),
        format!("{start:.3}"),
        "-t".into(),
        format!("{:.3}", stop - start + SPAN_MARGIN_SECS),
        "-i".into(),
        path.into(),
        "-map".into(),
        format!("0:{index}"),
        "-to".into(),
        format!("{stop:.3}"),
    ];
    args.extend(format.output_args().map(String::from));
    args.push("-".into());
    args
}

/// ffmpeg arguments that write every stream in `outputs` to its own file in
/// ONE read of the input: the cost of a whole-track read is reading the file,
/// not the number of tracks taken out of it.
fn full_args(path: &str, outputs: &[(u32, TrackFormat, PathBuf)]) -> Vec<String> {
    let mut args: Vec<String> = vec![
        "-v".into(),
        "error".into(),
        "-nostdin".into(),
        "-y".into(),
        "-copyts".into(),
        "-i".into(),
        path.into(),
    ];
    for (index, format, file) in outputs {
        args.push("-map".into());
        args.push(format!("0:{index}"));
        args.extend(format.output_args().map(String::from));
        args.push(file.to_string_lossy().into_owned());
    }
    args
}

/// Subtitle text as ffmpeg wrote it (UTF-8; a BOM is not part of the text).
fn subtitle_text(bytes: &[u8]) -> String {
    String::from_utf8_lossy(bytes)
        .trim_start_matches('\u{feff}')
        .to_string()
}

/// Read `span` of one stream. Never cached: the whole track replaces it a
/// moment later.
fn extract_span(
    path: &str,
    index: u32,
    format: TrackFormat,
    span: ExtractSpan,
) -> Result<ExtractedTrack, String> {
    let ffmpeg = audio::resolve_ffmpeg()?;
    let mut command = Command::new(&ffmpeg);
    command.args(span_args(path, index, format, span));
    let output = run_with_timeout(
        command,
        &format!("ffmpeg（{}）", ffmpeg.display()),
        SPAN_TIMEOUT,
        &|| out_of_focus(path),
    )?;
    if !output.status.success() {
        let detail = String::from_utf8_lossy(&output.stderr);
        return Err(format!("字幕提取失败: {}", detail.trim()));
    }
    // An empty span only means nobody speaks in these minutes.
    Ok(ExtractedTrack {
        text: subtitle_text(&output.stdout),
        format: format.name(),
        complete: false,
    })
}

/// Read every text track of the file in one pass and cache each of them;
/// return the one asked for.
fn extract_all(path: &str, index: u32, tracks: &[SubtitleTrack]) -> Result<ExtractedTrack, String> {
    let key = (path.to_string(), index);
    // Serialize whole-file reads; whoever waited finds the cache filled.
    let _turn = FULL_EXTRACTION.lock().unwrap_or_else(|p| p.into_inner());
    if let Some(done) = cached(&EXTRACTED, &key) {
        return Ok(done);
    }
    if out_of_focus(path) {
        return Err(audio::CANCELLED.to_string());
    }

    let dir = std::env::temp_dir().join(format!(
        "danmaku-player-subs-{}-{}",
        std::process::id(),
        TEMP_SEQUENCE.fetch_add(1, Ordering::Relaxed)
    ));
    std::fs::create_dir_all(&dir).map_err(|e| format!("无法创建临时目录: {e}"))?;
    let outputs: Vec<(u32, TrackFormat, PathBuf)> = tracks
        .iter()
        .filter(|t| t.text)
        .map(|t| {
            let format = TrackFormat::for_codec(&t.codec);
            (t.index, format, dir.join(format!("{}.{}", t.index, format.name())))
        })
        .collect();
    // The requested stream is read even if the probe did not list it.
    let outputs = if outputs.iter().any(|(i, _, _)| *i == index) {
        outputs
    } else {
        let mut all = outputs;
        all.push((index, TrackFormat::Srt, dir.join(format!("{index}.srt"))));
        all
    };

    let result = (|| {
        let ffmpeg = audio::resolve_ffmpeg()?;
        let mut command = Command::new(&ffmpeg);
        command.args(full_args(path, &outputs));
        let output = run_with_timeout(
            command,
            &format!("ffmpeg（{}）", ffmpeg.display()),
            EXTRACT_TIMEOUT,
            &|| out_of_focus(path),
        )?;
        if !output.status.success() {
            let detail = String::from_utf8_lossy(&output.stderr);
            return Err(format!("字幕提取失败: {}", detail.trim()));
        }
        let mut wanted = None;
        for (stream, format, file) in &outputs {
            let Ok(bytes) = std::fs::read(file) else { continue };
            let extracted = ExtractedTrack {
                text: subtitle_text(&bytes),
                format: format.name(),
                complete: true,
            };
            if *stream == index {
                wanted = Some(extracted.clone());
            }
            if !extracted.text.trim().is_empty() {
                remember(&EXTRACTED, (path.to_string(), *stream), extracted, EXTRACT_CACHE);
            }
        }
        match wanted {
            Some(track) if !track.text.trim().is_empty() => Ok(track),
            _ => Err("这条字幕轨是空的".to_string()),
        }
    })();
    let _ = std::fs::remove_dir_all(&dir);
    result
}

/// Extract one subtitle stream: `span` = only that stretch (fast, first
/// paint), none = the whole track (cached, together with every other text
/// track of the file).
pub fn extract_track(
    path: &str,
    index: u32,
    span: Option<ExtractSpan>,
) -> Result<ExtractedTrack, String> {
    let path = path.trim();
    if path.is_empty() {
        return Err("缺少视频路径".to_string());
    }
    // A whole track already read beats any span of it.
    if let Some(done) = cached(&EXTRACTED, &(path.to_string(), index)) {
        return Ok(done);
    }
    // Refuse bitmap tracks up front: letting ffmpeg fail would surface its
    // "Subtitle encoding currently only possible from text to text" wording.
    let tracks = list_tracks(path)?;
    let track = tracks.iter().find(|t| t.index == index);
    if let Some(track) = track {
        if !track.text {
            return Err(format!(
                "这条是图形字幕（{}），需要 OCR 才能转成文字，暂不支持",
                track.codec
            ));
        }
    }
    match span {
        Some(span) => {
            let format = TrackFormat::for_codec(track.map_or("", |t| t.codec.as_str()));
            extract_span(path, index, format, span)
        }
        None => extract_all(path, index, &tracks),
    }
}

#[tauri::command]
pub async fn subtitle_list_tracks(path: String) -> Result<Vec<SubtitleTrack>, String> {
    tauri::async_runtime::spawn_blocking(move || list_tracks(&path))
        .await
        .map_err(|e| format!("字幕轨道任务失败: {e}"))?
}

#[tauri::command]
pub async fn subtitle_extract_track(
    path: String,
    index: u32,
    span: Option<ExtractSpan>,
) -> Result<ExtractedTrack, String> {
    tauri::async_runtime::spawn_blocking(move || extract_track(&path, index, span))
        .await
        .map_err(|e| format!("字幕提取任务失败: {e}"))?
}

/// The player opened `path` (or nothing, with an empty string). Probes and
/// extractions of any other file stop within one poll interval.
#[tauri::command]
pub fn subtitle_extract_focus(path: String) {
    *FOCUS.lock().unwrap_or_else(|p| p.into_inner()) = path.trim().to_string();
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Never cancel.
    fn keep_going() -> bool {
        false
    }

    /// A command that never ends on its own (Windows `ping` to an address that
    /// does not answer, long count) — the stand-in for a wedged ffmpeg.
    fn hanging_command() -> Command {
        let mut command = Command::new("ping");
        if cfg!(windows) {
            command.args(["-n", "30", "-w", "1000", "192.0.2.1"]);
        } else {
            command.args(["-c", "30", "-W", "1", "192.0.2.1"]);
        }
        command
    }

    #[test]
    fn a_wedged_process_is_killed_at_the_deadline() {
        let started = Instant::now();
        let result = run_with_timeout(
            hanging_command(),
            "ping",
            Duration::from_millis(600),
            &keep_going,
        );
        let elapsed = started.elapsed();
        let message = result.expect_err("a hung process must not be reported as success");
        assert!(message.contains("已中止"), "unexpected message: {message}");
        // Returned promptly after the deadline instead of waiting ~30 s.
        assert!(elapsed < Duration::from_secs(5), "took {elapsed:?}");
    }

    #[test]
    fn a_cancelled_process_is_killed_at_once() {
        let started = Instant::now();
        let flip = Instant::now() + Duration::from_millis(300);
        let result = run_with_timeout(hanging_command(), "ping", Duration::from_secs(30), &|| {
            Instant::now() >= flip
        });
        let elapsed = started.elapsed();
        assert_eq!(result.expect_err("cancelled"), audio::CANCELLED);
        assert!(elapsed < Duration::from_secs(3), "took {elapsed:?}");
    }

    #[test]
    fn output_of_a_finished_process_is_collected() {
        let mut command = if cfg!(windows) {
            let mut c = Command::new("cmd");
            c.args(["/C", "echo hello"]);
            c
        } else {
            let mut c = Command::new("sh");
            c.args(["-c", "echo hello"]);
            c
        };
        command.env("NO_COLOR", "1");
        let output = run_with_timeout(command, "echo", Duration::from_secs(10), &keep_going)
            .expect("echo must finish");
        assert!(output.status.success());
        assert!(String::from_utf8_lossy(&output.stdout).contains("hello"));
    }

    #[test]
    fn a_missing_binary_is_an_error_not_a_hang() {
        let command = Command::new("this-binary-does-not-exist-danmaku");
        let message = run_with_timeout(command, "nothing", Duration::from_secs(5), &keep_going)
            .expect_err("spawn failure must surface");
        assert!(message.contains("无法运行"), "unexpected message: {message}");
    }

    #[test]
    fn focus_only_cancels_other_files() {
        // Pure check: the global FOCUS is shared with the real-file tests,
        // which run in parallel and must not be cancelled by this one.
        assert!(!is_other_file("", "C:\\a.mkv"), "no focus: nothing is cancelled");
        assert!(!is_other_file("C:\\a.mkv", "C:\\a.mkv"));
        assert!(is_other_file("C:\\a.mkv", "C:\\b.mkv"));
    }

    #[test]
    fn span_arguments_seek_on_the_absolute_clock() {
        let joined = span_args(
            "C:\\v.mkv",
            3,
            TrackFormat::Ass,
            ExtractSpan { start: 590.0, end: 770.0 },
        )
        .join(" ");
        assert_eq!(
            joined,
            "-v error -nostdin -copyts -seek_timestamp 1 -ss 590.000 -t 185.000 \
             -i C:\\v.mkv -map 0:3 -to 770.000 -c:s copy -f ass -"
        );
        // A span that starts before 0 or ends before it starts is repaired.
        let odd = span_args(
            "v",
            2,
            TrackFormat::Srt,
            ExtractSpan { start: -5.0, end: -1.0 },
        )
        .join(" ");
        assert!(odd.contains("-ss 0.000 -t 6.000"), "{odd}");
        assert!(odd.ends_with("-to 1.000 -c:s srt -f srt -"), "{odd}");
    }

    #[test]
    fn a_full_read_writes_every_track_in_one_pass() {
        let outputs = vec![
            (2, TrackFormat::Srt, PathBuf::from("T/2.srt")),
            (4, TrackFormat::Ass, PathBuf::from("T/4.ass")),
        ];
        assert_eq!(
            full_args("C:\\v.mkv", &outputs).join(" "),
            "-v error -nostdin -y -copyts -i C:\\v.mkv \
             -map 0:2 -c:s srt -f srt T/2.srt -map 0:4 -c:s copy -f ass T/4.ass"
        );
    }

    /// Probe + extract against a real container. SKIPPED unless
    /// `SUBTITLE_TEST_MKV` points at a file with two subrip tracks
    /// (stream #2 and #3) and ffmpeg/ffprobe are resolvable.
    #[test]
    fn probes_and_extracts_a_real_container() {
        let Ok(path) = std::env::var("SUBTITLE_TEST_MKV") else {
            return; // no sample provisioned on this machine — skip
        };
        let tracks = list_tracks(&path).expect("probe");
        assert_eq!(tracks.len(), 2, "tracks: {tracks:?}");
        assert!(tracks.iter().all(|t| t.text && t.codec == "subrip"));
        // `stream_disposition` really is read (the section-name pitfall).
        assert!(tracks.iter().any(|t| t.default), "no default flag: {tracks:?}");
        let full = extract_track(&path, tracks[1].index, None).expect("extract");
        assert_eq!(full.format, "srt");
        assert!(full.complete);
        assert!(full.text.contains("-->"), "not SRT: {}", full.text);
    }

    /// Spans and the one-pass full read against a real 24-minute episode.
    /// SKIPPED unless `SUBTITLE_TEST_BIG_MKV` points at a file whose stream #2
    /// is a dense subrip track and stream #4 an ASS track (see
    /// `C:\_DEV\subtitle-test\bench\big.mkv`).
    #[test]
    fn a_span_matches_the_full_track() {
        let Ok(path) = std::env::var("SUBTITLE_TEST_BIG_MKV") else {
            return;
        };
        let cues = |srt: &str| -> Vec<String> {
            srt.replace('\r', "")
                .split("\n\n")
                .filter(|block| block.contains("-->"))
                .map(|block| block.lines().skip(1).collect::<Vec<_>>().join("|"))
                .collect()
        };
        // A cached full track would answer the span; start clean.
        EXTRACTED.lock().unwrap_or_else(|p| p.into_inner()).clear();
        let span = extract_track(&path, 2, Some(ExtractSpan { start: 600.0, end: 700.0 }))
            .expect("span");
        assert!(!span.complete);
        let full = extract_track(&path, 2, None).expect("full");
        assert!(full.complete);
        let span_cues = cues(&span.text);
        let full_cues = cues(&full.text);
        assert!(span_cues.len() > 20, "span too small: {}", span_cues.len());
        for cue in &span_cues {
            assert!(full_cues.contains(cue), "span cue not in the full track: {cue}");
        }
        // Every full-track cue overlapping [600, 700) is in the span.
        let seconds = |t: &str| -> f64 {
            let (hms, ms) = t.trim().split_once(',').unwrap();
            let parts: Vec<f64> = hms.split(':').map(|p| p.parse().unwrap()).collect();
            parts[0] * 3600.0 + parts[1] * 60.0 + parts[2] + ms.parse::<f64>().unwrap() / 1000.0
        };
        for cue in &full_cues {
            let timing = cue.split('|').next().unwrap();
            let (a, b) = timing.split_once("-->").unwrap();
            if seconds(b) > 600.0 && seconds(a) < 700.0 {
                assert!(span_cues.contains(cue), "missing from span: {cue}");
            }
        }
        // The same pass cached the other tracks: the ASS one is a script with
        // its styles, and a span request for it is answered from the cache.
        let ass = extract_track(&path, 4, Some(ExtractSpan { start: 0.0, end: 60.0 }))
            .expect("ass");
        assert!(ass.complete, "the full-read cache should have answered");
        assert_eq!(ass.format, "ass");
        assert!(ass.text.contains("[V4+ Styles]"), "not an ASS script");
        assert!(ass.text.contains("Dialogue:"));
        assert!(ass.text.contains("\\pos("), "override tags must survive the copy");
    }
}

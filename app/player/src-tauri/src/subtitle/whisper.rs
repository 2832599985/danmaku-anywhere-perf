//! Recognition: video audio → Japanese cues via the whisper-server sidecar.
//!
//! The range is cut into CLIPS (default 120 s) and each clip is one
//! `POST /inference` (verbose_json). Measured on the 300 s A/B segment
//! (`_stt-spike/ab`, CONTRACT §34):
//! - 120 s clips + VAD: GPU 3.7 s, CPU 63 s (4.7x realtime).
//! - 30 s clips are SLOWER on CPU (176 s): every 30 s window costs a full
//!   encoder pass (~5.4 s on CPU) no matter how little audio it holds, and the
//!   clip tail costs one more — long clips amortize that.
//! - VAD (silero, bundled) removes the lead-in noise hallucination and gives
//!   tighter segment starts (median error vs the official subtitles 0.44 s).
//!
//! Clip boundaries cut sentences. Rule: a cue whose END falls within
//! `TAIL_GUARD` of a (non-final) clip's end is dropped and the next clip starts
//! at the last KEPT cue's end — so the cut sentence is heard again whole.
//! (The old "fixed 2 s overlap + start floor" left truncated half-sentences.)

use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use serde::Deserialize;

use super::audio;
use super::commands::Cue;
use super::speech;

/// Clip length. The first GPU clip may be shorter so the first cue arrives
/// sooner (`first_clip`).
pub const CLIP_SECS: f64 = 120.0;
/// Cues ending this close to a clip's end are probably cut mid-sentence.
const TAIL_GUARD: f64 = 0.5;
/// When a clip keeps nothing (silence, or one cue spanning everything) the
/// next one starts this much before the clip end — guarantees progress.
const STALL_OVERLAP: f64 = 2.0;
/// A slice of audio shorter than this is not worth a request.
const MIN_CLIP_SECS: f64 = 1.0;

const REQUEST_TIMEOUT: Duration = Duration::from_secs(600);

#[derive(Deserialize)]
struct Response {
    #[serde(default)]
    segments: Vec<Segment>,
    #[serde(default)]
    language: Option<String>,
}

#[derive(Deserialize)]
struct Segment {
    start: f64,
    end: f64,
    text: String,
    #[serde(default)]
    no_speech_prob: f64,
}

/// Parsed clip: cues in CLIP time plus the language whisper used.
#[derive(Debug, Default)]
pub struct ClipResult {
    pub cues: Vec<Cue>,
    pub language: Option<String>,
}

/// Parse a verbose_json body. Drops empty and "no speech" segments.
pub fn parse_response(body: &str) -> Result<ClipResult, String> {
    let response: Response =
        serde_json::from_str(body).map_err(|e| format!("识别结果无法解析: {e}"))?;
    let cues = response
        .segments
        .into_iter()
        .filter(|s| s.no_speech_prob < 0.8)
        .map(|s| Cue {
            start: s.start.max(0.0),
            end: s.end.max(s.start),
            text: s.text.trim().to_string(),
        })
        .filter(|c| !c.text.is_empty())
        .collect();
    Ok(ClipResult {
        cues,
        language: response.language,
    })
}

/// Apply the boundary rule to one clip's cues (absolute times).
/// Returns (kept cues, start of the next clip).
pub fn keep_and_advance(cues: Vec<Cue>, clip_start: f64, clip_len: f64, last: bool) -> (Vec<Cue>, f64) {
    let clip_end = clip_start + clip_len;
    if last {
        return (cues, clip_end);
    }
    let kept: Vec<Cue> = cues
        .iter()
        .filter(|c| c.end < clip_end - TAIL_GUARD)
        .cloned()
        .collect();
    match kept.last() {
        Some(tail) if tail.end > clip_start + MIN_CLIP_SECS => {
            let next = tail.end;
            (kept, next)
        }
        // Nothing usable: keep what we have and step on with a small overlap.
        _ => (cues, (clip_end - STALL_OVERLAP).max(clip_start + MIN_CLIP_SECS)),
    }
}

/// Hallucination / noise cleanup over a clip's cues.
/// - drops punctuation/ellipsis-only lines and bracketed sound tags
///   (`[音楽]`, `(拍手)`, `♪`)
/// - drops lines that are one character repeated (`あああああ`, `プププププ`)
///   and folds a word repeated with spaces (`今 今 今 今` → `今`)
/// - drops a cue identical to the previous one (`-mc 0` makes this rare;
///   it still happens across clip edges)
pub fn clean(cues: Vec<Cue>, previous: Option<&str>) -> Vec<Cue> {
    let mut out: Vec<Cue> = Vec::with_capacity(cues.len());
    let mut last_text: Option<String> = previous.map(str::to_string);
    for mut cue in cues {
        let folded = fold_repeated_words(cue.text.trim());
        let text = folded.trim();
        if is_noise(text) {
            continue;
        }
        if last_text.as_deref() == Some(text) {
            continue;
        }
        cue.text = text.to_string();
        last_text = Some(cue.text.clone());
        out.push(cue);
    }
    out
}

fn is_noise(text: &str) -> bool {
    let meaningful: Vec<char> = text
        .chars()
        .filter(|c| !c.is_whitespace() && !is_punct(*c))
        .collect();
    if meaningful.is_empty() {
        return true;
    }
    let t = text.trim();
    let bracketed = |open: char, close: char| t.starts_with(open) && t.ends_with(close);
    if bracketed('[', ']') || bracketed('(', ')') || bracketed('（', '）') || bracketed('【', '】') {
        return true;
    }
    if t.contains('♪') && meaningful.iter().all(|c| *c == '♪') {
        return true;
    }
    // One character (or a 2-char unit) repeated ≥5 times and nothing else.
    if meaningful.len() >= 5 {
        for unit in 1..=2 {
            if meaningful.len() % unit == 0
                && meaningful.chunks(unit).all(|chunk| chunk == &meaningful[..unit])
            {
                return true;
            }
        }
    }
    false
}

fn is_punct(c: char) -> bool {
    matches!(
        c,
        '。' | '、' | '，' | '．' | '！' | '？' | '!' | '?' | '.' | ',' | '…' | '‥' | '・' | 'ー' | '〜' | '~'
            | '「' | '」' | '『' | '』' | '-' | '♪'
    )
}

/// `今 今 今 今` → `今`; `ちょっと ちょっと` stays (only 3+ repeats fold).
fn fold_repeated_words(text: &str) -> String {
    let words: Vec<&str> = text.split_whitespace().collect();
    if words.len() >= 3 && words.iter().all(|w| *w == words[0]) {
        return words[0].to_string();
    }
    text.to_string()
}

// ---------------------------------------------------------------------------
// Running a range
// ---------------------------------------------------------------------------

/// Multipart body for whisper-server's /inference.
fn multipart(wav: &[u8], language: &str) -> (String, Vec<u8>) {
    let boundary = format!("----danmaku{}", uuid::Uuid::new_v4().simple());
    let mut body = Vec::with_capacity(wav.len() + 512);
    for (name, value) in [("response_format", "verbose_json"), ("language", language), ("temperature", "0.0")] {
        body.extend_from_slice(
            format!("--{boundary}\r\nContent-Disposition: form-data; name=\"{name}\"\r\n\r\n{value}\r\n").as_bytes(),
        );
    }
    body.extend_from_slice(
        format!(
            "--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"clip.wav\"\r\nContent-Type: audio/wav\r\n\r\n"
        )
        .as_bytes(),
    );
    body.extend_from_slice(wav);
    body.extend_from_slice(format!("\r\n--{boundary}--\r\n").as_bytes());
    (format!("multipart/form-data; boundary={boundary}"), body)
}

fn infer(base: &str, wav: &[u8], language: &str) -> Result<String, String> {
    let (content_type, body) = multipart(wav, language);
    ureq::post(&format!("{base}/inference"))
        .timeout(REQUEST_TIMEOUT)
        .set("Content-Type", &content_type)
        .send_bytes(&body)
        .map_err(|e| format!("识别请求失败: {e}"))?
        .into_string()
        .map_err(|e| format!("识别响应读取失败: {e}"))
}

/// Progress callback payload.
pub struct ClipDone {
    /// cues of this clip, cleaned, absolute times
    pub cues: Vec<Cue>,
    /// recognition has covered the video up to here
    pub covered_to: f64,
    pub language: Option<String>,
}

/// Recognize `[from, to)` clip by clip, calling `on_clip` after each one.
/// Returns where coverage ends (== `to` unless cancelled → Err(CANCELLED)).
pub fn transcribe_range(
    base: &str,
    video: &str,
    from: f64,
    to: f64,
    first_clip: f64,
    language: &str,
    detector: Option<&speech::Detector>,
    cancel: &AtomicBool,
    mut on_clip: impl FnMut(ClipDone),
) -> Result<f64, String> {
    let mut start = from.max(0.0);
    let mut previous: Option<String> = None;
    let mut first = true;
    while to - start >= MIN_CLIP_SECS {
        if cancel.load(Ordering::Relaxed) {
            return Err(audio::CANCELLED.to_string());
        }
        let want = if first { first_clip.min(CLIP_SECS) } else { CLIP_SECS };
        first = false;
        let len = want.min(to - start);
        let last = start + len >= to - 1e-6;
        let wav_path = audio::temp_wav();
        let mut voice: Option<Vec<(f64, f64)>> = None;
        let result = audio::extract_wav(video, start, len, &wav_path, cancel).and_then(|()| {
            let wav = std::fs::read(&wav_path).map_err(|e| format!("读取音频失败: {e}"))?;
            let body = infer(base, &wav, language)?;
            // Timing only: on failure the cues keep whisper's own times.
            voice = detector.and_then(|d| match d.segments(&wav_path) {
                Ok(spans) => Some(spans),
                Err(e) => {
                    super::logging::write(&format!("vad: {e}"));
                    None
                }
            });
            Ok(body)
        });
        let _ = std::fs::remove_file(&wav_path);
        if cancel.load(Ordering::Relaxed) {
            return Err(audio::CANCELLED.to_string());
        }
        let parsed = parse_response(&result?)?;
        let absolute: Vec<Cue> = parsed
            .cues
            .into_iter()
            .map(|c| Cue {
                start: c.start + start,
                end: c.end + start,
                text: c.text,
            })
            .collect();
        // Boundary rule on whisper's times (it decides where the next clip
        // starts), then shrink the kept cues to the voice.
        let (kept, next) = keep_and_advance(absolute, start, len, last);
        let kept = match &voice {
            Some(spans) => {
                let spans: Vec<(f64, f64)> = spans.iter().map(|(s, e)| (s + start, e + start)).collect();
                speech::tighten(kept, &spans)
            }
            None => kept,
        };
        let cues = clean(kept, previous.as_deref());
        if let Some(tail) = cues.last() {
            previous = Some(tail.text.clone());
        }
        let covered_to = if last { to } else { next };
        on_clip(ClipDone {
            cues,
            covered_to,
            language: parsed.language,
        });
        if last {
            break;
        }
        start = next;
    }
    Ok(to)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cue(start: f64, end: f64, text: &str) -> Cue {
        Cue {
            start,
            end,
            text: text.to_string(),
        }
    }

    /// The real server response saved during the A/B (VAD, 30 s clip).
    const SAMPLE: &str = include_str!("../../tests/fixtures/whisper-server-sample.json");

    #[test]
    fn parses_real_server_response() {
        let parsed = parse_response(SAMPLE).expect("sample parses");
        assert_eq!(parsed.language.as_deref(), Some("japanese"));
        // VAD dropped the noisy lead-in (no "もう急ぎてく" hallucination): the
        // clip holds exactly the two real lines, starting at 20.35 s.
        assert_eq!(parsed.cues.len(), 2, "{:?}", parsed.cues);
        assert!((parsed.cues[0].start - 20.35).abs() < 0.01);
        assert!(parsed.cues.iter().all(|c| c.end >= c.start && !c.text.is_empty()));
        assert!(parsed.cues.iter().any(|c| c.text.contains("イルドア")));
        // times are clip-relative and inside the 30 s clip
        assert!(parsed.cues.iter().all(|c| c.start >= 0.0 && c.end <= 30.5));
    }

    #[test]
    fn tail_cue_is_dropped_and_next_clip_restarts_at_last_kept_end() {
        let cues = vec![cue(10.0, 14.0, "a"), cue(100.0, 110.0, "b"), cue(115.0, 119.8, "cut")];
        let (kept, next) = keep_and_advance(cues, 0.0, 120.0, false);
        assert_eq!(kept.iter().map(|c| c.text.as_str()).collect::<Vec<_>>(), ["a", "b"]);
        assert_eq!(next, 110.0);
    }

    #[test]
    fn final_clip_keeps_everything() {
        let cues = vec![cue(1.0, 2.0, "a"), cue(28.0, 29.9, "end")];
        let (kept, next) = keep_and_advance(cues, 0.0, 30.0, true);
        assert_eq!(kept.len(), 2);
        assert_eq!(next, 30.0);
    }

    #[test]
    fn empty_or_unusable_clip_still_advances() {
        let (kept, next) = keep_and_advance(Vec::new(), 50.0, 120.0, false);
        assert!(kept.is_empty());
        assert_eq!(next, 168.0);
        // a single cue running into the tail: kept (better than losing it), stepped past
        let (kept, next) = keep_and_advance(vec![cue(50.2, 169.9, "long")], 50.0, 120.0, false);
        assert_eq!(kept.len(), 1);
        assert_eq!(next, 168.0);
    }

    #[test]
    fn cleanup_drops_noise_and_repeats() {
        let cues = vec![
            cue(0.0, 1.0, "……"),
            cue(1.0, 2.0, "あああああああ"),
            cue(2.0, 3.0, "[音楽]"),
            cue(3.0, 4.0, "今 今 今 今"),
            cue(4.0, 5.0, "分かっている"),
            cue(5.0, 6.0, "分かっている"),
            cue(6.0, 7.0, "プププププ"),
            cue(7.0, 8.0, "はい"),
            cue(8.0, 9.0, "♪♪♪"),
        ];
        let out = clean(cues, Some("前の句"));
        let texts: Vec<&str> = out.iter().map(|c| c.text.as_str()).collect();
        assert_eq!(texts, ["今", "分かっている", "はい"]);
    }

    #[test]
    fn cleanup_compares_with_previous_clip_tail() {
        let out = clean(vec![cue(0.0, 1.0, "失礼ですが"), cue(1.0, 2.0, "次")], Some("失礼ですが"));
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].text, "次");
    }

    #[test]
    fn short_real_lines_survive() {
        let out = clean(vec![cue(0.0, 1.0, "はっ"), cue(1.0, 2.0, "ええ"), cue(2.0, 3.0, "銀")], None);
        assert_eq!(out.len(), 3);
    }

    #[test]
    fn multipart_carries_fields_and_file() {
        let (ct, body) = multipart(b"RIFFdata", "ja");
        let boundary = ct.split("boundary=").nth(1).unwrap();
        let text = String::from_utf8_lossy(&body);
        assert!(text.contains("name=\"response_format\"\r\n\r\nverbose_json"));
        assert!(text.contains("name=\"language\"\r\n\r\nja"));
        assert!(text.contains("filename=\"clip.wav\""));
        assert!(text.contains("RIFFdata"));
        assert!(text.trim_end().ends_with(&format!("--{boundary}--")));
    }
}

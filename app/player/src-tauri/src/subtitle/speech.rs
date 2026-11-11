//! Cue timing from voice activity: whisper starts a sentence where the PREVIOUS
//! one ended (the pause between them is folded into the next cue), so the next
//! line sat on screen through the silence before it was spoken.
//!
//! After each clip we run silero VAD (`whisper-vad-speech-segments.exe` from the
//! CPU runtime, same bundled model as the server) over the same WAV and shrink
//! every cue to the speech inside it: shown `LEAD` before the voice starts,
//! gone `TAIL` after it stops. Only ever shrinks — never moves a cue outside
//! whisper's own span. Measured on the 300 s A/B segment vs the official
//! subtitles (`_stt-spike/ab`, CONTRACT §36): cues starting > 0.5 s early
//! 23 → 8, cue pairs with a visible gap 21 → 43 of 82, time on screen
//! 262 s → 230 s (official 232 s). VAD costs ~0.5 s per 300 s of audio.

use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use super::commands::Cue;

/// Line appears this long before the voice starts.
const LEAD: f64 = 0.3;
/// Line stays this long after the voice stops.
const TAIL: f64 = 0.5;
/// A shrunk cue is never shorter than this (readable).
const MIN_SHOWN: f64 = 0.8;
/// Speech touching a cue by less than this does not belong to it.
const TOUCH: f64 = 0.05;

pub const DETECTOR_EXE: &str = "whisper-vad-speech-segments.exe";

pub struct Detector {
    exe: PathBuf,
    model: PathBuf,
}

impl Detector {
    /// None when the runtime has no VAD tool (older whisper.cpp builds).
    pub fn new(runtime_dir: &Path, model: PathBuf) -> Option<Self> {
        let exe = runtime_dir.join(DETECTOR_EXE);
        exe.is_file().then_some(Self { exe, model })
    }

    /// Speech spans of a WAV, in seconds from its start.
    pub fn segments(&self, wav: &Path) -> Result<Vec<(f64, f64)>, String> {
        let mut command = Command::new(&self.exe);
        command
            .arg("-t")
            .arg("2")
            .arg("-vm")
            .arg(&self.model)
            .arg("-f")
            .arg(wav)
            .stdin(Stdio::null())
            .stderr(Stdio::null());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(super::audio::CREATE_NO_WINDOW);
        }
        let output = command.output().map_err(|e| format!("VAD 启动失败: {e}"))?;
        if !output.status.success() {
            return Err(format!("VAD 退出码 {:?}", output.status.code()));
        }
        Ok(parse_segments(&String::from_utf8_lossy(&output.stdout)))
    }
}

/// `Speech segment 0: start = 2035.00, end = 2157.00` (centiseconds).
pub fn parse_segments(stdout: &str) -> Vec<(f64, f64)> {
    stdout
        .lines()
        .filter_map(|line| {
            let rest = line.split_once("start = ")?.1;
            let (start, end) = rest.split_once(", end = ")?;
            let start: f64 = start.trim().parse().ok()?;
            let end: f64 = end.trim().parse().ok()?;
            (end > start).then_some((start / 100.0, end / 100.0))
        })
        .collect()
}

/// Shrink each cue to the speech it contains (`speech` in the cues' time base).
/// Cues without speech inside are left as whisper placed them.
pub fn tighten(cues: Vec<Cue>, speech: &[(f64, f64)]) -> Vec<Cue> {
    cues.into_iter()
        .map(|cue| {
            let mut inside = speech
                .iter()
                .filter(|(s, e)| *e > cue.start + TOUCH && *s < cue.end - TOUCH);
            let Some(first) = inside.next() else {
                return cue;
            };
            let last = inside.last().unwrap_or(first);
            let start = cue.start.max(first.0 - LEAD);
            let mut end = cue.end.min(last.1 + TAIL);
            if end - start < MIN_SHOWN {
                end = cue.end.min(start + MIN_SHOWN);
            }
            if end <= start {
                return cue;
            }
            Cue { start, end, ..cue }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cue(start: f64, end: f64) -> Cue {
        Cue {
            start,
            end,
            text: "x".to_string(),
        }
    }

    #[test]
    fn parses_detector_output() {
        let out = "Detected 2 speech segments:\nSpeech segment 0: start = 2035.00, end = 2157.00\nSpeech segment 1: start = 2272.00, end = 2512.00\n";
        assert_eq!(parse_segments(out), vec![(20.35, 21.57), (22.72, 25.12)]);
    }

    #[test]
    fn cue_starting_at_previous_end_waits_for_the_voice() {
        // whisper: line 2 starts the moment line 1 ends, voice comes 2.5 s later
        let cues = vec![cue(10.0, 14.0), cue(14.0, 20.0)];
        let speech = [(10.2, 13.0), (16.5, 19.0)];
        let got = tighten(cues, &speech);
        assert!((got[0].start - 10.0).abs() < 1e-9);
        assert!((got[0].end - 13.5).abs() < 1e-9);
        assert!((got[1].start - 16.2).abs() < 1e-9);
        assert!((got[1].end - 19.5).abs() < 1e-9);
        assert!(got[1].start - got[0].end > 2.0, "a gap between the lines");
    }

    #[test]
    fn never_grows_and_leaves_speechless_cues_alone() {
        let cues = vec![cue(5.0, 6.0), cue(30.0, 33.0)];
        let speech = [(4.0, 7.0)];
        let got = tighten(cues, &speech);
        assert_eq!((got[0].start, got[0].end), (5.0, 6.0));
        assert_eq!((got[1].start, got[1].end), (30.0, 33.0));
    }

    #[test]
    fn short_speech_keeps_a_readable_minimum() {
        let got = tighten(vec![cue(1.0, 5.0)], &[(3.0, 3.1)]);
        assert!((got[0].start - 2.7).abs() < 1e-9);
        assert!((got[0].end - 3.6).abs() < 1e-9);
    }

    /// Real detector on a real WAV. `cargo test -- --ignored` with
    /// VAD_RUNTIME (whisper-cpu dir), VAD_MODEL and VAD_WAV set.
    #[test]
    #[ignore]
    fn real_detector_finds_speech() {
        let var = |k: &str| std::env::var(k).expect(k);
        let detector = Detector::new(Path::new(&var("VAD_RUNTIME")), PathBuf::from(var("VAD_MODEL")))
            .expect("detector exe");
        let spans = detector.segments(Path::new(&var("VAD_WAV"))).expect("vad runs");
        eprintln!("{} spans, first {:?}", spans.len(), spans.first());
        assert!(!spans.is_empty());
        assert!(spans.windows(2).all(|w| w[0].1 <= w[1].0 + 0.2));
    }
}

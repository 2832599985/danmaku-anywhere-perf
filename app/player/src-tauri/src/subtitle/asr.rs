//! SenseVoice ASR with token-timestamp cue building, fed by Silero VAD.
//!
//! Timing hierarchy (probed 2026-09-08, tests/probe_timestamps.rs): SenseVoice
//! DOES return per-token timestamps (~0.12 s granularity) via
//! `OfflineStream::get_result()`. Cue boundaries therefore come from the
//! TOKENS (sentence punctuation + inter-token gaps), and VAD segments only
//! partition the audio for the recognizer's input budget. When the token
//! timestamps are unavailable, the VAD segment span is the cue span
//! ("vad" source) — the previous behavior, kept as fallback.
//!
//! The VAD is fed in small aligned chunks (accepting a whole segment in one
//! call overflows its 30 s circular buffer — its Overflow warning lies about
//! "no data loss").
//!
//! Measured speed (12 cores): model load ~1.1 s, decoding 60 s of audio
//! ~0.7 s total. Inference is NOT the bottleneck; the pipeline is paced by
//! ffmpeg extraction.

use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use sherpa_onnx::{
    OfflineModelConfig, OfflineRecognizer, OfflineRecognizerConfig,
    OfflineSenseVoiceModelConfig, SileroVadModelConfig, VadModelConfig,
    VoiceActivityDetector,
};

use super::commands::Cue;

const SAMPLE_RATE: u32 = 16_000;

/// An installed sense-voice model (model + tokens paths).
pub struct AsrModel {
    pub model: std::path::PathBuf,
    pub tokens: std::path::PathBuf,
}

/// Show the cue a beat before the speech starts.
const LEAD_IN_SECS: f64 = 0.08;
/// Keep the cue on screen after the speech ends.
const TAIL_OUT_SECS: f64 = 0.30;
/// Minimum on-screen time — flashes shorter than this are unreadable.
const MIN_CUE_SECS: f64 = 0.80;

/// Max characters (CJK ≈ 1 char each) allowed on screen per cue.
pub const MAX_CUE_CHARS: usize = 30;

/// Transcribe ONE extracted 30 s WAV segment file. Speech segments from the
/// VAD are recognized immediately; each result's TOKEN timestamps are turned
/// into cues (split at sentence punctuation / token gaps). `on_cues` delivers
/// cues for streaming display; the recognizer is created once per task.
pub fn transcribe_segment(
    wav_path: &Path,
    vad_model: &Path,
    recognizer: &OfflineRecognizer,
    cancel: &Arc<AtomicBool>,
    mut on_cues: impl FnMut(Vec<Cue>),
) -> Result<Vec<Cue>, String> {
    let samples = read_wav(wav_path)?;
    let vad = VoiceActivityDetector::create(&vad_config(vad_model), 30.0)
        .ok_or("初始化 VAD 失败（silero-vad.onnx 缺失？）")?;
    // Feed in 512-window-aligned chunks and drain as we go. Pushing a whole
    // 480 000-sample segment in ONE call overflows the VAD's 30 s circular
    // buffer (its Overflow warning lies about "no data loss" — the head of
    // the audio is dropped and only the tail sliver gets recognized).
    const CHUNK: usize = 512 * 10;
    let mut cues = Vec::new();
    for chunk in samples.chunks(CHUNK) {
        if cancel.load(Ordering::Relaxed) {
            return Err(super::audio::CANCELLED.to_string());
        }
        vad.accept_waveform(chunk);
        drain_vad(
            &vad,
            recognizer,
            cancel,
            &mut cues,
            &mut on_cues,
        );
    }
    vad.flush(); // finalize trailing speech so the segment yields its last cue
    drain_vad(&vad, recognizer, cancel, &mut cues, &mut on_cues);
    Ok(cues)
}

/// Recognize every speech segment the VAD has queued and emit cues.
fn drain_vad(
    vad: &VoiceActivityDetector,
    recognizer: &OfflineRecognizer,
    cancel: &Arc<AtomicBool>,
    cues: &mut Vec<Cue>,
    on_cues: &mut impl FnMut(Vec<Cue>),
) {
    while !vad.is_empty() {
        if cancel.load(Ordering::Relaxed) {
            return;
        }
        let Some(segment) = vad.front() else { break };
        let seg_samples: Vec<f32> = segment.samples().to_vec();
        let seg_start = segment.start() as f64 / SAMPLE_RATE as f64;
        vad.pop();
        if seg_samples.is_empty() {
            continue;
        }

        let stream = recognizer.create_stream();
        stream.accept_waveform(SAMPLE_RATE as i32, &seg_samples);
        recognizer.decode(&stream);
        let Some(result) = stream.get_result() else { continue };
        let text = result.text.trim().to_string();
        // A cue must carry at least one real character — SenseVoice sometimes
        // emits bare punctuation for sub-second tail fragments.
        if text.is_empty() || !text.chars().any(|c| c.is_alphanumeric()) {
            continue;
        }

        // Token timestamps are relative to this accept_waveform call, i.e.
        // absolute = seg_start + ts. Tokens pair 1:1 with timestamps.
        let built = match (&result.timestamps, result.tokens.is_empty()) {
            (Some(ts), false) if ts.len() == result.tokens.len() => {
                build_cues_from_tokens(
                    seg_start,
                    &result.tokens,
                    ts,
                    seg_samples.len() as f64 / SAMPLE_RATE as f64,
                )
            }
            _ => {
                // Fallback: no/pairing-broken timestamps — VAD span is the cue.
                let raw_end =
                    seg_start + seg_samples.len() as f64 / SAMPLE_RATE as f64;
                let (start, end) = polish_cue(seg_start, raw_end);
                split_long_cue(start, end, &text)
                    .into_iter()
                    .map(|(s, e, part)| Cue {
                        start: s,
                        end: e,
                        text: part,
                    })
                    .collect()
            }
        };
        for cue in built {
            on_cues(vec![cue.clone()]);
            cues.push(cue);
        }
    }
}

/// Sentence-ending characters: a cue break lands after one of these.
const SENTENCE_END: [char; 6] = ['。', '！', '？', '；', '?', '!'];

/// Clause-level separators: preferred break points inside long sentences.
const CLAUSE_BREAK: [char; 5] = ['，', '、', '：', ',', ':'];

/// True when the token is pure punctuation (no letter/digit/CJK).
fn is_punct_token(token: &str) -> bool {
    !token
        .chars()
        .any(|c| c.is_alphanumeric() || ('\u{4e00}'..='\u{9fff}').contains(&c))
}

/// Build cues from SenseVoice tokens + their per-token timestamps.
///
/// Break rules (standard subtitle-tool segmentation):
/// - after a sentence ender (。！？；): always break
/// - at a clause separator (，、：) when the running cue ≥ half max chars
/// - when the running cue exceeds MAX_CUE_CHARS (hard wrap)
///
/// Timing: a token's cue-time span is [t_i, t_{i+1}) — the last token's end
/// is the next token's start, so the span end is accurate to ~0.12 s (the
/// model's timestamp quantization), no proportional guessing. Punctuation
/// tokens are kept in the text (they carry prosody) but extend the running
/// span without forcing breaks unless they are sentence enders.
fn build_cues_from_tokens(
    seg_start: f64,
    tokens: &[String],
    timestamps: &[f32],
    seg_len_secs: f64,
) -> Vec<Cue> {
    let abs = |i: usize| seg_start + timestamps[i] as f64;
    // The final token's end: next token's start, or the speech-segment end.
    let token_end = |i: usize| {
        if i + 1 < timestamps.len() {
            abs(i + 1)
        } else {
            seg_start + seg_len_secs
        }
    };

    let mut cues: Vec<Cue> = Vec::new();
    // Index of the first token in the running cue.
    let mut start_i = 0usize;
    let mut chars_in_cue = 0usize;
    // True once the running cue has at least one non-punct token.
    let mut has_content = false;

    for i in 0..tokens.len() {
        let token = &tokens[i];
        chars_in_cue += token.chars().count();
        if !is_punct_token(token) {
            has_content = true;
        }
        let is_last = i + 1 == tokens.len();
        let ends_sentence = token
            .chars()
            .last()
            .is_some_and(|c| SENTENCE_END.contains(&c));
        let is_clause_break = token
            .chars()
            .last()
            .is_some_and(|c| CLAUSE_BREAK.contains(&c));

        let should_break = is_last
            || ends_sentence
            || chars_in_cue >= MAX_CUE_CHARS
            || (is_clause_break && chars_in_cue >= MAX_CUE_CHARS / 2);

        if !should_break {
            continue;
        }
        // Skip emitting an all-punctuation cue (sub-second tail fragments).
        if has_content {
            let s = abs(start_i);
            let e = token_end(i);
            if e > s {
                let (s, e) = polish_cue(s, e);
                // Merge overlap introduced by polish (lead-in of a new cue vs
                // tail-out of the previous one is fine; ordering is preserved
                // because token times are monotonic).
                let text = tokens[start_i..=i].join("");
                cues.push(Cue { start: s, end: e, text });
            }
        }
        start_i = i + 1;
        chars_in_cue = 0;
        has_content = false;
    }
    // De-overlap: a cue's tail-out can extend past the next cue's lead-in
    // start (0.30 + 0.08 s). The renderer resolves overlaps to the
    // later-starting cue, so the tail-out would visually cut the previous
    // line early — clamp instead.
    for i in 1..cues.len() {
        if cues[i].start < cues[i - 1].end {
            cues[i - 1].end = cues[i].start.max(cues[i - 1].start);
        }
    }
    cues
}

/// Split an over-long cue into ≤MAX_CUE_CHARS parts, breaking at punctuation
/// when one falls inside the window, and divide [start, end] proportionally
/// by part length (fallback path only — the token path never needs this).
fn split_long_cue(start: f64, end: f64, text: &str) -> Vec<(f64, f64, String)> {
    let chars: Vec<char> = text.chars().collect();
    if chars.len() <= MAX_CUE_CHARS {
        let (s, e) = polish_cue(start, end);
        return vec![(s, e, text.to_string())];
    }

    // Greedy cut: take up to max chars; prefer the last punctuation inside
    // the second half of the window so breaks land between clauses.
    const PUNCT: [char; 12] = [
        '，', '。', '！', '？', '、', '；', '：', '…', ' ', ',', '.', '?',
    ];
    let mut parts: Vec<String> = Vec::new();
    let mut i = 0usize;
    while i < chars.len() {
        let remaining = chars.len() - i;
        if remaining <= MAX_CUE_CHARS {
            parts.push(chars[i..].iter().collect());
            break;
        }
        let window_end = i + MAX_CUE_CHARS;
        let window_start = i + MAX_CUE_CHARS / 2;
        let mut cut = window_end;
        for j in (window_start..window_end).rev() {
            if PUNCT.contains(&chars[j]) {
                cut = j + 1;
                break;
            }
        }
        parts.push(chars[i..cut].iter().collect());
        i = cut;
    }

    // Proportional time allocation across the raw span.
    let total_chars: usize = parts.iter().map(|p| p.chars().count()).sum();
    let span = end - start;
    let mut out = Vec::with_capacity(parts.len());
    let mut cursor = start;
    let last = parts.len() - 1;
    for (index, part) in parts.iter().enumerate() {
        let part_start = cursor;
        let part_end = if index == last {
            end
        } else {
            (cursor + span * (part.chars().count() as f64 / total_chars as f64))
                .max(part_start + MIN_CUE_SECS)
        };
        cursor = part_end;
        // Lead-in only on the first part, tail-out only on the last.
        let s = if index == 0 {
            (part_start - LEAD_IN_SECS).max(0.0)
        } else {
            part_start
        };
        let e = if index == last {
            part_end + TAIL_OUT_SECS
        } else {
            part_end
        };
        out.push((s, e.max(s + MIN_CUE_SECS), part.clone()));
    }
    out
}

/// Subtitle-tool-standard cue polish: lead-in, tail-out, minimum duration.
fn polish_cue(start: f64, end: f64) -> (f64, f64) {
    let start = (start - LEAD_IN_SECS).max(0.0);
    let mut end = end + TAIL_OUT_SECS;
    if end - start < MIN_CUE_SECS {
        end = start + MIN_CUE_SECS;
    }
    (start, end)
}

fn vad_config(vad_model: &Path) -> VadModelConfig {
    VadModelConfig {
        silero_vad: SileroVadModelConfig {
            model: Some(vad_model.to_string_lossy().into_owned()),
            threshold: 0.5,
            // A pause ≥ 0.5s ends the cue — roughly one clause/sentence.
            min_silence_duration: 0.5,
            // Drop breaths/clicks shorter than a quarter second.
            min_speech_duration: 0.25,
            // Force-split marathon speech past 10 s (the per-segment flush
            // also bounds cues to the 30 s segment length).
            max_speech_duration: 10.0,
            window_size: 512,
        },
        ten_vad: Default::default(),
        sample_rate: SAMPLE_RATE as i32,
        num_threads: 1,
        provider: None,
        debug: false,
    }
}

/// Read the extracted WAV (mono 16 kHz s16le written by ffmpeg) as f32.
fn read_wav(path: &Path) -> Result<Vec<f32>, String> {
    let reader = hound::WavReader::open(path).map_err(|e| format!("读取音频失败: {e}"))?;
    let spec = reader.spec();
    if spec.channels != 1 || spec.sample_rate != SAMPLE_RATE {
        return Err(format!(
            "音频格式异常（期望 16kHz 单声道，得到 {}Hz × {} 声道）",
            spec.sample_rate, spec.channels
        ));
    }
    let samples: Result<Vec<i16>, _> = reader.into_samples::<i16>().collect();
    let samples = samples.map_err(|e| format!("解码音频失败: {e}"))?;
    Ok(samples
        .into_iter()
        .map(|s| s as f32 / 32768.0)
        .collect())
}

/// Build a recognizer once for the whole task (model load is expensive;
/// per-segment reuse keeps streaming latency at inference-only cost).
pub fn create_recognizer(asr: &AsrModel, language: &str) -> Result<OfflineRecognizer, String> {
    OfflineRecognizer::create(&recognizer_config(asr, language))
        .ok_or_else(|| "初始化识别模型失败".to_string())
}

fn recognizer_config(asr: &AsrModel, language: &str) -> OfflineRecognizerConfig {
    OfflineRecognizerConfig {
        model_config: OfflineModelConfig {
            sense_voice: OfflineSenseVoiceModelConfig {
                model: Some(asr.model.to_string_lossy().into_owned()),
                // Fixed zh: the scoped feature is zh-audio → zh-subtitles.
                language: Some(language.to_string()),
                use_itn: true,
            },
            tokens: Some(asr.tokens.to_string_lossy().into_owned()),
            // All cores minus one (kept free for the UI/webview). SenseVoice
            // int8 on CPU scales with intra-op threads; capping at 4 left
            // 2/3 of a typical machine idle.
            num_threads: std::thread::available_parallelism()
                .map(|n| (n.get().saturating_sub(1)).max(2) as i32)
                .unwrap_or(4),
            debug: false,
            provider: None,
            ..Default::default()
        },
        ..Default::default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::AtomicBool;

    /// End-to-end VAD+ASR smoke test against the official sherpa-onnx sample
    /// wavs, split in half and fed as two segment files (the follow-playhead
    /// shape). SKIPPED unless the model files are present:
    ///   SHERPA_TEST_WAV=<16k mono wav> SHERPA_TEST_MODEL=<model.int8.onnx>
    ///   SHERPA_TEST_TOKENS=<tokens.txt> SHERPA_TEST_VAD=<silero-vad.onnx>
    #[test]
    fn transcribes_real_sample() {
        let (Ok(wav), Ok(model), Ok(tokens), Ok(vad)) = (
            std::env::var("SHERPA_TEST_WAV"),
            std::env::var("SHERPA_TEST_MODEL"),
            std::env::var("SHERPA_TEST_TOKENS"),
            std::env::var("SHERPA_TEST_VAD"),
        ) else {
            return; // models not provisioned on this machine — skip
        };
        let asr = AsrModel {
            model: model.into(),
            tokens: tokens.into(),
        };
        let recognizer = create_recognizer(&asr, "auto").expect("create recognizer");

        let samples = read_wav(Path::new(&wav)).expect("read wav");
        let half = samples.len() / 2;
        let write_part = |name: &Path, data: &[f32]| {
            let spec = hound::WavSpec {
                channels: 1,
                sample_rate: SAMPLE_RATE as u32,
                bits_per_sample: 16,
                sample_format: hound::SampleFormat::Int,
            };
            let mut writer = hound::WavWriter::create(name, spec).unwrap();
            for s in data {
                writer.write_sample((s * 32767.0) as i16).unwrap();
            }
        };
        let tmp = std::env::temp_dir();
        let part0 = tmp.join("da-part0.wav");
        let part1 = tmp.join("da-part1.wav");
        write_part(&part0, &samples[..half]);
        write_part(&part1, &samples[half..]);

        let mut cues = Vec::new();
        for part in [&part0, &part1] {
            let batch = transcribe_segment(
                part,
                Path::new(&vad),
                &recognizer,
                &Arc::new(AtomicBool::new(false)),
                |_| {},
            )
            .expect("push");
            cues.extend(batch);
        }
        let _ = std::fs::remove_file(&part0);
        let _ = std::fs::remove_file(&part1);

        assert!(!cues.is_empty(), "expected at least one cue");
        for cue in &cues {
            assert!(cue.end > cue.start);
            assert!(!cue.text.is_empty());
        }
        println!("cues: {:#?}", cues);
    }
}

#[cfg(test)]
mod split_tests {
    use super::*;

    /// A 70-char lecture sentence splits into ≤30-char parts whose times tile
    /// [start, end] contiguously (last part keeps the tail-out).
    #[test]
    fn long_cue_splits_proportionally() {
        let text = "那么这道题的解题思路其实非常简单我们只需要先求出整体的平均值然后再用平均值去乘以对应的权重比例最后再把所有的结果相加就可以得到最终答案了";
        assert!(text.chars().count() > 60);
        let parts = split_long_cue(100.0, 112.0, text);
        assert!(parts.len() >= 2, "expected a split");
        let mut t = 100.0 - LEAD_IN_SECS;
        for (i, (s, e, txt)) in parts.iter().enumerate() {
            assert!(
                txt.chars().count() <= MAX_CUE_CHARS,
                "part {i} too long: {txt}"
            );
            assert!(!txt.is_empty());
            assert!((s - t).abs() < 0.35, "part {i} gap: {s} vs {t}");
            assert!(e > s);
            t = *e;
        }
        // ends at end + tail-out
        assert!((t - (112.0 + TAIL_OUT_SECS)).abs() < 0.35);
    }

    /// Short cues pass through with polish only.
    #[test]
    fn short_cue_untouched_except_polish() {
        let parts = split_long_cue(10.0, 13.0, "你好世界");
        assert_eq!(parts.len(), 1);
        let (s, e, txt) = &parts[0];
        assert!((s - (10.0 - LEAD_IN_SECS)).abs() < 1e-9);
        assert!((e - (13.0 + TAIL_OUT_SECS)).abs() < 1e-9);
        assert_eq!(txt, "你好世界");
    }
}

#[cfg(test)]
mod token_cue_tests {
    use super::*;

    fn tok(s: &str) -> String {
        s.to_string()
    }

    /// A sentence-ender always ends the cue, even when short.
    #[test]
    fn sentence_end_breaks() {
        let tokens = vec![tok("你"), tok("好"), tok("。"), tok("再"), tok("见"), tok("！")];
        let ts = [0.0, 0.12, 0.24, 0.36, 0.48, 0.6];
        let cues = build_cues_from_tokens(100.0, &tokens, &ts, 1.0);
        assert_eq!(cues.len(), 2, "{cues:?}");
        assert_eq!(cues[0].text, "你好。");
        assert_eq!(cues[1].text, "再见！");
        // absolute times = seg_start + token ts; polish applies the lead-in
        assert!((cues[0].start - (100.0 - LEAD_IN_SECS)).abs() < 1e-6, "{:?}", cues[0].start);
        // second cue starts at token 3 (0.36), first ends there (tail-out may
        // extend it — verify no ORDERING violation)
        assert!(cues[0].end <= cues[1].end);
        assert!((cues[1].end - (100.0 + 1.0 + TAIL_OUT_SECS)).abs() < 1e-6);
    }

    /// Clauses break at ，/、/： once the cue has ≥ half the max chars.
    #[test]
    fn clause_breaks_at_half_max() {
        // 20 chars before the comma: below half (15) → no break at the comma,
        // everything stays one cue up to the sentence end.
        let mut text = String::new();
        for _ in 0..20 {
            text.push('字');
        }
        text.push('，');
        let tokens: Vec<String> = text.chars().map(|c| tok(c.to_string().as_str())).collect();
        let ts: Vec<f32> = (0..tokens.len()).map(|i| (i as f32) * 0.12).collect();
        let cues = build_cues_from_tokens(0.0, &tokens, &ts, 5.0);
        assert_eq!(cues.len(), 1, "{cues:?}");

        // 16 chars before the comma: ≥ half (15) → break at the comma.
        let mut text2 = String::new();
        for _ in 0..16 {
            text2.push('字');
        }
        text2.push('，');
        text2.push_str("第二句。");
        let tokens2: Vec<String> = text2.chars().map(|c| tok(c.to_string().as_str())).collect();
        let ts2: Vec<f32> = (0..tokens2.len()).map(|i| (i as f32) * 0.12).collect();
        let cues2 = build_cues_from_tokens(0.0, &tokens2, &ts2, 5.0);
        assert_eq!(cues2.len(), 2, "{cues2:?}");
    }

    /// The hard MAX_CUE_CHARS wrap applies even with no punctuation.
    #[test]
    fn hard_wrap_at_max_chars() {
        let text = "字".repeat(45);
        let tokens: Vec<String> = text.chars().map(|c| tok(c.to_string().as_str())).collect();
        let ts: Vec<f32> = (0..tokens.len()).map(|i| (i as f32) * 0.12).collect();
        let cues = build_cues_from_tokens(0.0, &tokens, &ts, 8.0);
        assert!(cues.len() >= 2, "{cues:?}");
        for cue in &cues {
            assert!(cue.text.chars().count() <= MAX_CUE_CHARS, "{cue:?}");
        }
    }

    /// All-punctuation content emits nothing (sub-second tail fragments).
    #[test]
    fn punctuation_only_emits_nothing() {
        let tokens = vec![tok("。"), tok("。")];
        let ts = [0.0, 0.12];
        let cues = build_cues_from_tokens(0.0, &tokens, &ts, 0.5);
        assert!(cues.is_empty(), "{cues:?}");
    }
}

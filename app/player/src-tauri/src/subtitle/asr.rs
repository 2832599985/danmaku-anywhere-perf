//! SenseVoice ASR, segmented by Silero VAD — one VAD per extracted 30 s
//! segment, flushed at the segment end.
//!
//! Timing comes from the VAD: every speech span becomes one cue. SenseVoice
//! emits no timestamps, so VAD boundaries ARE cue boundaries — the same
//! design as sherpa-onnx's own subtitle demos and CapsWriter-Offline's VAD
//! mode.
//!
//! Why per-SEGMENT VAD (a whole-window VAD was tried and reverted): a course
//! lecture can run minutes without a 0.5 s pause, so a continuously-fed VAD
//! buffers everything and only emits at flush — cues then arrive a whole
//! window late and SenseVoice (30 s input capacity) truncates them into one
//! mis-timed fragment (the "no subtitles appear" regression). Per segment,
//! cues are PROMPT and always fit the model's input budget. The tradeoff is
//! that speech spanning an extraction boundary may split into two cues; the
//! 30 s segment length makes that rare and the polish below keeps either
//! half readable.
//!
//! Cue polish follows standard subtitle-tool post-processing (see
//! VideoLingo/Buzz/subtitle-edit conventions): drop sub-0.25 s blips, pad the
//! start slightly before speech begins, let the text linger ~0.3 s after it
//! ends, and enforce a minimum on-screen duration.

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

/// Transcribe ONE extracted 30 s WAV segment file, VAD-segmented and
/// flushed at the file end. `on_cues` delivers the segment's cues for
/// streaming display; the recognizer is created once per task and shared.
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

/// Transcribe every speech segment the VAD has queued, polish, and hand each
/// batch to `on_cues` (which also accumulates into `cues`).
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
        let start = segment.start() as f64 / SAMPLE_RATE as f64;
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
        let raw_end = start + seg_samples.len() as f64 / SAMPLE_RATE as f64;
        let (start, end) = polish_cue(start, raw_end);
        let cue = Cue { start, end, text };
        on_cues(vec![cue.clone()]);
        cues.push(cue);
    }
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

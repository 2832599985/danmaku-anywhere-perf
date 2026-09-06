//! SenseVoice ASR over the extracted 16 kHz WAV, segmented by Silero VAD.
//!
//! Timing comes from the VAD: every speech segment becomes one cue
//! (start = segment start, end = segment start + samples). SenseVoice itself
//! emits no timestamps, so segmentation granularity IS cue granularity —
//! sentence-ish segments (silero `min_silence_duration`) are exactly what a
//! subtitle wants.

use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use sherpa_onnx::{
    OfflineRecognizer, OfflineRecognizerConfig, OfflineModelConfig,
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

/// Transcribe ONE already-extracted 16 kHz mono WAV segment file (a
/// fixed-length slice of the episode; the segment's start offset is added by
/// the caller). `on_cues` fires with the segment's cues so the UI streams
/// subtitles while extraction of later segments is still running.
pub fn transcribe_segment(
    wav_path: &Path,
    vad_model: &Path,
    recognizer: &OfflineRecognizer,
    cancel: &Arc<AtomicBool>,
    mut on_cues: impl FnMut(Vec<Cue>),
) -> Result<Vec<Cue>, String> {
    let samples = read_wav(wav_path)?;
    let segments = segment_with_vad(&samples, vad_model, cancel)?;
    if segments.is_empty() {
        return Ok(Vec::new());
    }

    const MIN_CUE_SECS: f64 = 0.2;
    let mut cues = Vec::with_capacity(segments.len());
    for segment in segments.iter() {
        if cancel.load(Ordering::Relaxed) {
            return Err(super::audio::CANCELLED.to_string());
        }
        let stream = recognizer.create_stream();
        stream.accept_waveform(SAMPLE_RATE as i32, segment.samples());
        recognizer.decode(&stream);
        let result = stream.get_result().ok_or("识别结果缺失")?;
        let text = result.text.trim().to_string();
        if !text.is_empty() {
            let start = segment.start() as f64 / SAMPLE_RATE as f64;
            let end = (start + segment.samples().len() as f64 / SAMPLE_RATE as f64)
                .max(start + MIN_CUE_SECS);
            cues.push(Cue { start, end, text });
        }
    }
    if !cues.is_empty() {
        on_cues(cues.clone());
    }
    Ok(cues)
}

/// Build a recognizer once for the whole pipeline (model load is expensive;
/// per-segment reuse keeps streaming latency at inference-only cost).
pub fn create_recognizer(asr: &AsrModel, language: &str) -> Result<OfflineRecognizer, String> {
    OfflineRecognizer::create(&recognizer_config(asr, language))
        .ok_or_else(|| "初始化识别模型失败".to_string())
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

/// Silero VAD pass over the whole waveform; returns speech segments.
fn segment_with_vad(
    samples: &[f32],
    vad_model: &Path,
    cancel: &Arc<AtomicBool>,
) -> Result<Vec<sherpa_onnx::SpeechSegment>, String> {
    let vad_config = VadModelConfig {
        silero_vad: SileroVadModelConfig {
            model: Some(vad_model.to_string_lossy().into_owned()),
            threshold: 0.5,
            // A pause ≥ 0.6s starts a new cue — natural sentence boundary.
            min_silence_duration: 0.6,
            min_speech_duration: 0.2,
            // Hard cap per cue: cap segments so no cue outlives readability.
            max_speech_duration: 12.0,
            window_size: 512,
        },
        ten_vad: Default::default(),
        sample_rate: SAMPLE_RATE as i32,
        num_threads: 1,
        provider: None,
        debug: false,
    };
    // Buffer ≥ max_speech_duration so long speech still flushes.
    let vad = VoiceActivityDetector::create(&vad_config, 30.0)
        .ok_or("初始化 VAD 失败（silero-vad.onnx 缺失？）")?;

    const CHUNK: usize = 512 * 10; // 10 windows per feed
    let mut segments = Vec::new();
    for chunk in samples.chunks(CHUNK) {
        if cancel.load(Ordering::Relaxed) {
            return Err(super::audio::CANCELLED.to_string());
        }
        vad.accept_waveform(chunk);
        while !vad.is_empty() {
            if let Some(segment) = vad.front() {
                segments.push(segment);
            }
            vad.pop();
        }
    }
    vad.flush();
    while !vad.is_empty() {
        if let Some(segment) = vad.front() {
            segments.push(segment);
        }
        vad.pop();
    }
    Ok(segments)
}

fn recognizer_config(asr: &AsrModel, language: &str) -> OfflineRecognizerConfig {
    OfflineRecognizerConfig {
        model_config: OfflineModelConfig {
            sense_voice: OfflineSenseVoiceModelConfig {
                model: Some(asr.model.to_string_lossy().into_owned()),
                // "auto" | "zh" | "ja" — SenseVoice picks per-utterance in auto.
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
    /// wavs. SKIPPED unless the model files are present on this machine:
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
        let cues = transcribe_segment(
            Path::new(&wav),
            Path::new(&vad),
            &recognizer,
            &Arc::new(AtomicBool::new(false)),
            |_| {},
        )
        .expect("transcription failed");
        assert!(!cues.is_empty(), "expected at least one cue");
        for cue in &cues {
            assert!(cue.end > cue.start);
            assert!(!cue.text.is_empty());
        }
        println!("cues: {:#?}", cues);
    }
}

#[cfg(test)]
mod bench_tests {
    use super::*;
    use std::sync::atomic::AtomicBool;
    use std::time::Instant;

    /// Decode-throughput benchmark over a long synthetic wav
    /// (SHERPA_TEST_LONG): VAD total, decode total, RTF. The streaming
    /// time-to-first-subtitle is now dominated by the FIRST 30 s extraction
    /// segment (see audio.rs SEGMENT_SECS), measured in the app, not here.
    /// SKIPPED without the env var.
    #[test]
    fn bench_streaming_latency() {
        let (Ok(wav), Ok(model), Ok(tokens), Ok(vad)) = (
            std::env::var("SHERPA_TEST_LONG"),
            std::env::var("SHERPA_TEST_MODEL"),
            std::env::var("SHERPA_TEST_TOKENS"),
            std::env::var("SHERPA_TEST_VAD"),
        ) else {
            return;
        };
        let asr = AsrModel { model: model.into(), tokens: tokens.into() };
        let cancel = Arc::new(AtomicBool::new(false));

        let t0 = Instant::now();
        let samples = read_wav(Path::new(&wav)).expect("read wav");
        let t_read = t0.elapsed();
        println!("wav read: {t_read:?} ({} samples)", samples.len());

        let t1 = Instant::now();
        let segments = segment_with_vad(&samples, Path::new(&vad), &cancel).expect("vad");
        let t_vad = t1.elapsed();
        println!("vad: {t_vad:?} -> {} segments", segments.len());

        let recognizer = OfflineRecognizer::create(&recognizer_config(&asr, "auto")).expect("create");

        let mut cue_count = 0usize;
        let t2 = Instant::now();
        for segment in segments.iter() {
            let stream = recognizer.create_stream();
            stream.accept_waveform(SAMPLE_RATE as i32, segment.samples());
            recognizer.decode(&stream);
            let result = stream.get_result().expect("result");
            if !result.text.trim().is_empty() {
                cue_count += 1;
            }
        }
        let t_decode = t2.elapsed();
        let total = t_read + t_vad + t_decode;
        println!("decode total: {t_decode:?} for {} segments ({} cues)", segments.len(), cue_count);
        println!("total pipeline (read+vad+decode): {total:?}");
        println!("RTF: {:.1}x realtime", 911.0 / total.as_secs_f64());
    }
}

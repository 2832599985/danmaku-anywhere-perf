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

/// Transcribe `wav_path` into cues. `vad_model` is the installed silero-vad
/// onnx path. `on_percent` reports 0..1 inference progress across VAD
/// segments. Returns cues sorted by start.
pub fn transcribe_wav(
    wav_path: &Path,
    asr: &AsrModel,
    vad_model: &Path,
    language: &str,
    cancel: &Arc<AtomicBool>,
    mut on_percent: impl FnMut(f32),
) -> Result<Vec<Cue>, String> {
    let samples = read_wav(wav_path)?;
    let segments = segment_with_vad(&samples, vad_model, cancel)?;
    if segments.is_empty() {
        return Ok(Vec::new());
    }

    let recognizer = OfflineRecognizer::create(&recognizer_config(asr, language))
        .ok_or("初始化识别模型失败")?;

    const MIN_CUE_SECS: f64 = 0.2;
    let total = segments.len();
    let mut cues = Vec::with_capacity(total);
    for (index, segment) in segments.iter().enumerate() {
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
        on_percent((index + 1) as f32 / total as f32);
    }
    Ok(cues)
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
            num_threads: std::thread::available_parallelism()
                .map(|n| n.get().min(4) as i32)
                .unwrap_or(2),
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
        let cues = transcribe_wav(
            Path::new(&wav),
            &asr,
            Path::new(&vad),
            "auto",
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

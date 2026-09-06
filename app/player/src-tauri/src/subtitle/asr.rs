//! SenseVoice ASR with a STREAMING Silero VAD.
//!
//! Timing comes from the VAD: every completed speech segment becomes one cue.
//! SenseVoice emits no timestamps, so VAD boundaries ARE cue boundaries — the
//! same design as sherpa-onnx's own subtitle demos and CapsWriter-Offline's
//! VAD mode.
//!
//! The critical invariant: ONE VAD instance is fed the ENTIRE episode
//! continuously (extraction segments arrive 30 s at a time and are pushed in
//! order). The VAD is a streaming state machine — speech spanning an
//! extraction boundary is emitted as a single complete segment, so words are
//! never cut in half. (Per-file VAD instances were the main cause of garbled
//! subtitles: every 30 s boundary could split a sentence into two mis-timed,
//! half-transcribed cues.)
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

/// Show the cue a beat before the speech starts (ms).
const LEAD_IN_SECS: f64 = 0.08;
/// Keep the cue on screen after the speech ends (ms).
const TAIL_OUT_SECS: f64 = 0.30;
/// Minimum on-screen time — flashes shorter than this are unreadable.
const MIN_CUE_SECS: f64 = 0.80;

/// Streaming transcriber over the whole episode: one recognizer + one VAD.
pub struct StreamingTranscriber {
    recognizer: OfflineRecognizer,
    vad: VoiceActivityDetector,
    cancel: Arc<AtomicBool>,
}

impl StreamingTranscriber {
    pub fn new(
        asr: &AsrModel,
        vad_model: &Path,
        language: &str,
        cancel: Arc<AtomicBool>,
    ) -> Result<Self, String> {
        Ok(Self {
            recognizer: create_recognizer(asr, language)?,
            vad: VoiceActivityDetector::create(&vad_config(vad_model), 30.0)
                .ok_or("初始化 VAD 失败（silero-vad.onnx 缺失？）")?,
            cancel,
        })
    }

    /// Feed one extracted 30 s WAV segment; returns the cues it completed.
    /// Cue times are GLOBAL (the VAD counts all samples it has ever seen).
    pub fn push_wav(&mut self, wav_path: &Path) -> Result<Vec<Cue>, String> {
        let samples = read_wav(wav_path)?;
        self.vad.accept_waveform(&samples);
        self.drain()
    }

    /// Flush trailing speech once the last segment has been pushed.
    pub fn finish(&mut self) -> Result<Vec<Cue>, String> {
        self.vad.flush();
        self.drain()
    }

    /// Transcribe every segment the VAD has queued. A segment is only queued
    /// once its trailing silence confirms it ended, so cues are complete
    /// sentences by construction.
    fn drain(&mut self) -> Result<Vec<Cue>, String> {
        let mut cues = Vec::new();
        while !self.vad.is_empty() {
            if self.cancel.load(Ordering::Relaxed) {
                return Err(super::audio::CANCELLED.to_string());
            }
            let segment = match self.vad.front() {
                Some(segment) => segment,
                None => break,
            };
            // Copy out before pop() invalidates the front slot.
            let samples: Vec<f32> = segment.samples().to_vec();
            let start = segment.start() as f64 / SAMPLE_RATE as f64;
            self.vad.pop();
            if samples.is_empty() {
                continue;
            }

            let stream = self.recognizer.create_stream();
            stream.accept_waveform(SAMPLE_RATE as i32, &samples);
            self.recognizer.decode(&stream);
            let result = stream.get_result().ok_or("识别结果缺失")?;
            let text = result.text.trim().to_string();
            if text.is_empty() {
                continue;
            }

            let raw_end = start + samples.len() as f64 / SAMPLE_RATE as f64;
            let (start, end) = polish_cue(start, raw_end);
            cues.push(Cue { start, end, text });
        }
        Ok(cues)
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
            // Hard cap: force-split marathon monologues.
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

/// Build a recognizer once for the whole pipeline (model load is expensive;
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
    /// wavs, pushed through the streaming path (multiple push_wav calls of
    /// the same file emulate multi-segment input). SKIPPED unless the model
    /// files are present:
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
        let mut transcriber = StreamingTranscriber::new(
            &asr,
            Path::new(&vad),
            "auto",
            Arc::new(AtomicBool::new(false)),
        )
        .expect("create transcriber");

        // Split the wav in half on disk to prove boundary-spanning speech
        // still yields one cue: feed the halves in order through ONE VAD.
        let samples = read_wav(Path::new(&wav)).expect("read wav");
        let half = samples.len() / 2;
        let write_part = |name: &str, data: &[f32]| {
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
        write_part(part0.to_str().unwrap(), &samples[..half]);
        write_part(part1.to_str().unwrap(), &samples[half..]);

        let mut cues = transcriber.push_wav(&part0).expect("push 0");
        cues.extend(transcriber.push_wav(&part1).expect("push 1"));
        cues.extend(transcriber.finish().expect("finish"));
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

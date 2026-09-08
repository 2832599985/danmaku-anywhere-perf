//! Exploratory probe: does SenseVoice (via sherpa-onnx) return per-token
//! timestamps? Prints tokens + timestamps for VAD segments of a real lecture.
//! Env: PROBE_WAV, SHERPA_TEST_MODEL, SHERPA_TEST_TOKENS, SHERPA_TEST_VAD

use sherpa_onnx::{
    OfflineModelConfig, OfflineRecognizer, OfflineRecognizerConfig,
    OfflineSenseVoiceModelConfig, SileroVadModelConfig, VadModelConfig,
    VoiceActivityDetector,
};

#[test]
fn probe_sensevoice_timestamps() {
    let (Ok(wav), Ok(model), Ok(tokens), Ok(vad)) = (
        std::env::var("PROBE_WAV"),
        std::env::var("SHERPA_TEST_MODEL"),
        std::env::var("SHERPA_TEST_TOKENS"),
        std::env::var("SHERPA_TEST_VAD"),
    ) else {
        return;
    };
    let reader = hound::WavReader::open(&wav).unwrap();
    let samples: Vec<f32> = reader
        .into_samples::<i16>()
        .map(|s| s.unwrap() as f32 / 32768.0)
        .collect();

    let t0 = std::time::Instant::now();
    let recognizer = OfflineRecognizer::create(&OfflineRecognizerConfig {
        model_config: OfflineModelConfig {
            sense_voice: OfflineSenseVoiceModelConfig {
                model: Some(model),
                language: Some("zh".into()),
                use_itn: true,
            },
            tokens: Some(tokens),
            num_threads: 4,
            debug: false,
            provider: None,
            ..Default::default()
        },
        ..Default::default()
    })
    .expect("recognizer");
    println!("model load: {:?}", t0.elapsed());

    let vad_cfg = VadModelConfig {
        silero_vad: SileroVadModelConfig {
            model: Some(vad),
            threshold: 0.5,
            min_silence_duration: 0.5,
            min_speech_duration: 0.25,
            max_speech_duration: 20.0,
            window_size: 512,
        },
        ten_vad: Default::default(),
        sample_rate: 16000,
        num_threads: 1,
        provider: None,
        debug: false,
    };
    let vad = VoiceActivityDetector::create(&vad_cfg, 60.0).expect("vad");
    for chunk in samples.chunks(5120) {
        vad.accept_waveform(chunk);
    }
    vad.flush();
    let mut n = 0;
    while !vad.is_empty() {
        let seg = vad.front().unwrap();
        let start = seg.start() as f64 / 16000.0;
        let data = seg.samples().to_vec();
        vad.pop();
        let t1 = std::time::Instant::now();
        let stream = recognizer.create_stream();
        stream.accept_waveform(16000, &data);
        recognizer.decode(&stream);
        let dt = t1.elapsed();
        let Some(r) = stream.get_result() else { continue };
        n += 1;
        println!(
            "\n=== seg {n} [{start:.2} - {:.2}] ({} samples) decode {dt:?}",
            start + data.len() as f64 / 16000.0,
            data.len()
        );
        println!("text: {}", r.text);
        println!("tokens({}): {:?}", r.tokens.len(), r.tokens);
        println!("timestamps: {:?}", r.timestamps);
        println!("durations: {:?}", r.durations);
    }
}

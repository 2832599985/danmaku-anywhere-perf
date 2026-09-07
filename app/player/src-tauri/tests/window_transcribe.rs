//! End-to-end WINDOW transcribe proof: a real mp4 + the real SenseVoice model
//! (appdata) through extract→VAD→ASR must yield non-empty Chinese cues.
//! This is the exact body of run_pipeline minus IPC/AppHandle — it exists so a
//! "no subtitles appeared" regression fails here, not in the user's hands.
//! SKIPPED unless SHERPA_TEST_MP4 + the model env vars are present.

use danmaku_player_lib::subtitle::{asr, audio};
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

#[test]
fn window_yields_chinese_cues() {
    let (Ok(mp4), Ok(model), Ok(tokens), Ok(vad)) = (
        std::env::var("SHERPA_TEST_MP4"),
        std::env::var("SHERPA_TEST_MODEL"),
        std::env::var("SHERPA_TEST_TOKENS"),
        std::env::var("SHERPA_TEST_VAD"),
    ) else {
        return;
    };
    let cancel = Arc::new(AtomicBool::new(false));

    // A 60 s window from the very start — matches a playhead-0 cold start.
    let extraction = audio::extract_audio_segmented(&mp4, 0.0, Some(60.0), &cancel, |_| {})
        .expect("spawn extraction");
    let asr_model = asr::AsrModel {
        model: model.into(),
        tokens: tokens.into(),
    };
    let recognizer = asr::create_recognizer(&asr_model, "zh").expect("create recognizer");

    let mut cues = Vec::new();
    let mut segments_seen = 0usize;
    while let Some(result) = extraction.next_segment() {
        let seg = result.expect("segment");
        let part = asr::transcribe_segment(
            &seg,
            Path::new(&vad),
            &recognizer,
            &cancel,
            |_| {},
        )
        .expect("push");
        // Mirror run_pipeline's offset math: segment i covers
        // [0 + i*30, 0 + (i+1)*30) in the video timeline.
        let offset = segments_seen as f64 * audio::SEGMENT_SECS;
        let mut part = part;
        for cue in &mut part {
            cue.start += offset;
            cue.end += offset;
        }
        segments_seen += 1;
        cues.extend(part);
    }

    println!("segments consumed: {segments_seen}, cues: {}", cues.len());
    for cue in &cues {
        println!("  [{:.1}-{:.1}] {}", cue.start, cue.end, cue.text);
    }
    assert!(segments_seen >= 2, "expected multiple segments in a 60s window");
    assert!(!cues.is_empty(), "WINDOW PRODUCED NO CUES — the regression");
    // Times must be region-absoluted & monotonic-ish and non-negative.
    assert!(
        cues.iter().all(|c| c.start >= 0.0 && c.end > c.start),
        "bad cue timing: {cues:?}"
    );
    // OFFSET REGRESSION GUARD: with the per-segment offset applied, the
    // SECOND segment's cues must land in [30, 60) — missing the offset term
    // collapsed them into [0, 30) (subtitles jumping sentences ahead).
    let last_end = cues.iter().map(|c| c.end).fold(0.0, f64::max);
    assert!(
        last_end > 45.0,
        "cues stop at {last_end:.1}s — per-segment offset likely missing"
    );
    // Recognized text should contain CJK (the sample is Chinese).
    let joined: String = cues.iter().map(|c| c.text.clone()).collect();
    assert!(
        joined.chars().any(|ch| ch as u32 >= 0x4e00 && ch as u32 <= 0x9fff),
        "no Chinese characters in: {joined:?}"
    );
    let _ = Ordering::Relaxed;
}

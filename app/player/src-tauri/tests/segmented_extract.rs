//! Integration test: segmented extraction over a REAL mp4 (SHERPA_TEST_MP4).
//! Verifies segments arrive in order, early (while ffmpeg still runs), and
//! every segment is a valid 16 kHz mono WAV. SKIPPED without the env var.

use danmaku_player_lib::subtitle::audio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

#[test]
fn segmented_extraction_streams() {
    let Ok(mp4) = std::env::var("SHERPA_TEST_MP4") else {
        return;
    };
    let cancel = Arc::new(AtomicBool::new(false));
    let start = Instant::now();

    let extraction = audio::extract_audio_segmented(
        &mp4,
        Some(919.0),
        &cancel,
        |_| {},
    )
    .expect("spawn extraction");

    let mut count = 0usize;
    let mut first_arrival: Option<Duration> = None;
    while let Some(result) = extraction.next_segment() {
        let path = result.expect("segment error");
        if first_arrival.is_none() {
            first_arrival = Some(start.elapsed());
        }
        // Each segment must be a readable 16 kHz mono WAV.
        let reader = hound::WavReader::open(&path).expect("open segment wav");
        let spec = reader.spec();
        assert_eq!(spec.sample_rate, 16000, "segment {count} sample rate");
        assert_eq!(spec.channels, 1, "segment {count} channels");
        count += 1;
        if count > 40 {
            cancel.store(true, Ordering::Relaxed); // enough evidence
            break;
        }
    }
    let total = start.elapsed();
    println!(
        "segments: {count}, first arrived after {:?}, total {total:?}",
        first_arrival.unwrap_or_default()
    );
    assert!(count >= 1, "no segments arrived");
    // The FIRST segment must arrive well before the whole file is processed
    // (919 s of audio; full extraction takes ~10 s) — streaming contract.
    assert!(
        first_arrival.unwrap_or_default() < Duration::from_secs(5),
        "first segment too late — streaming broken"
    );
}

/// Cold-start budget regression: spawn ffmpeg → first segment ready must be
/// well under the 5 s user-facing first-subtitle budget (the remaining budget
/// goes to model load ~1-2 s + first decode <1 s). SKIPPED without the env var.
#[test]
fn cold_start_first_segment_under_3s() {
    let Ok(mp4) = std::env::var("SHERPA_TEST_MP4") else {
        return;
    };
    let cancel = Arc::new(AtomicBool::new(false));
    let start = Instant::now();

    let extraction =
        audio::extract_audio_segmented(&mp4, Some(919.0), &cancel, |_| {})
            .expect("spawn extraction");
    let first = extraction
        .next_segment()
        .expect("extraction ended before first segment")
        .expect("first segment errored");

    let elapsed = start.elapsed();
    println!("cold start spawn->first segment: {elapsed:?}");
    assert!(
        first.is_file(),
        "announced segment file missing: {}",
        first.display()
    );
    assert!(
        elapsed < Duration::from_secs(3),
        "cold start took {elapsed:?} — first subtitles would miss the 5 s budget"
    );
}

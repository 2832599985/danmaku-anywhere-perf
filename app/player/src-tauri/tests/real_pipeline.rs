//! Real-sidecar proof of the Rust recognition + translation path: a real
//! video through ffmpeg → whisper-server → `whisper::transcribe_range`, then
//! the first lines through llama-server (Murasaki) → `translator`.
//! SKIPPED unless every env var below is set (they point at the A/B
//! materials in `_stt-spike/`, see PLAN-subtitle-v2.md §2):
//!   PIPE_VIDEO, PIPE_WHISPER_EXE, PIPE_WHISPER_MODEL, PIPE_VAD,
//!   PIPE_LLAMA_EXE (optional), PIPE_MT_MODEL (optional), PIPE_GPU=1 (optional)
//! Run with `--target-dir D:/tmp/cargo-test-target -- --nocapture`.

use std::process::{Child, Command, Stdio};
use std::sync::atomic::AtomicBool;
use std::time::{Duration, Instant};

use danmaku_player_lib::subtitle::{translator, whisper};

struct Server(Child);
impl Drop for Server {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

fn start(exe: &str, args: &[&str], port: u16) -> Server {
    let dir = std::path::Path::new(exe).parent().unwrap();
    let child = Command::new(exe)
        .args(args)
        .args(["--host", "127.0.0.1", "--port", &port.to_string()])
        .current_dir(dir)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .expect("spawn server");
    let base = format!("http://127.0.0.1:{port}");
    let deadline = Instant::now() + Duration::from_secs(120);
    while Instant::now() < deadline {
        if ureq::get(&format!("{base}/health")).call().map(|r| r.status() == 200).unwrap_or(false) {
            return Server(child);
        }
        std::thread::sleep(Duration::from_millis(200));
    }
    panic!("server did not come up: {exe}");
}

#[test]
fn real_video_recognize_then_translate() {
    let var = |k: &str| std::env::var(k).ok().filter(|v| !v.is_empty());
    let (Some(video), Some(exe), Some(model), Some(vad)) =
        (var("PIPE_VIDEO"), var("PIPE_WHISPER_EXE"), var("PIPE_WHISPER_MODEL"), var("PIPE_VAD"))
    else {
        eprintln!("skipped: PIPE_* env vars not set");
        return;
    };
    let gpu = var("PIPE_GPU").is_some();
    let mut args = vec!["-m", model.as_str(), "-l", "ja", "-mc", "0", "-t", "8", "--vad", "-vm", vad.as_str()];
    if !gpu {
        args.push("-ng");
    }
    let server = start(&exe, &args, 18290);
    let cancel = AtomicBool::new(false);
    let started = Instant::now();
    let mut first_clip_at = None;
    let mut cues = Vec::new();
    let covered = whisper::transcribe_range(
        "http://127.0.0.1:18290",
        &video,
        120.0,
        420.0,
        60.0,
        "ja",
        &cancel,
        |clip| {
            first_clip_at.get_or_insert(started.elapsed());
            eprintln!("clip: +{} cues, covered_to={:.1}", clip.cues.len(), clip.covered_to);
            cues.extend(clip.cues);
        },
    )
    .expect("transcribe");
    drop(server);
    eprintln!(
        "recognized {} cues in {:.1}s (first clip {:.1}s), gpu={gpu}",
        cues.len(),
        started.elapsed().as_secs_f64(),
        first_clip_at.unwrap().as_secs_f64()
    );
    assert_eq!(covered, 420.0);
    // The official track has 70 lines in this span; recognition covered all
    // of them in the A/B — anything far below means clips were lost.
    assert!(cues.len() >= 60, "only {} cues", cues.len());
    assert!(cues.windows(2).all(|w| w[0].start <= w[1].start + 0.01), "cues out of order");
    assert!(cues.iter().all(|c| c.start >= 120.0 - 0.5 && c.end <= 420.5));
    // No boundary duplicates (the old overlap rule's failure mode).
    assert!(cues.windows(2).all(|w| w[0].text != w[1].text));
    assert!(cues.iter().any(|c| c.text.contains("イルドア")));

    let (Some(llama), Some(mt)) = (var("PIPE_LLAMA_EXE"), var("PIPE_MT_MODEL")) else {
        eprintln!("translation skipped: PIPE_LLAMA_EXE / PIPE_MT_MODEL not set");
        return;
    };
    let mut args = vec!["-m", mt.as_str(), "-c", "1024", "-np", "1", "--no-jinja", "--chat-template", "chatml", "-t", "4"];
    args.extend(if gpu { vec!["-ngl", "99"] } else { vec!["-ngl", "0", "-dev", "none"] });
    let _llama = start(&llama, &args, 18291);
    let mut translated = 0;
    let mut total = 0;
    let t = Instant::now();
    for batch in cues.chunks(translator::BATCH).take(3) {
        let lines: Vec<String> = batch.iter().map(|c| c.text.clone()).collect();
        let out = translator::translate_batch("http://127.0.0.1:18291", &lines).expect("translate");
        assert_eq!(out.len(), lines.len());
        for (ja, zh) in lines.iter().zip(&out) {
            eprintln!("  {ja}\n    → {}", zh.as_deref().unwrap_or("(原文)"));
        }
        translated += out.iter().filter(|z| z.is_some()).count();
        total += out.len();
    }
    eprintln!("translated {translated}/{total} in {:.1}s", t.elapsed().as_secs_f64());
    assert!(translated * 10 >= total * 8, "only {translated}/{total} translated");
}

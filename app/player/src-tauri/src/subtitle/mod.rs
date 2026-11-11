//! Local subtitle pipelines.
//!
//! Layout:
//! - [`tracks`] — embedded subtitle streams: probe + convert to SRT text
//! - [`audio`] — ffmpeg (sidecar/PATH) clip extraction, 16 kHz mono WAV
//! - [`sidecar`] — whisper-server / llama-server processes; one on the GPU
//!   at a time, killed to give VRAM back
//! - [`whisper`] — recognition: clips → Japanese cues (boundary rule, cleanup)
//! - [`speech`] — VAD over each clip: cue start/end snapped to the voice
//! - [`translator`] — Murasaki ja→zh batches (alignment discipline, cleanup)
//! - [`assets`] / [`storage`] — downloads and the (non-system-drive) data dir
//! - [`commands`] — the Tauri command surface; the schedule itself lives in
//!   the frontend (`src/subtitle/generate.ts`, CONTRACT §34)

pub mod assets;
pub mod audio;
pub mod commands;
pub mod logging;
pub mod sidecar;
pub mod speech;
pub mod storage;
pub mod tracks;
pub mod translator;
pub mod whisper;

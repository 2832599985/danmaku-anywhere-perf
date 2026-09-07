//! Local speech-to-text subtitle pipeline (audio → cues).
//!
//! Layout:
//! - [`audio`] — ffmpeg sidecar/PATH audio extraction (16 kHz mono WAV)
//! - [`commands`] — the Tauri command surface + the pipeline thread
//!
//! Concurrency: ONE transcription task at a time (inference saturates
//! CPU/GPU and would fight the upscale engine). [`commands::TaskRegistry`]
//! enforces single-flight and carries the cancellation flag. The flag is
//! checked between pipeline steps and inside the ffmpeg output loop; a cancel
//! kills the child process and cleans up temp files.

pub mod asr;
pub mod audio;
pub mod commands;
pub mod logging;
pub mod models;

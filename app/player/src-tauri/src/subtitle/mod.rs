//! Local subtitle pipelines.
//!
//! Layout:
//! - [`audio`] — ffmpeg sidecar/PATH audio extraction (16 kHz mono WAV)
//! - [`tracks`] — embedded subtitle streams: probe + convert to SRT text
//! - [`commands`] — the Tauri command surface + the pipeline thread
//!
//! Concurrency: ONE transcription task at a time (inference saturates
//! CPU/GPU and would fight the upscale engine). [`commands::TaskRegistry`]
//! enforces single-flight and carries the cancellation flag. The flag is
//! checked between pipeline steps and inside the ffmpeg output loop; a cancel
//! kills the child process and cleans up temp files. Embedded-track probing and
//! extraction are short-lived ffmpeg runs and are NOT serialized against it —
//! they never touch the ASR model or its temp dir.

pub mod asr;
pub mod audio;
pub mod commands;
pub mod logging;
pub mod models;
pub mod tracks;

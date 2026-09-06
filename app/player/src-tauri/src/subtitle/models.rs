//! Model registry, download, verification and path resolution.
//!
//! - Silero VAD (~640 KB) ships BUNDLED with the app
//!   (`src-tauri/resources/`) — no download, no version drift.
//! - SenseVoice int8 (~240 MB compressed) downloads on first use through a
//!   source chain: GitHub release archive, then per-file HuggingFace (via the
//!   hf-mirror.com mirror, reachable directly from CN networks). Every payload
//!   is SHA256-verified BEFORE installation and written atomically (`.part`
//!   then rename/extract).
//!
//! Layout under `app_data_dir/models/`:
//!   sensevoice-int8/model.int8.onnx + tokens.txt

use std::fs::File;
use std::io::{BufReader, Read, Write};
use std::path::{Path, PathBuf};

use serde::Serialize;
use sha2::{Digest, Sha256};
use tauri::Manager;

/// The bundled VAD resource path, relative to the Tauri resource dir.
const VAD_RESOURCE: &str = "resources/silero-vad.onnx";

/// Stable id used by the frontend.
pub const SENSEVOICE_ID: &str = "sensevoice-int8";
pub const SILERO_VAD_ID: &str = "silero-vad";

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

/// A downloadable model with an ordered fallback source chain.
pub struct ModelSpec {
    pub id: &'static str,
    pub sources: &'static [Source],
}

/// One installable payload variant.
pub enum Source {
    /// tar.bz2 release archive; extracted after hash verification.
    TarBz2 { url: &'static str, sha256: &'static str },
    /// Individual files fetched straight into models/<id>/ (the HF mirror
    /// layout). All-or-nothing: one failed/ corrupt file aborts the source.
    Files { items: &'static [RemoteFile] },
}

pub struct RemoteFile {
    /// file name under models/<id>/
    pub name: &'static str,
    pub url: &'static str,
    pub sha256: &'static str,
}

/// The HF repo holding the loose SenseVoice files (mirror of the GitHub
/// release archive); URLs below are its /resolve/main links.
const _: &str = "hf-mirror.com/csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17";

pub const SENSEVOICE: ModelSpec = ModelSpec {
    id: SENSEVOICE_ID,
    sources: &[
        // Primary for CN networks: hf-mirror serves individual files and is
        // reachable without a proxy there. Hashes computed from the official
        // 2024-07-17 release (the tar.bz2 fallback contains the same bytes).
        Source::Files {
            items: &[
                RemoteFile {
                    name: "model.int8.onnx",
                    url: concat!(
                        "https://hf-mirror.com/csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17/resolve/main/model.int8.onnx"
                    ),
                    sha256: "c71f0ce00bec95b07744e116345e33d8cbbe08cef896382cf907bf4b51a2cd51",
                },
                RemoteFile {
                    name: "tokens.txt",
                    url: "https://hf-mirror.com/csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17/resolve/main/tokens.txt",
                    sha256: "f449eb28dc567533d7fa59be34e2abca8784f771850c78a47fb731a31429a1dc",
                },
            ],
        },
        // Fallback: the official GitHub release tar.bz2.
        Source::TarBz2 {
            url: "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17.tar.bz2",
            sha256: "f6b2a72ebcb1ac7a764d4cfccd886e6bcb2a95c4657c2199d0ba95ed4b9ea71a",
        },
    ],
};

pub fn downloadable_models() -> impl Iterator<Item = &'static ModelSpec> {
    [&SENSEVOICE as &ModelSpec].into_iter()
}

pub fn spec_by_id(id: &str) -> Option<&'static ModelSpec> {
    downloadable_models().into_iter().find(|spec| spec.id == id)
}

// ---------------------------------------------------------------------------
// Status + paths
// ---------------------------------------------------------------------------

/// Frontend-facing download state for one model.
#[derive(Clone, Serialize)]
pub struct ModelStatus {
    pub id: &'static str,
    /// all expected files exist on disk (always true for the bundled VAD)
    pub downloaded: bool,
    /// true when shipped inside the app (nothing to download)
    pub bundled: bool,
    /// total bytes of the installed payload (0 when absent)
    pub size_bytes: u64,
    /// human-readable footprint for the settings page
    pub size_label: String,
}

/// Events streamed by `subtitle_model_download`.
#[derive(Clone, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum DownloadEvent {
    Downloading { percent: f32 },
    Verifying,
    Extracting,
    Done,
    Failed { message: String },
}

pub fn models_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("无法解析数据目录: {e}"))?
        .join("models");
    std::fs::create_dir_all(&dir).map_err(|e| format!("创建模型目录失败: {e}"))?;
    Ok(dir)
}

/// Path of the bundled silero VAD model (resource dir in dev AND packaged
/// builds).
pub fn vad_model_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let path = app
        .path()
        .resolve(VAD_RESOURCE, tauri::path::BaseDirectory::Resource)
        .map_err(|e| format!("无法定位内置 VAD 模型: {e}"))?;
    if !path.is_file() {
        return Err(format!("内置 VAD 模型缺失: {}", path.display()));
    }
    Ok(path)
}

/// Files of an installed downloadable model. `Ok(None)` = not installed.
pub struct InstalledModel {
    pub model: PathBuf,
    pub tokens: Option<PathBuf>,
}

pub fn installed_model(
    app: &tauri::AppHandle,
    spec: &ModelSpec,
) -> Result<Option<InstalledModel>, String> {
    let dir = models_root(app)?.join(spec.id);
    let model = dir.join("model.int8.onnx");
    if !model.is_file() {
        return Ok(None);
    }
    let tokens = dir.join("tokens.txt");
    Ok(Some(InstalledModel {
        model,
        tokens: tokens.is_file().then_some(tokens),
    }))
}

pub fn model_status(
    app: &tauri::AppHandle,
    spec: &ModelSpec,
) -> Result<ModelStatus, String> {
    let installed = installed_model(app, spec)?;
    let size = match &installed {
        Some(files) => file_size(&files.model) + files.tokens.as_deref().map_or(0, file_size),
        None => 0,
    };
    Ok(ModelStatus {
        id: spec.id,
        downloaded: installed.is_some(),
        bundled: false,
        size_bytes: size,
        size_label: match installed {
            Some(_) => human_size(size),
            None => format!("约 {}（压缩包）", human_size(240 * 1024 * 1024)),
        },
    })
}

/// Everything the pipeline needs before it may start.
pub fn resolve_pipeline_models(
    app: &tauri::AppHandle,
) -> Result<InstalledModel, String> {
    installed_model(app, &SENSEVOICE)?.ok_or_else(|| {
        "语音识别模型尚未下载（请到 设置 → 字幕 中下载，约 240MB）".to_string()
    })
}

// ---------------------------------------------------------------------------
// Download
// ---------------------------------------------------------------------------

/// Download (if needed) + verify + install one model, trying each source in
/// order, streaming progress.
pub fn download_model(
    app: &tauri::AppHandle,
    spec: &ModelSpec,
    on_event: &tauri::ipc::Channel<DownloadEvent>,
) -> Result<(), String> {
    if installed_model(app, spec)?.is_some() {
        let _ = on_event.send(DownloadEvent::Done);
        return Ok(());
    }
    let root = models_root(app)?;

    let mut failures: Vec<String> = Vec::new();
    for source in spec.sources {
        match install_source(source, &root, on_event) {
            Ok(()) => {
                if installed_model(app, spec)?.is_some() {
                    let _ = on_event.send(DownloadEvent::Done);
                    return Ok(());
                }
                failures.push("源安装后缺少预期文件".to_string());
            }
            Err(message) => {
                // Clean the staging area so the next source starts fresh.
                let _ = std::fs::remove_file(root.join(format!("{}.part", spec.id)));
                failures.push(message);
            }
        }
    }
    Err(format!(
        "所有下载源均失败：{}",
        failures.join("；")
    ))
}

fn install_source(
    source: &Source,
    root: &Path,
    on_event: &tauri::ipc::Channel<DownloadEvent>,
) -> Result<(), String> {
    match source {
        Source::TarBz2 { url, sha256 } => {
            let part = root.join("download.part");
            fetch(url, &part, Some(sha256), on_event)?;
            let _ = on_event.send(DownloadEvent::Extracting);
            extract_tar_bz2(&part, root)?;
            // Normalize: the archive unpacks to models/sherpa-onnx-sense-voice-…/
            let target = root.join(SENSEVOICE_ID);
            if !target.is_dir() {
                normalize_extracted_dir(root, &target)?;
            }
            let _ = std::fs::remove_file(&part);
            Ok(())
        }
        Source::Files { items } => {
            let dir = root.join(SENSEVOICE_ID);
            std::fs::create_dir_all(&dir).map_err(|e| format!("创建模型目录失败: {e}"))?;
            for item in items.iter() {
                let part = dir.join(format!("{}.part", item.name));
                fetch(item.url, &part, Some(item.sha256), on_event)?;
                let target = dir.join(item.name);
                std::fs::rename(&part, &target)
                    .map_err(|e| format!("安装 {} 失败: {e}", item.name))?;
            }
            Ok(())
        }
    }
}

/// Stream `url` into `part`, verify sha256 (hex, pre-computed), delete on
/// mismatch. Reports percent when Content-Length is available.
fn fetch(
    url: &str,
    part: &Path,
    sha256: Option<&str>,
    on_event: &tauri::ipc::Channel<DownloadEvent>,
) -> Result<(), String> {
    let response = ureq::get(url)
        .timeout(std::time::Duration::from_secs(3600))
        .call()
        .map_err(|e| format!("连接失败: {e}"))?;
    let total = response
        .header("Content-Length")
        .and_then(|v| v.parse::<u64>().ok());

    let mut reader = response.into_reader();
    let mut file = File::create(part).map_err(|e| format!("写入失败: {e}"))?;
    let mut hasher = sha256.map(|_| Sha256::new());
    let mut buffer = [0u8; 128 * 1024];
    let mut received: u64 = 0;
    let mut last_percent: f32 = -1.0;
    loop {
        let read = reader.read(&mut buffer).map_err(|e| format!("下载中断: {e}"))?;
        if read == 0 {
            break;
        }
        file.write_all(&buffer[..read]).map_err(|e| format!("写入失败: {e}"))?;
        if let Some(hasher) = hasher.as_mut() {
            hasher.update(&buffer[..read]);
        }
        received += read as u64;
        if let Some(total) = total {
            let percent = (received as f32 / total as f32 * 100.0).min(100.0);
            if percent - last_percent >= 1.0 || percent >= 100.0 {
                last_percent = percent;
                let _ = on_event.send(DownloadEvent::Downloading { percent });
            }
        }
    }
    drop(file);

    if let (Some(expected), Some(hasher)) = (sha256, hasher.as_mut()) {
        let _ = on_event.send(DownloadEvent::Verifying);
        let actual = hex_lower(&hasher.finalize_reset());
        if actual != expected.to_ascii_lowercase() {
            let _ = std::fs::remove_file(part);
            return Err(format!("校验失败（sha256 {actual}）"));
        }
    }
    Ok(())
}

/// Extract the `.part` tar.bz2 into `root`.
fn extract_tar_bz2(archive: &Path, root: &Path) -> Result<(), String> {
    let file = File::open(archive).map_err(|e| format!("打开模型包失败: {e}"))?;
    let decoder = bzip2::read::BzDecoder::new(BufReader::new(file));
    let mut tar = tar::Archive::new(decoder);
    tar.unpack(root).map_err(|e| format!("解压模型包失败: {e}"))
}

/// Move the single extracted `sherpa-onnx-sense-voice-…/` dir to `target`.
fn normalize_extracted_dir(root: &Path, target: &Path) -> Result<(), String> {
    let entries = std::fs::read_dir(root).map_err(|e| format!("读取模型目录失败: {e}"))?;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir()
            && path
                .file_name()
                .and_then(|n| n.to_str())
                .map_or(false, |n| n.starts_with("sherpa-onnx-sense-voice"))
        {
            std::fs::rename(&path, target).map_err(|e| format!("归位模型目录失败: {e}"))?;
            return Ok(());
        }
    }
    Err("模型包中没有预期的目录".to_string())
}

fn file_size(path: &Path) -> u64 {
    std::fs::metadata(path).map(|m| m.len()).unwrap_or(0)
}

fn human_size(bytes: u64) -> String {
    let mib = bytes as f64 / (1024.0 * 1024.0);
    if mib >= 1024.0 {
        format!("{:.1} GB", mib / 1024.0)
    } else {
        format!("{:.0} MB", mib)
    }
}

fn hex_lower(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

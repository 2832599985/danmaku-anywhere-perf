//! Downloadable assets of the subtitle pipeline: the two models and the
//! sidecar runtimes, all under the data directory ([`super::storage`]):
//!
//! ```text
//! <data>/models/ggml-large-v3-turbo-q5_0.bin   whisper large-v3-turbo q5_0 (recognition)
//! <data>/models/Murasaki-4B-v0.3.IQ4_XS.gguf   Murasaki 4B (ja→zh translation)
//! <data>/runtime/whisper-cpu/whisper-server.exe   whisper.cpp b5454, CPU
//! <data>/runtime/whisper-cuda/whisper-server.exe  whisper.cpp b5454, CUDA 12.4 (optional, NVIDIA only)
//! <data>/runtime/llama/llama-server.exe           llama.cpp b10909, Vulkan (also runs CPU-only)
//! ```
//!
//! The silero VAD (885 KB, ggml) ships bundled in `resources/`.
//!
//! Every payload is SHA256-verified before installation. Downloads RESUME
//! (`.part` + HTTP Range) — the translation model alone is 2.4 GB. Zips are
//! extracted into a staging dir and renamed into place, so a half-installed
//! runtime is never mistaken for a working one.

use std::fs::{File, OpenOptions};
use std::io::{BufReader, Read, Write};
use std::path::{Path, PathBuf};

use serde::Serialize;
use sha2::{Digest, Sha256};
use tauri::Manager;

use super::storage;

/// The bundled VAD model, relative to the Tauri resource dir.
const VAD_RESOURCE: &str = "resources/ggml-silero-v5.1.2.bin";

pub struct AssetSpec {
    /// stable id used by the frontend
    pub id: &'static str,
    pub kind: Kind,
    /// expected download size (progress before Content-Length, settings label)
    pub bytes: u64,
    /// optional = never required to generate subtitles (CUDA acceleration)
    pub optional: bool,
    /// tried in order; all carry the same bytes
    pub sources: &'static [&'static str],
    pub sha256: &'static str,
}

pub enum Kind {
    /// a single file at `<data>/<rel>`
    File { rel: &'static str },
    /// a zip extracted into `<data>/<rel>`; `main` must exist inside it.
    /// Archives with a wrapper folder (`Release/…`) are flattened.
    Zip { rel: &'static str, main: &'static str },
}

pub const WHISPER_MODEL: AssetSpec = AssetSpec {
    id: "whisper-turbo-q5",
    kind: Kind::File { rel: "models/ggml-large-v3-turbo-q5_0.bin" },
    bytes: 574_041_195,
    optional: false,
    sources: &[
        "https://hf-mirror.com/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q5_0.bin",
        "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q5_0.bin",
    ],
    sha256: "394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2",
};

/// CC-BY-NC-SA-4.0 (personal, non-commercial use).
pub const MT_MODEL: AssetSpec = AssetSpec {
    id: "murasaki-4b",
    kind: Kind::File { rel: "models/Murasaki-4B-v0.3.IQ4_XS.gguf" },
    bytes: 2_492_949_504,
    optional: false,
    sources: &[
        "https://hf-mirror.com/mradermacher/Murasaki-4B-v0.3-GGUF/resolve/main/Murasaki-4B-v0.3.IQ4_XS.gguf",
        "https://huggingface.co/mradermacher/Murasaki-4B-v0.3-GGUF/resolve/main/Murasaki-4B-v0.3.IQ4_XS.gguf",
    ],
    sha256: "1663e14af7d3167c2e62e460986bf5219b6051e48df1ebd98b96ea5ffb7baa87",
};

pub const WHISPER_CPU: AssetSpec = AssetSpec {
    id: "whisper-cpu",
    kind: Kind::Zip { rel: "runtime/whisper-cpu", main: "whisper-server.exe" },
    bytes: 8_928_640,
    optional: false,
    sources: &[
        "https://ghfast.top/https://github.com/ggml-org/whisper.cpp/releases/download/b5454/whisper-bin-x64.zip",
        "https://github.com/ggml-org/whisper.cpp/releases/download/b5454/whisper-bin-x64.zip",
    ],
    sha256: "6ba69e3482d7826214f90a6a9c84ca07782aec1e1d0c6a7c30c994fd5d816ccb",
};

/// Carries its own cuBLAS/cudart (the CUDA 11.8 asset does NOT — it silently
/// falls back to CPU). Only useful on NVIDIA cards.
pub const WHISPER_CUDA: AssetSpec = AssetSpec {
    id: "whisper-cuda",
    kind: Kind::Zip { rel: "runtime/whisper-cuda", main: "whisper-server.exe" },
    bytes: 684_913_404,
    optional: true,
    sources: &[
        "https://ghfast.top/https://github.com/ggml-org/whisper.cpp/releases/download/b5454/whisper-bin-win-cuda-12.4.0-x64.zip",
        "https://github.com/ggml-org/whisper.cpp/releases/download/b5454/whisper-bin-win-cuda-12.4.0-x64.zip",
    ],
    sha256: "afef0b881c500958921c3f5523b50e59ee2ec9b6f5cbd25b324c51ed308a957a",
};

/// The Vulkan build also carries every ggml CPU backend; with `-dev none`
/// it runs CPU-only and touches no VRAM (measured), so one runtime serves
/// both modes.
pub const LLAMA: AssetSpec = AssetSpec {
    id: "llama",
    kind: Kind::Zip { rel: "runtime/llama", main: "llama-server.exe" },
    bytes: 31_667_126,
    optional: false,
    sources: &[
        "https://ghfast.top/https://github.com/ggml-org/llama.cpp/releases/download/b10909/llama-b10909-bin-win-vulkan-x64.zip",
        "https://github.com/ggml-org/llama.cpp/releases/download/b10909/llama-b10909-bin-win-vulkan-x64.zip",
    ],
    sha256: "96b2efab6e6b0498d5d4809a30b7981868be8a1ada9cd76b92f3b1f1fdba4772",
};

pub const ALL: [&AssetSpec; 5] = [&WHISPER_MODEL, &MT_MODEL, &WHISPER_CPU, &WHISPER_CUDA, &LLAMA];

pub fn by_id(id: &str) -> Option<&'static AssetSpec> {
    ALL.into_iter().find(|spec| spec.id == id)
}

/// Installed path: the file itself, or the runtime's main executable.
pub fn path_of(app: &tauri::AppHandle, spec: &AssetSpec) -> Result<PathBuf, String> {
    let data = storage::data_dir(app)?;
    Ok(match spec.kind {
        Kind::File { rel } => data.join(rel),
        Kind::Zip { rel, main } => data.join(rel).join(main),
    })
}

/// Installed path, or a user-facing "download it first" error.
pub fn require(app: &tauri::AppHandle, spec: &AssetSpec) -> Result<PathBuf, String> {
    let path = path_of(app, spec)?;
    if path.is_file() {
        Ok(path)
    } else {
        Err(format!("{} 尚未下载（设置 → 字幕 → AI 字幕）", label(spec)))
    }
}

pub fn label(spec: &AssetSpec) -> &'static str {
    match spec.id {
        "whisper-turbo-q5" => "语音识别模型",
        "murasaki-4b" => "翻译模型",
        "whisper-cpu" => "识别运行时",
        "whisper-cuda" => "识别显卡加速包",
        "llama" => "翻译运行时",
        _ => "组件",
    }
}

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

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetStatus {
    pub id: &'static str,
    pub label: &'static str,
    pub installed: bool,
    pub optional: bool,
    /// full download size
    pub bytes: u64,
    /// bytes already in a resumable `.part` (0 when none)
    pub partial_bytes: u64,
}

pub fn status(app: &tauri::AppHandle, spec: &'static AssetSpec) -> Result<AssetStatus, String> {
    let installed = path_of(app, spec)?.is_file();
    let partial = std::fs::metadata(part_path(app, spec)?).map(|m| m.len()).unwrap_or(0);
    Ok(AssetStatus {
        id: spec.id,
        label: label(spec),
        installed,
        optional: spec.optional,
        bytes: spec.bytes,
        partial_bytes: if installed { 0 } else { partial },
    })
}

fn part_path(app: &tauri::AppHandle, spec: &AssetSpec) -> Result<PathBuf, String> {
    Ok(storage::data_dir(app)?.join("downloads").join(format!("{}.part", spec.id)))
}

// ---------------------------------------------------------------------------
// Download
// ---------------------------------------------------------------------------

#[derive(Clone, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum DownloadEvent {
    Downloading { received: u64, total: u64 },
    Verifying,
    Extracting,
    Done,
    Failed { message: String },
}

/// Download + verify + install, trying each source in order.
pub fn download(
    app: &tauri::AppHandle,
    spec: &'static AssetSpec,
    on_event: &tauri::ipc::Channel<DownloadEvent>,
) -> Result<(), String> {
    if path_of(app, spec)?.is_file() {
        let _ = on_event.send(DownloadEvent::Done);
        return Ok(());
    }
    let part = part_path(app, spec)?;
    if let Some(parent) = part.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("创建下载目录失败: {e}"))?;
    }
    let mut failures: Vec<String> = Vec::new();
    for url in spec.sources {
        match fetch_resumable(url, &part, spec.bytes, on_event) {
            Ok(()) => {}
            Err(message) => {
                failures.push(message);
                continue;
            }
        }
        let _ = on_event.send(DownloadEvent::Verifying);
        let actual = sha256_file(&part)?;
        if actual != spec.sha256 {
            // A corrupt/foreign payload must not be resumed from either.
            let _ = std::fs::remove_file(&part);
            failures.push(format!("校验失败（sha256 {actual}）"));
            continue;
        }
        install(app, spec, &part, on_event)?;
        let _ = std::fs::remove_file(&part);
        let _ = on_event.send(DownloadEvent::Done);
        return Ok(());
    }
    Err(format!("所有下载源均失败：{}", failures.join("；")))
}

fn agent() -> ureq::Agent {
    // Honour HTTPS_PROXY/ALL_PROXY like every other CLI on the machine.
    ureq::AgentBuilder::new()
        .try_proxy_from_env(true)
        .timeout_connect(std::time::Duration::from_secs(20))
        .timeout_read(std::time::Duration::from_secs(60))
        .build()
}

fn fetch_resumable(
    url: &str,
    part: &Path,
    expected: u64,
    on_event: &tauri::ipc::Channel<DownloadEvent>,
) -> Result<(), String> {
    let have = std::fs::metadata(part).map(|m| m.len()).unwrap_or(0);
    if have == expected {
        return Ok(()); // complete from an earlier run; verification decides
    }
    let mut request = agent().get(url);
    if have > 0 && have < expected {
        request = request.set("Range", &format!("bytes={have}-"));
    }
    let response = request.call().map_err(|e| format!("连接失败: {e}"))?;
    let resumed = response.status() == 206;
    let mut file = if resumed {
        OpenOptions::new().append(true).open(part)
    } else {
        File::create(part)
    }
    .map_err(|e| format!("写入失败: {e}"))?;
    let mut received = if resumed { have } else { 0 };
    let total = response
        .header("Content-Length")
        .and_then(|v| v.parse::<u64>().ok())
        .map(|len| len + received)
        .unwrap_or(expected);

    let mut reader = response.into_reader();
    let mut buffer = vec![0u8; 256 * 1024];
    let mut last_report = 0u64;
    loop {
        let read = reader.read(&mut buffer).map_err(|e| format!("下载中断: {e}"))?;
        if read == 0 {
            break;
        }
        file.write_all(&buffer[..read]).map_err(|e| format!("写入失败: {e}"))?;
        received += read as u64;
        if received - last_report >= 4 * 1024 * 1024 || received == total {
            last_report = received;
            let _ = on_event.send(DownloadEvent::Downloading { received, total });
        }
    }
    file.flush().map_err(|e| format!("写入失败: {e}"))?;
    if received < total {
        return Err(format!("下载不完整（{received}/{total}）"));
    }
    Ok(())
}

fn sha256_file(path: &Path) -> Result<String, String> {
    let mut file = BufReader::new(File::open(path).map_err(|e| format!("读取失败: {e}"))?);
    let mut hasher = Sha256::new();
    let mut buffer = vec![0u8; 1024 * 1024];
    loop {
        let read = file.read(&mut buffer).map_err(|e| format!("读取失败: {e}"))?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(hasher.finalize().iter().map(|b| format!("{b:02x}")).collect())
}

fn install(
    app: &tauri::AppHandle,
    spec: &AssetSpec,
    part: &Path,
    on_event: &tauri::ipc::Channel<DownloadEvent>,
) -> Result<(), String> {
    let data = storage::data_dir(app)?;
    match spec.kind {
        Kind::File { rel } => {
            let target = data.join(rel);
            if let Some(parent) = target.parent() {
                std::fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {e}"))?;
            }
            std::fs::rename(part, &target).map_err(|e| format!("安装失败: {e}"))
        }
        Kind::Zip { rel, main } => {
            let _ = on_event.send(DownloadEvent::Extracting);
            let target = data.join(rel);
            let staging = data.join(format!("{rel}.staging"));
            let _ = std::fs::remove_dir_all(&staging);
            extract_zip_flat(part, &staging, main)?;
            let _ = std::fs::remove_dir_all(&target);
            if let Some(parent) = target.parent() {
                std::fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {e}"))?;
            }
            std::fs::rename(&staging, &target).map_err(|e| format!("安装运行时失败: {e}"))
        }
    }
}

/// Extract the folder that contains `main` (archives wrap everything in
/// `Release/` or put it at the root) into `dir`. Entries outside that folder
/// are skipped; `enclosed_name` rejects zip-slip paths.
fn extract_zip_flat(archive: &Path, dir: &Path, main: &str) -> Result<(), String> {
    let file = File::open(archive).map_err(|e| format!("打开压缩包失败: {e}"))?;
    let mut zip = zip::ZipArchive::new(BufReader::new(file)).map_err(|e| format!("压缩包损坏: {e}"))?;
    let prefix = zip_prefix(zip.file_names(), main).ok_or_else(|| format!("压缩包里没有 {main}"))?;
    for index in 0..zip.len() {
        let mut entry = zip.by_index(index).map_err(|e| format!("读取压缩包失败: {e}"))?;
        let Some(name) = entry.enclosed_name() else { continue };
        let Ok(relative) = name.strip_prefix(&prefix) else { continue };
        if relative.as_os_str().is_empty() {
            continue;
        }
        let out = dir.join(relative);
        if entry.is_dir() {
            std::fs::create_dir_all(&out).map_err(|e| format!("解压失败: {e}"))?;
            continue;
        }
        if let Some(parent) = out.parent() {
            std::fs::create_dir_all(parent).map_err(|e| format!("解压失败: {e}"))?;
        }
        let mut writer = File::create(&out).map_err(|e| format!("解压失败: {e}"))?;
        std::io::copy(&mut entry, &mut writer).map_err(|e| format!("解压失败: {e}"))?;
    }
    Ok(())
}

/// The directory prefix of the shallowest `main` entry ("" or "Release").
fn zip_prefix<'a>(names: impl Iterator<Item = &'a str>, main: &str) -> Option<PathBuf> {
    names
        .map(|n| n.replace('\\', "/"))
        .filter(|n| n == main || n.ends_with(&format!("/{main}")))
        .min_by_key(|n| n.matches('/').count())
        .map(|n| PathBuf::from(&n[..n.len() - main.len()].trim_end_matches('/')))
}

/// Bytes on disk of an installed asset (file, or the runtime directory).
pub fn installed_bytes(app: &tauri::AppHandle, spec: &AssetSpec) -> u64 {
    let Ok(path) = path_of(app, spec) else { return 0 };
    match spec.kind {
        Kind::File { .. } => std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0),
        Kind::Zip { .. } => path.parent().map(dir_size).unwrap_or(0),
    }
}

fn dir_size(dir: &Path) -> u64 {
    std::fs::read_dir(dir)
        .map(|entries| {
            entries
                .flatten()
                .map(|e| match e.metadata() {
                    Ok(m) if m.is_dir() => dir_size(&e.path()),
                    Ok(m) => m.len(),
                    Err(_) => 0,
                })
                .sum()
        })
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn zip_prefix_handles_wrapper_and_root_layouts() {
        let wrapped = ["Release/bench.exe", "Release/whisper-server.exe", "Release/ggml.dll"];
        assert_eq!(zip_prefix(wrapped.into_iter(), "whisper-server.exe"), Some(PathBuf::from("Release")));
        let flat = ["ggml-vulkan.dll", "llama-server.exe"];
        assert_eq!(zip_prefix(flat.into_iter(), "llama-server.exe"), Some(PathBuf::from("")));
        let nested = ["a/b/llama-server.exe", "a/llama-server.exe"];
        assert_eq!(zip_prefix(nested.into_iter(), "llama-server.exe"), Some(PathBuf::from("a")));
        assert_eq!(zip_prefix(["x.exe"].into_iter(), "llama-server.exe"), None);
        // `foo-llama-server.exe` is not the main binary.
        assert_eq!(zip_prefix(["foo-llama-server.exe"].into_iter(), "llama-server.exe"), None);
    }

    #[test]
    fn ids_are_unique() {
        let mut ids: Vec<_> = ALL.iter().map(|s| s.id).collect();
        ids.sort();
        ids.dedup();
        assert_eq!(ids.len(), ALL.len());
    }
}

//! Model-server sidecars: `whisper-server` (recognition) and `llama-server`
//! (translation), driven over loopback HTTP.
//!
//! Why processes instead of linked libraries: no native inference build in
//! the app, a model crash/OOM cannot take the player down, and — the reason
//! this design exists — **killing the process is how VRAM is returned**. The
//! player's own Anime4K/Framegen pipeline needs the GPU back the moment the
//! user resumes, and an in-library free is far less dependable than an exit.
//!
//! Scheduling rule enforced here: **at most ONE sidecar on the GPU** at a
//! time (measured on an 8 GB card with Anime4K at its top tier: ~3.1 GB free;
//! whisper ≈ 1 GB, Murasaki ≈ 2.5 GB — each fits, both do not). Starting a GPU
//! engine kills the other engine first if it is on the GPU. CPU engines may
//! stay resident (RAM only).
//!
//! A GPU start that fails (process dies during load — OOM, missing driver) is
//! retried on the CPU; the lease reports which one is actually serving.
//!
//! Every child joins a kill-on-close Job Object, so if the player exits or
//! crashes no server is left behind holding gigabytes of (V)RAM.

use std::ffi::OsString;
use std::net::TcpListener;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::{Mutex, MutexGuard};
use std::time::{Duration, Instant};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

use super::assets;
use super::audio::CREATE_NO_WINDOW;
use super::logging;
use super::storage;

/// Model load from disk: the 2.4 GB translation model takes ~5 s from SSD,
/// far longer from a cold HDD.
const START_TIMEOUT: Duration = Duration::from_secs(180);

/// One running server process. Dropping it kills the process.
pub struct Sidecar {
    child: Child,
    pub base: String,
    log: PathBuf,
}

impl Sidecar {
    fn spawn(name: &str, exe: &PathBuf, args: Vec<OsString>, log: PathBuf) -> Result<Sidecar, String> {
        if !exe.is_file() {
            return Err(format!("缺少 {}", exe.display()));
        }
        let port = free_port()?;
        if let Some(parent) = log.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let log_file = std::fs::File::create(&log).map_err(|e| format!("创建日志失败: {e}"))?;
        let mut command = Command::new(exe);
        command
            .args(&args)
            .arg("--host")
            .arg("127.0.0.1")
            .arg("--port")
            .arg(port.to_string())
            // The runtimes load DLLs (ggml backends, cuBLAS) from their own dir.
            .current_dir(exe.parent().unwrap_or(std::path::Path::new(".")))
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(log_file);
        #[cfg(windows)]
        command.creation_flags(CREATE_NO_WINDOW);
        let child = command.spawn().map_err(|e| format!("启动 {name} 失败: {e}"))?;
        job::adopt(&child);
        let mut sidecar = Sidecar {
            child,
            base: format!("http://127.0.0.1:{port}"),
            log,
        };
        logging::write(&format!("sidecar {name}: spawned port={port} args={args:?}"));
        let deadline = Instant::now() + START_TIMEOUT;
        loop {
            if !sidecar.alive() {
                return Err(format!("{name} 启动失败：{}", sidecar.log_tail()));
            }
            if health(&sidecar.base) {
                return Ok(sidecar);
            }
            if Instant::now() > deadline {
                return Err(format!("{name} 启动超时：{}", sidecar.log_tail()));
            }
            std::thread::sleep(Duration::from_millis(150));
        }
    }

    pub fn alive(&mut self) -> bool {
        matches!(self.child.try_wait(), Ok(None))
    }

    /// Last meaningful lines of the server's stderr (startup diagnostics).
    pub fn log_tail(&self) -> String {
        let text = std::fs::read_to_string(&self.log).unwrap_or_default();
        let lines: Vec<&str> = text
            .lines()
            .filter(|l| {
                let l = l.to_ascii_lowercase();
                l.contains("error") || l.contains("fail") || l.contains("out of memory")
            })
            .collect();
        let pick = if lines.is_empty() {
            text.lines().rev().take(2).collect::<Vec<_>>().join(" | ")
        } else {
            lines[lines.len().saturating_sub(2)..].join(" | ")
        };
        pick.chars().take(300).collect()
    }
}

impl Drop for Sidecar {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

fn free_port() -> Result<u16, String> {
    let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| format!("找不到可用端口: {e}"))?;
    let port = listener.local_addr().map_err(|e| format!("读取端口失败: {e}"))?.port();
    drop(listener);
    Ok(port)
}

fn health(base: &str) -> bool {
    // llama-server answers 503 while the model is loading, 200 once ready.
    ureq::get(&format!("{base}/health"))
        .timeout(Duration::from_secs(2))
        .call()
        .map(|r| r.status() == 200)
        .unwrap_or(false)
}

// ---------------------------------------------------------------------------
// The two engines
// ---------------------------------------------------------------------------

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Engine {
    /// whisper-server
    Asr,
    /// llama-server
    Mt,
}

impl Engine {
    fn name(self) -> &'static str {
        match self {
            Engine::Asr => "whisper-server",
            Engine::Mt => "llama-server",
        }
    }
}

struct Running {
    sidecar: Sidecar,
    gpu: bool,
}

/// What a caller gets: where to send requests and what actually serves them.
#[derive(Clone, Debug)]
pub struct Lease {
    pub base: String,
    pub gpu: bool,
}

#[derive(Default)]
pub struct Engines {
    asr: Mutex<Option<Running>>,
    mt: Mutex<Option<Running>>,
}

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|p| p.into_inner())
}

/// CPU threads: leave cores for video decode, WebView2 and the other engine
/// (recognition and translation may run side by side while following).
fn threads(engine: Engine) -> usize {
    let cores = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(4);
    match engine {
        Engine::Asr => cores.saturating_sub(4).clamp(2, 8),
        Engine::Mt => (cores / 2).clamp(2, 4),
    }
}

/// Context window for translation: one 8-line batch (~250 tokens) + the
/// system prompt (~150) + the reply. KV for this model is 144 KB/token, so
/// 1024 costs ~0.15 GB — it is what the 2.46 GB VRAM peak was measured with.
pub const MT_CTX: u32 = 1024;

fn args_for(app: &tauri::AppHandle, engine: Engine, gpu: bool) -> Result<(PathBuf, Vec<OsString>), String> {
    let mut args: Vec<OsString> = Vec::new();
    fn push(args: &mut Vec<OsString>, items: &[&str]) {
        args.extend(items.iter().map(OsString::from));
    }
    match engine {
        Engine::Asr => {
            let exe = assets::require(app, if gpu { &assets::WHISPER_CUDA } else { &assets::WHISPER_CPU })?;
            let model = assets::require(app, &assets::WHISPER_MODEL)?;
            let vad = assets::vad_model_path(app)?;
            push(&mut args, &["-m"]);
            args.push(model.into_os_string());
            // -mc 0: never condition on the previous window's text — the
            // classic "same line repeated every 2 s" hallucination.
            // No -dtw: it forces flash-attn off (2-5x slower) and measured no
            // better than segment times against the official subtitles.
            let t = threads(Engine::Asr).to_string();
            push(&mut args, &["-mc", "0", "-l", "ja", "-t", t.as_str()]);
            if !gpu {
                push(&mut args, &["-ng"]);
            }
            push(&mut args, &["--vad", "-vm"]);
            args.push(vad.into_os_string());
            Ok((exe, args))
        }
        Engine::Mt => {
            let exe = assets::require(app, &assets::LLAMA)?;
            let model = assets::require(app, &assets::MT_MODEL)?;
            push(&mut args, &["-m"]);
            args.push(model.into_os_string());
            let ctx = MT_CTX.to_string();
            let t = threads(Engine::Mt).to_string();
            // Murasaki's GGUF template needs ChatML without jinja.
            push(&mut args, &["-c", ctx.as_str(), "-np", "1", "--no-jinja", "--chat-template", "chatml", "-t", t.as_str()]);
            if gpu {
                push(&mut args, &["-ngl", "99"]);
            } else {
                // -dev none: the Vulkan build would otherwise still offload
                // big matmuls to the GPU even with -ngl 0.
                push(&mut args, &["-ngl", "0", "-dev", "none"]);
            }
            Ok((exe, args))
        }
    }
}

impl Engines {
    /// Borrow a running engine, (re)starting it in the wanted mode. `gpu`
    /// is a request: the lease says what is actually serving.
    pub fn ensure(&self, app: &tauri::AppHandle, engine: Engine, gpu: bool) -> Result<Lease, String> {
        // Fixed lock order (asr, then mt) — the GPU rule touches both slots.
        let mut asr = lock(&self.asr);
        let mut mt = lock(&self.mt);
        let (slot, other) = match engine {
            Engine::Asr => (&mut *asr, &mut *mt),
            Engine::Mt => (&mut *mt, &mut *asr),
        };
        if let Some(running) = slot.as_mut() {
            if running.gpu == gpu && running.sidecar.alive() {
                return Ok(Lease { base: running.sidecar.base.clone(), gpu });
            }
        }
        *slot = None; // kill the wrong-mode / dead one first
        if gpu && other.as_ref().is_some_and(|o| o.gpu) {
            logging::write(&format!("sidecar: stopping GPU {} to make room", engine_other(engine).name()));
            *other = None;
        }
        let data = storage::data_dir(app)?;
        let log = |mode: &str| data.join("logs").join(format!("{}-{mode}.log", engine.name()));
        if gpu {
            match args_for(app, engine, true)
                .and_then(|(exe, args)| Sidecar::spawn(engine.name(), &exe, args, log("gpu")))
            {
                Ok(sidecar) => {
                    let base = sidecar.base.clone();
                    *slot = Some(Running { sidecar, gpu: true });
                    return Ok(Lease { base, gpu: true });
                }
                Err(message) => {
                    logging::write(&format!("sidecar {}: GPU start failed, falling back to CPU: {message}", engine.name()));
                }
            }
        }
        let (exe, args) = args_for(app, engine, false)?;
        let sidecar = Sidecar::spawn(engine.name(), &exe, args, log("cpu"))?;
        let base = sidecar.base.clone();
        *slot = Some(Running { sidecar, gpu: false });
        Ok(Lease { base, gpu: false })
    }

    /// Stop engines: `gpu_only` frees VRAM and keeps CPU engines warm.
    pub fn release(&self, gpu_only: bool) {
        for slot in [&self.asr, &self.mt] {
            let mut slot = lock(slot);
            if slot.as_ref().is_some_and(|r| r.gpu || !gpu_only) {
                *slot = None;
            }
        }
    }

    /// Kill one engine (a wedged server, or a cancel mid-request).
    pub fn stop(&self, engine: Engine) {
        match engine {
            Engine::Asr => *lock(&self.asr) = None,
            Engine::Mt => *lock(&self.mt) = None,
        }
    }

    /// (asr, mt): None = not running, Some(gpu).
    pub fn modes(&self) -> (Option<bool>, Option<bool>) {
        let probe = |slot: &Mutex<Option<Running>>| {
            let mut slot = lock(slot);
            slot.as_mut().and_then(|r| r.sidecar.alive().then_some(r.gpu))
        };
        (probe(&self.asr), probe(&self.mt))
    }
}

fn engine_other(engine: Engine) -> Engine {
    match engine {
        Engine::Asr => Engine::Mt,
        Engine::Mt => Engine::Asr,
    }
}

// ---------------------------------------------------------------------------
// GPU memory probe
// ---------------------------------------------------------------------------

/// Free VRAM in MiB on the first NVIDIA GPU, via `nvidia-smi` (ships with
/// the driver). None = no NVIDIA GPU / no driver tools — callers treat that
/// as "can't tell" and decide by asset availability instead.
pub fn nvidia_free_mb() -> Option<u32> {
    let mut command = Command::new("nvidia-smi");
    command.args(["--query-gpu=memory.used,memory.total", "--format=csv,noheader,nounits"]);
    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);
    let output = command.output().ok()?;
    if !output.status.success() {
        return None;
    }
    parse_nvidia_free(&String::from_utf8_lossy(&output.stdout))
}

fn parse_nvidia_free(text: &str) -> Option<u32> {
    let line = text.lines().next()?;
    let mut parts = line.split(',').map(|p| p.trim().parse::<u32>());
    let used = parts.next()?.ok()?;
    let total = parts.next()?.ok()?;
    Some(total.saturating_sub(used))
}

// ---------------------------------------------------------------------------
// Kill-on-close job
// ---------------------------------------------------------------------------

#[cfg(windows)]
mod job {
    use std::os::windows::io::AsRawHandle;
    use std::sync::OnceLock;

    use windows::Win32::Foundation::HANDLE;
    use windows::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
        SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
        JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };

    /// The job handle, stored as an integer (HANDLE is not Send/Sync). It is
    /// never closed: the OS closes it when the player process ends, which
    /// is exactly the moment every member must die.
    fn handle() -> Option<HANDLE> {
        static JOB: OnceLock<Option<isize>> = OnceLock::new();
        let raw = JOB.get_or_init(|| unsafe {
            // SAFETY: plain Win32 calls on a handle we own.
            let job = CreateJobObjectW(None, windows::core::PCWSTR::null()).ok()?;
            let mut info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
            info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            SetInformationJobObject(
                job,
                JobObjectExtendedLimitInformation,
                &info as *const _ as *const core::ffi::c_void,
                std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            )
            .ok()?;
            Some(job.0 as isize)
        });
        raw.map(|h| HANDLE(h as *mut core::ffi::c_void))
    }

    pub fn adopt(child: &std::process::Child) {
        if let Some(job) = handle() {
            // SAFETY: the child's process handle is valid while `child` lives.
            unsafe {
                let _ = AssignProcessToJobObject(job, HANDLE(child.as_raw_handle()));
            }
        }
    }
}

#[cfg(not(windows))]
mod job {
    pub fn adopt(_child: &std::process::Child) {}
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nvidia_smi_line_parses() {
        assert_eq!(parse_nvidia_free("5033, 8188\n"), Some(3155));
        assert_eq!(parse_nvidia_free("[N/A], 8188"), None);
        assert_eq!(parse_nvidia_free(""), None);
    }

    #[test]
    fn thread_budget_is_bounded() {
        assert!((2..=8).contains(&threads(Engine::Asr)));
        assert!((2..=4).contains(&threads(Engine::Mt)));
    }
}

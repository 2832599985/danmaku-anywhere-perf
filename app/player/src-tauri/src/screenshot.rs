//! Clean video-frame screenshots: native clipboard write (CF_DIB) plus
//! optional lossless PNG save to disk.
//!
//! Writing `CF_DIB` via Win32 directly avoids WebView2 clipboard permission
//! prompts and works with every Windows chat app (WeChat, QQ, Discord, Paint).

use std::fs;
use std::path::{Path, PathBuf};
use tauri::Manager;

/// Convert top-down RGBA8 pixels into a Windows `CF_DIB` payload
/// (40-byte `BITMAPINFOHEADER` + bottom-up 32-bit BGRA pixels).
fn rgba_to_dib(width: u32, height: u32, rgba: &[u8]) -> Result<Vec<u8>, String> {
    let expected = (width as usize)
        .checked_mul(height as usize)
        .and_then(|px| px.checked_mul(4))
        .ok_or_else(|| "截图尺寸超出范围".to_string())?;
    if expected == 0 || rgba.len() != expected {
        return Err(format!(
            "截图数据长度不匹配：期望 {expected} 字节，实际 {} 字节",
            rgba.len()
        ));
    }
    let header_size: u32 = 40;
    let image_size: u32 = expected
        .try_into()
        .map_err(|_| "截图过大，无法写入剪贴板".to_string())?;

    let mut out = Vec::with_capacity(header_size as usize + expected);
    // BITMAPINFOHEADER (40 bytes, little-endian)
    out.extend_from_slice(&header_size.to_le_bytes()); // biSize
    out.extend_from_slice(&(width as i32).to_le_bytes()); // biWidth
    out.extend_from_slice(&(height as i32).to_le_bytes()); // biHeight (>0 = bottom-up)
    out.extend_from_slice(&1u16.to_le_bytes()); // biPlanes
    out.extend_from_slice(&32u16.to_le_bytes()); // biBitCount
    out.extend_from_slice(&0u32.to_le_bytes()); // biCompression = BI_RGB
    out.extend_from_slice(&image_size.to_le_bytes()); // biSizeImage
    out.extend_from_slice(&0i32.to_le_bytes()); // biXPelsPerMeter
    out.extend_from_slice(&0i32.to_le_bytes()); // biYPelsPerMeter
    out.extend_from_slice(&0u32.to_le_bytes()); // biClrUsed
    out.extend_from_slice(&0u32.to_le_bytes()); // biClrImportant

    let row_bytes = (width as usize) * 4;
    for y in (0..height as usize).rev() {
        let row = &rgba[y * row_bytes..(y + 1) * row_bytes];
        for px in row.chunks_exact(4) {
            out.extend_from_slice(&[px[2], px[1], px[0], px[3]]);
        }
    }
    Ok(out)
}

#[cfg(target_os = "windows")]
fn write_dib_to_clipboard(dib: &[u8]) -> Result<(), String> {
    use std::ptr;
    use windows::Win32::Foundation::{GlobalFree, HANDLE, HWND};
    use windows::Win32::System::DataExchange::{
        CloseClipboard, EmptyClipboard, OpenClipboard, SetClipboardData,
    };
    use windows::Win32::System::Memory::{GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE};

    // CF_DIB = 8
    const CF_DIB: u32 = 8;

    unsafe {
        let mut opened = false;
        for _ in 0..8 {
            if OpenClipboard(Some(HWND::default())).is_ok() {
                opened = true;
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(15));
        }
        if !opened {
            return Err("剪贴板正被其他程序占用，请重试".to_string());
        }

        let result = (|| -> Result<(), String> {
            EmptyClipboard().map_err(|e| format!("清空剪贴板失败: {e}"))?;
            let hmem = GlobalAlloc(GMEM_MOVEABLE, dib.len())
                .map_err(|e| format!("分配剪贴板内存失败: {e}"))?;
            let ptr_dst = GlobalLock(hmem) as *mut u8;
            if ptr_dst.is_null() {
                let _ = GlobalFree(Some(hmem));
                return Err("锁定剪贴板内存失败".to_string());
            }
            ptr::copy_nonoverlapping(dib.as_ptr(), ptr_dst, dib.len());
            let _ = GlobalUnlock(hmem);

            if SetClipboardData(CF_DIB, Some(HANDLE(hmem.0))).is_err() {
                let _ = GlobalFree(Some(hmem));
                return Err("写入剪贴板失败".to_string());
            }
            Ok(())
        })();

        let _ = CloseClipboard();
        result
    }
}

#[cfg(not(target_os = "windows"))]
fn write_dib_to_clipboard(_dib: &[u8]) -> Result<(), String> {
    Err("当前平台不支持原生剪贴板写入".to_string())
}

/// Strip characters illegal in Windows file names and keep the stem non-empty.
fn sanitize_stem(raw: &str) -> String {
    let cleaned: String = raw
        .chars()
        .map(|c| match c {
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => '_',
            c if c.is_control() => '_',
            c => c,
        })
        .collect();
    let trimmed = cleaned.trim().trim_matches('.');
    if trimmed.is_empty() {
        "screenshot".to_string()
    } else {
        trimmed.chars().take(120).collect()
    }
}

/// Pick a non-colliding `.png` path inside `dir`.
fn unique_png_path(dir: &Path, file_name: &str) -> PathBuf {
    let stem = file_name
        .strip_suffix(".png")
        .or_else(|| file_name.strip_suffix(".PNG"))
        .unwrap_or(file_name);
    let safe = sanitize_stem(stem);
    let first = dir.join(format!("{safe}.png"));
    if !first.exists() {
        return first;
    }
    for n in 1..1000u32 {
        let candidate = dir.join(format!("{safe}_{n}.png"));
        if !candidate.exists() {
            return candidate;
        }
    }
    dir.join(format!("{safe}_{}.png", uuid::Uuid::new_v4()))
}

fn default_screenshot_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let base = app
        .path()
        .picture_dir()
        .or_else(|_| app.path().desktop_dir())
        .map_err(|e| format!("无法定位图片目录: {e}"))?;
    Ok(base.join("DanmakuPlayer"))
}

fn save_png_to_dir(dir: &Path, file_name: &str, data: &[u8]) -> Result<PathBuf, String> {
    fs::create_dir_all(dir).map_err(|e| format!("无法创建截图目录: {e}"))?;
    let target = unique_png_path(dir, file_name);
    let tmp = target.with_extension("png.tmp");
    fs::write(&tmp, data).map_err(|e| format!("写入截图失败: {e}"))?;
    fs::rename(&tmp, &target).map_err(|e| format!("保存截图失败: {e}"))?;
    Ok(target)
}

fn raw_body(request: tauri::ipc::Request<'_>) -> Result<Vec<u8>, String> {
    match request.body() {
        tauri::ipc::InvokeBody::Raw(bytes) => Ok(bytes.clone()),
        tauri::ipc::InvokeBody::Json(_) => Err("截图数据格式错误".to_string()),
    }
}

fn header_decoded(request: &tauri::ipc::Request<'_>, name: &str) -> Option<String> {
    let raw = request.headers().get(name)?.to_str().ok()?;
    let decoded = urlencoding::decode(raw).ok()?;
    let trimmed = decoded.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

#[tauri::command]
pub async fn screenshot_copy_clipboard(request: tauri::ipc::Request<'_>) -> Result<(), String> {
    let width: u32 = request
        .headers()
        .get("x-width")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.parse().ok())
        .ok_or_else(|| "缺少截图宽度".to_string())?;
    let height: u32 = request
        .headers()
        .get("x-height")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.parse().ok())
        .ok_or_else(|| "缺少截图高度".to_string())?;
    let rgba = raw_body(request)?;
    tauri::async_runtime::spawn_blocking(move || {
        let dib = rgba_to_dib(width, height, &rgba)?;
        write_dib_to_clipboard(&dib)
    })
    .await
    .map_err(|e| format!("剪贴板任务失败: {e}"))?
}

#[tauri::command]
pub async fn screenshot_save(
    app: tauri::AppHandle,
    request: tauri::ipc::Request<'_>,
) -> Result<String, String> {
    let file_name = header_decoded(&request, "x-file-name")
        .unwrap_or_else(|| "screenshot.png".to_string());
    let custom_dir = header_decoded(&request, "x-dir");
    let data = raw_body(request)?;
    let target_dir = match custom_dir {
        Some(custom) => PathBuf::from(custom),
        None => default_screenshot_dir(&app)?,
    };
    let saved =
        tauri::async_runtime::spawn_blocking(move || save_png_to_dir(&target_dir, &file_name, &data))
            .await
            .map_err(|e| format!("截图保存任务失败: {e}"))??;
    Ok(saved.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rgba_to_dib_flips_rows_and_swaps_rb() {
        // 2x2 image: top row [R, G], bottom row [B, W]
        let rgba = vec![
            255, 0, 0, 255, 0, 255, 0, 255, // y=0 (top)
            0, 0, 255, 255, 255, 255, 255, 255, // y=1 (bottom)
        ];
        let dib = rgba_to_dib(2, 2, &rgba).unwrap();
        assert_eq!(dib.len(), 40 + 16);
        assert_eq!(u32::from_le_bytes(dib[0..4].try_into().unwrap()), 40);
        assert_eq!(i32::from_le_bytes(dib[4..8].try_into().unwrap()), 2);
        assert_eq!(i32::from_le_bytes(dib[8..12].try_into().unwrap()), 2);
        // Bottom row comes first in DIB, in BGRA order
        assert_eq!(&dib[40..48], &[255, 0, 0, 255, 255, 255, 255, 255]);
        // Top row comes second in DIB, in BGRA order
        assert_eq!(&dib[48..56], &[0, 0, 255, 255, 0, 255, 0, 255]);
    }

    #[test]
    fn unique_png_path_sanitizes_and_disambiguates() {
        let dir = std::env::temp_dir().join(format!("danmaku-shot-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        let p1 = save_png_to_dir(&dir, "番剧:01*?.png", b"a").unwrap();
        let p2 = save_png_to_dir(&dir, "番剧:01*?.png", b"b").unwrap();
        assert!(p1.file_name().unwrap().to_str().unwrap() == "番剧_01__.png");
        assert!(p2.file_name().unwrap().to_str().unwrap() == "番剧_01___1.png");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn rgba_to_dib_writes_bottom_up_bgra_rows() {
        // 2x2 RGBA: top row [Red, Green], bottom row [Blue, White]
        let rgba = [
            255, 0, 0, 255, 0, 255, 0, 255, // y=0
            0, 0, 255, 128, 255, 255, 255, 255, // y=1
        ];
        let dib = rgba_to_dib(2, 2, &rgba).expect("valid 2x2 dib");
        assert_eq!(dib.len(), 40 + 16);
        // Bottom row (y=1) comes first in BGRA order: Blue=[255,0,0,128], White=[255,255,255,255]
        assert_eq!(&dib[40..48], &[255, 0, 0, 128, 255, 255, 255, 255]);
        // Top row (y=0) comes second in BGRA order: Red=[0,0,255,255], Green=[0,255,0,255]
        assert_eq!(&dib[48..56], &[0, 0, 255, 255, 0, 255, 0, 255]);
    }
}

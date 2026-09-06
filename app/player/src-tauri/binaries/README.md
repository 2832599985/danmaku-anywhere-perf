# ffmpeg sidecar（发布打包用）

发布版通过 ffmpeg 抽取音轨供本地语音识别使用。Rust 侧按以下顺序解析
ffmpeg（`src-tauri/src/subtitle/audio.rs` 的 `resolve_ffmpeg`）：

1. **主程序同目录**下的 `ffmpeg.exe` —— 即 Tauri `externalBin` sidecar
   的安装位置；
2. 系统 **PATH** 中的 `ffmpeg`（开发机直接可用，无需下载）。

## 发布打包时启用 sidecar

1. 下载静态版 ffmpeg（如 gyan.dev 的 release-essentials），取出
   `ffmpeg.exe` 放到本目录并按 Tauri 规范加上 target triple 后缀：

   ```
   src-tauri/binaries/ffmpeg-x86_64-pc-windows-msvc.exe
   ```

2. 在 `tauri.conf.json` 的 `bundle` 中启用：

   ```json
   "bundle": {
     "externalBin": ["binaries/ffmpeg"]
   }
   ```

3. 确认 `.gitignore` 忽略了 `src-tauri/binaries/*.exe`（二进制不入库）。

只发 Windows 时只需上述一个文件；交叉发布其他平台需提供对应 triple 的
二进制（`ffmpeg-aarch64-pc-windows-msvc.exe`、`ffmpeg-x86_64-unknown-linux-gnu` 等）。

> 本目录刻意不提交任何 exe：保持仓库轻量，同时让 `tauri dev` 在没有
> sidecar 的机器上仍可通过 PATH 的 ffmpeg 工作。

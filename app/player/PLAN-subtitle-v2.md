# PLAN：AI 实时双语字幕 v2（Whisper + Murasaki，借显卡自动暂停）

> 2026-11-11 写。压缩上下文后从这里接着做。先通读本文件，再读 `CONTRACT.md §20 / §26`，
> 以及分支 `feat/ja-zh-subtitles` 上的 `src-tauri/src/subtitle/translator.rs`、`models.rs`
> （用 `git show feat/ja-zh-subtitles:<path>` 读，**不要 merge 那个分支**）。

## 0. 已拍板的决定（不要再讨论）

| 项 | 决定 | 依据 |
|---|---|---|
| 识别 | **Whisper large-v3-turbo q5_0**（whisper.cpp，`ggml-large-v3-turbo-q5_0.bin` 547MB）替换 SenseVoice | A/B：SenseVoice 错字多（侵仰/投尿/三時官，吃句首）；turbo 几乎全对；q5 与 f16 只差标点 |
| 翻译 | **Murasaki-4B-v0.3 IQ4_XS**（`Murasaki-4B-v0.3.IQ4_XS.gguf` 2.4GB，llama-server） | A/B：人名军衔与官方字幕一致；TranslateGemma 人名/军衔/语义都错 |
| Hy-MT | **彻底不用**（用户原话「过时的玩意」）。分支上的 Hy-MT 规格、1.25/2bit 实验全部不搬 | |
| 术语表 | **去掉**：提示词不带术语，设置页术语编辑器删除 | Murasaki 无术语表也译对专名；剩余错误来自识别，术语修不了 |
| 显卡 | 用显卡，但**顺序借用、用完即还**；播放中走 CPU | 见 §1 显存数据 |
| 交互 | **自动暂停 → 借显卡生成 → 自动恢复**，用户不用手动暂停（用户原话：「点击这个功能自动去暂停，识别完了自己又恢复，这样很丝滑」） | |
| 存储 | 模型/运行时/缓存**一律不放 C 盘**（用户 C 盘没空间） | |
| 代码来源 | Transub-Player（`D:\tmp\transub-src\repo`）**无 LICENSE → 只借思路，不抄代码** | |

## 1. 实测数据（2026-11-11，RTX 4060 8GB，12 核；测试段 `_stt-spike/ja-test.mp4` 120–420s）

- 识别 300s 音频：turbo q5 **GPU 5.5s / CPU(8 线程) 70s**；f16 GPU 10s；SenseVoice CPU 4.1s。
- 翻译 68 句、8 句一批、CPU 4 线程：Murasaki **7.8s/批、首批 9.4s、17 tok/s**。GPU 未测（估计快 ~4×）。
- 识别+翻译**同时**跑 CPU：各自慢 ~40%（300s 段 ~100s），仍 **3× 实时**。
- 显存：**最高档超分播放中 5.0GB/8.2GB 已用、GPU 98%** → 余 ~3.1GB（含 Edge/微信等其他程序，会浮动）。
  需求：whisper q5 ≈ 0.8GB（模型 573MB+缓冲 ~210MB），Murasaki ≈ 2.7GB（权重 2.4G + KV ctx1024 0.15G + 计算 ~0.15G；qwen3：36 层、8 KV 头、dim128 → 144KB/token）。
  **两个同时常驻 3.5GB 放不下；单个都放得下**（Murasaki 余量仅 ~0.4GB）。
- 视频暂停时 rVFC 不触发 → Anime4K 计算自动停；补帧的 rAF 展示循环仍空转（开销小）。**显存不释放**。

**第 1 步 whisper-server / GPU 翻译实测（2026-11-11，空闲桌面，基线显存 2.5GB）**：
- server（`-mc 0`，300s 段，120s 片）：**GPU+VAD 3.7s、CPU+VAD 63s（4.7× 实时）**。
  30s 片在 CPU 上反而慢（176s）：每个 30s 窗口都要完整编码一次（CPU ~5.4s/次，不论音频多短），
  且片尾残段会多编码一次 → **片长用 120s**。
- **DTW 不要**：必须关 flash-attn（`dtw ... not supported with flash_attn - disabling`），GPU 5.8→12.7s、CPU 176→307s；
  对官方时间轴的起点误差中位数 0.56s vs 不用 DTW 0.50s——没收益。
- **VAD 要**（`--vad -vm ggml-silero-v5.1.2.bin`，885KB，sha256 `29940d98…a2cf`）：片头噪音幻觉（もう急ぎてく）消失、句子切得更细、
  起点误差中位 0.44–0.48s、70/70 官方句全覆盖。
- 片间去重：**丢掉结束时间落在片尾 0.5s 内的 cue，下一片从最后保留 cue 的 end 开始**（无固定重叠）——边界重复句消失。
  （旧方案"2s 重叠 + 起点 floor"会留下被截断的半句。）
- 显存：whisper GPU 进程 ≈ **0.9–1.1GB**；杀进程后回落到基线（实测 3467→2569MB）✅。`/health` 返回 200。
- Murasaki **Vulkan `-ngl 99 -c 1024 -np 1`**：加载 4.5s、首批 6.2s（含预热）、**2.6s/批、76 tok/s**、68/68 对齐、显存峰值 **+2.46GB**。
  译文质量与 CPU 版相当（逐句不同但意思一致）；GPU 版有时给整句加中文引号 “…” → 清洗要剥外层引号。
- 估算 burst（300s 内容）：识别 ~4s + 起 llama 4.5s + 翻 9 批 ~23s ≈ **32s**；首条中文 ≈ 识别首片 1.4s + 4.5s + 6.2s ≈ **12s**。
  → burst 不必翻完 300s：**翻到中文前沿 ≥ 播放头 + 60s 就自动恢复**，剩下交给 CPU follow（CPU 翻译 ~4× 实时够用）。
- 响应样例：`_stt-spike/ab/server-sample.json`（VAD、30s 片；segments[].{start,end,text,words[],no_speech_prob}；`-dtw` 未开时 `t_dtw=-1`）。
  脚本：`_stt-spike/ab-server.py`（切片+去重逻辑原型）、`ab-timing.py`（对官方时间轴打分）。

A/B 原始材料：`_stt-spike/ab/`（`ref.tsv` 官方中文 70 条、`align.txt` 识别对照、`mt-*.tsv`），
脚本 `_stt-spike/ab-whisper.sh`、`ab-mt.py`、`ab-align.py`。

## 2. 开发时可直接复用的本地文件（别重复下载）

- 模型：`D:\_Code\Html Css Javascript\danmaku-anywhere\_stt-spike\models\ab\`
  `ggml-large-v3-turbo-q5_0.bin`、`Murasaki-4B-v0.3.IQ4_XS.gguf`（另有 turbo f16 / kotoba / translategemma，不用）
- whisper.cpp b5454：`_stt-spike\bin\whisper\cpu\Release\`（23MB，含 `whisper-server.exe`）、
  `_stt-spike\bin\whisper\cuda12\Release\`（1.2GB，自带 cublas/cudart，**CUDA 11.8 包缺 cublas 不能用**）
- llama.cpp：`_stt-spike\bin\cpu\`、`_stt-spike\bin\vulkan\`（build 10909，均有 `llama-server.exe`）
- 下载地址：
  - `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q5_0.bin`
  - `https://huggingface.co/mradermacher/Murasaki-4B-v0.3-GGUF/resolve/main/Murasaki-4B-v0.3.IQ4_XS.gguf`（CC-BY-NC-SA-4.0，个人用）
  - `https://github.com/ggml-org/whisper.cpp/releases/download/b5454/whisper-bin-x64.zip`（CPU，8.9MB）
  - `.../b5454/whisper-bin-win-cuda-12.4.0-x64.zip`（GPU，653MB，仅 NVIDIA，可选下载）
  - llama.cpp：沿用分支 `models.rs` 里的 Zip 源（CPU + 需要新增 Vulkan 版）
  - 国内走 `hf-mirror.com`（与现有 SENSEVOICE 规格同法）

## 3. 架构

### 3.1 两个外挂进程（Rust 管理生命周期）
- `whisper-server.exe`：启动参数 `-m <q5> -l ja -mc 0 -t 8 --vad -vm <silero> --host 127.0.0.1 --port <空闲端口>`（**不加 -dtw**，第 1 步已否决），
  GPU 模式用 cuda12 目录，CPU 模式用 cpu 目录（或同一 cuda 版加 `-ng`）。
  请求：`POST /inference` multipart `file=<wav>`、`response_format=verbose_json`。
  - `-mc 0` = 不承接上文，防"同一句每 2 秒刷屏"（Transub 同款教训）。
  - **先验证** `-dtw large.v3.turbo` 能否在 server + q5 下给出逐字时间戳 → 能则喂给现有 `asr.rs` 的 token 断句（句末号断、逗号半长断、30 字硬断）；不能则用段时间戳 + `split_long_cue` 回退。
- `llama-server.exe`：`-m <Murasaki> -c 1024 -np 1 --no-jinja --chat-template chatml -a mt`；
  GPU 模式 Vulkan 版 `-ngl 99`，CPU 模式 CPU 版 `-ngl 0 -t 4`。
- **释放显存的方式 = 杀进程**（比库内 free 可靠，WebView2 不受影响）。同一时刻只允许一个 GPU 进程。
- 生命周期管理参考分支 `translator.rs`（端口探测、`/health` 轮询、CREATE_NO_WINDOW、超时）——读懂后重写为通用 `sidecar.rs`，两个引擎共用。主窗口 Destroyed 时（`lib.rs` 已有 exit(0)）确保子进程被杀（Job Object 或 Drop 里 kill）。

### 3.2 识别切片
- 复用 `audio.rs` 的 ffmpeg 提取（16k 单声道）。**120s 片**（GPU 首片可用 60s 让首条更早出），丢弃 end 落在片尾 0.5s 内的 cue，
  下一片从最后保留 cue 的 end 开始；无保留 cue 时整片保留并前进 `片长-2s`（保证推进）。最后一片全保留。
  段时间戳 + `split_long_cue` 断长句（不用 token 断句；asr.rs 的 token 断句随 SenseVoice 一起删）。
- 幻觉清洗（自己写）：连续同文 cue 只留第一条；单字长串（あああ…/プププ…）、空格重复词（今 今 今…）删除或折叠；纯标点/省略号丢弃；这些句子不送翻译。

### 3.3 翻译
- 系统提示词（中文，ACGN 日译中，禁止思维链，输出 `序号|译文`，不合并行、不编人名、简体）。温度 0.3、top_p 0.6、`cache_prompt`。
- 每批 8 句，编号 `1|…`；解析容错（`|｜．.、:：-)`）；剥 `<think>…</think>` 和未闭合 `<think>`；对不上行号的批次**不猜对齐**，该批显示原文（沿用分支 `parse_reply` 的纪律）。
- 结果清洗：译文仍含大量假名 → 判废显示原文；译文 = 原文回声 → 判废；相邻不同原文却同一译文 → 去掉后者。
- **优先翻播放头附近**：候选 = 未翻译 cue；先取 `[playhead-3s, playhead+60s]` 内按时间排序的 8 句，不足再按时间顺序补。seek 后立刻重新选批。

### 3.4 调度（generate.ts 重写为状态机）
状态：`idle` → `burst`（自动暂停、GPU）→ `follow`（播放中、CPU）→ …

1. **用户点「生成字幕」**（或开启"打开视频自动生成"时开片）：
   记住是否在播放 → `video.pause()` → 显示遮罩「正在借用显卡生成字幕… 识别 42% / 翻译 3/9」+「直接播放」按钮 →
   GPU 识别 `[playhead, playhead + BURST_SECS]`（初值 300s，实测 ~4s）→ 杀 whisper → GPU 翻译，从播放头起按时间顺序，
   **中文前沿 ≥ 播放头 + BURST_ZH_LEAD（初值 60s）即杀 llama、自动恢复**（实测总计 ~15s），剩余译文交给 follow →
   **自动恢复播放**（只有原来在播放才恢复）。
   - 首条中文可上屏后就允许"直接播放"；用户点了就提前结束 burst，剩余交给 follow。
   - burst 期间用户自己按了播放 → 立刻杀 GPU 进程、转 follow。
2. **follow（播放中）**：CPU whisper + CPU llama 顺序往后推，保持「中文前沿 − 播放头」≥ `LEAD_TARGET`（初值 120s），够了就停，低于 `LEAD_LOW`（初值 45s）再开。两个 CPU 进程可常驻（不占显存），但识别和翻译不要同时满负荷（实测同时跑各慢 40%；可接受，按需调）。
3. **拖进度条到没字幕的地方**（目标点 > 中文前沿 + 2s）：debounce 450ms（沿用 `SEEK_DEBOUNCE_MS`）→ 自动 burst 该段 → 自动恢复。
4. **显存不够时降级**：burst 前用 `nvidia-smi --query-gpu=memory.used,memory.total --format=csv,noheader`（找不到 nvidia-smi / 非 NVIDIA → 直接 CPU）。空闲 < 需求+300MB → 该引擎走 CPU（Murasaki 可试部分 offload `-ngl N`）。进程启动失败/OOM → 同样降级，不报错打断观看。
5. 所有异步步骤带 media 代号守卫（沿用 `generate.ts` 现有的 `mediaSession` 纪律）：换片立刻杀进程、丢弃旧回调。

### 3.5 显示
- 三种显示：**译文 / 原文 / 双语**（双语 = 译文在上、原文小字在下）。快捷键先查 `useKeyboardControls.ts` 现有占用（已用 F/P/M/D/U/C/S/K/Space/Esc/,/./[/]/方向键），选不冲突的键（候选 1/2/3），同步改设置页 SHORTCUTS 表。
- 某句没译文 → 该句显示原文（不留空）。翻译引擎整体失败 → 自动退回原文 + 一次性 OSD。
- 播放头超过中文前沿时，字幕区小字提示「字幕生成中 · 还差 Xs」。
- 渲染沿用 §26 的 SubtitleController/SubtitleRenderer（不走 React），只扩展 cue 结构为 `{start,end,text,zh?}`。

### 3.6 存储（不放 C 盘）
- 新设置 `subtitleSettings.dataDir`（模型 + 运行时 + 字幕缓存的根目录）。默认值：**exe 所在盘**的 `<盘>:\DanmakuPlayerData`；exe 在 C 盘时选剩余空间最大的非 C 固定盘；都没有才退回 `app_data_dir`。设置页可改、显示占用。
  `playerStore.ts` 的 persist `merge` 里 subtitleSettings 已是深合并，新增字段要确认能保留（CLAUDE.md 硬规则）。
- 旧的 `%APPDATA%\app.danmaku.player\models\` 若存在：设置页给「清理旧模型」按钮（目前该目录为空）。
- 生成结果缓存：`<dataDir>/subs/<FNV-1a(path)>.json`（原文+译文+已覆盖区间），重开同一视频直接复用、从未覆盖处续做。**不往用户片库写 srt**；设置/菜单提供「导出字幕 → 原文 / 译文 / 双语 .srt」。
- 下载：模型规格表加 whisper-q5、Murasaki、whisper-cpu 运行时、whisper-cuda12 运行时（可选，仅检测到 NVIDIA 时提示）、llama-vulkan、llama-cpu；断点续传、sha256（下载后自己算一次填进去）、hf-mirror。
- 开发期：把 dataDir 指到一个 D 盘目录，用**硬链接/复制**把 §2 的现成文件放进去，免得再下 3GB。

## 4. 实施步骤（按顺序；每步做完跑门禁）

1. **验证 whisper-server**（独立小脚本，不进仓库）：用 §2 的 cpu/cuda12 起 server，POST `_stt-spike/ab/seg.wav` 的 30s 片段，确认 verbose_json 结构、`-dtw large.v3.turbo` 是否返回 token 时间戳、`-mc 0` 生效、GPU/CPU 耗时与 §1 一致、杀进程后 `nvidia-smi` 显存回落。把响应样例存到 `_stt-spike/ab/server-sample.json`，后面写解析时对着它写。
2. **Rust：`subtitle/sidecar.rs`**（通用外挂进程：启动/健康检查/端口/杀进程/子进程随主进程退出）+ 单测。
3. **Rust：`subtitle/whisper.rs`**（wav → server → cues；重叠去重；token 时间戳接入 `asr.rs` 断句；幻觉清洗）+ 单测（用 server-sample.json 做解析测试）。
4. **Rust：`subtitle/translator.rs`**（按 3.3 重写，Murasaki 提示词，无术语表）+ 单测（解析/清洗）。
5. **Rust：`models.rs` + 存储根目录**（§3.6）+ `commands.rs` 新命令：`subtitle_burst(path, from, to, gpu: bool, channel)`、`subtitle_follow_step(...)`、`subtitle_abort()`、`subtitle_gpu_free_mb()`、`subtitle_export_srt(...)`；进度/cue/译文通过 Channel 流式回前端。删除 SenseVoice 路径（sherpa 依赖是否还被 VAD/别处用到，先 grep 再删）。
6. **前端：`generate.ts` 状态机**（§3.4）+ `native.ts` 封装 + vitest（状态转换、前沿计算、选批优先级、seek 触发、换片守卫）。
7. **前端 UI**：burst 遮罩（进度 + 直接播放）、显示模式切换 + 快捷键、前沿提示、设置页（删 Hy-MT/术语表/SenseVoice；加数据目录、显卡加速开关、模型下载状态、导出字幕）。
8. **CONTRACT.md 新增 §34**（规格 + 实测数据），CLAUDE.md 的 Desktop Player 段补一句新管线与"测试别写 target/release"。
9. **门禁**：`corepack pnpm -C app/player type-check`、player vitest、biome、`vite build`、`cargo test --target-dir D:/tmp/cargo-test-target`（**绝不能**在默认 target 跑 `cargo test --release`，会把用户的 exe 覆盖成连 localhost 的开发版）。最后 `tauri build` 一次。
10. **真 exe 端到端**（临时 `WEBVIEW2_USER_DATA_FOLDER=D:\tmp\wv2-*`，dataDir 指 D 盘测试目录）：打开 `_stt-spike/ja-test.mp4` → 点生成 → 记录：自动暂停到首条中文的耗时、burst 总耗时、burst 中显存峰值（nvidia-smi 轮询）、自动恢复是否发生、恢复后 CPU 前沿是否领先播放头、seek 到未覆盖处的自动补洞、换片中断。对照 `ab/ref.tsv` 抽查译文。**不跑全套模拟测试**（用户自己会打开检查）。

## 5. 约束 / 坑（每次动手前看一遍）

- 不替用户点 UI、不杀用户的播放器进程（父进程 explorer.exe = 用户的；bash.exe / `--user-data-dir=D:\tmp\wv2-*` = 我的）。`tauri build` 报"拒绝访问/被占用"时让用户关窗口，别硬杀。
- exe 验证必须用临时 WebView2 profile；缩略图目录 `%LOCALAPPDATA%\app.danmaku.player\thumbs` 不受临时 profile 隔离，测试写进去的要删。
- 构建：`export PATH="$HOME/.cargo/bin:$PATH"`，`SHERPA_ONNX_LIB_DIR="C:/_DEV/sherpa-onnx/sherpa-onnx-v1.13.7-win-x64-static-MT-Release-lib/lib"`（若删掉 sherpa 依赖就不需要了）。网络走 `-x http://127.0.0.1:10808`。
- 含中文的文件不要用 PowerShell 5.1 正则改；用 Edit/Write 或 Python UTF-8。Python 打印日文要 `PYTHONIOENCODING=utf-8`（控制台是 GBK）。
- 提交信息写到 `D:\tmp\commit-msg.txt`，`git commit -F`；无署名行；**只在用户明确同意后推送**。当前分支 `feat/anime4k-upscale`。
- 用户偏好：中文、短结论、别长时间无输出、要实测数据不要假设；构建/打包慢，能只编 exe 就别重打安装包。

## 6. 未验证 / 风险

- ~~DTW~~（已否决）、~~Murasaki Vulkan 速度~~（2.6s/批、+2.46GB，已测）。用户开最高档超分时 burst 显存峰值仍待第 10 步实测。
- 显存余量 ~0.4GB 偏紧，其他程序占用会浮动 → 必须有 §3.4-4 的降级。
- CUDA 运行时包 1.2GB（解压后）只适用 NVIDIA；AMD/Intel 显卡只能 CPU（仍 3× 实时）。Vulkan 版 whisper.cpp 无官方 Windows 预编译，本机也无 cmake/Vulkan SDK/VS，暂不做。
- 自动暂停对"开着弹幕 + 补帧"的恢复是否有可感知的跳帧（第 10 步观察）。

# CONTRACT — Danmaku Player (local Tauri desktop player)

> Plan-first artifact. Defines architecture, module boundaries, reused packages,
> the native command surface, data shapes and acceptance mapping **before**
> implementation. Everything below is the source of truth for the parallel
> implementation agents. Do not deviate without updating this file.

## 1. Goal & acceptance (from `播放器要求.txt`)

A local Windows video player that reproduces the extension's core capabilities and
plays local files without depending on the network for the video itself.

| # | Acceptance criterion | Where it's satisfied |
|---|----------------------|----------------------|
| 1a | Open video files (mainstream MP4 etc.) | Native file dialog + custom streaming protocol; browser fallback = file input / drag-drop |
| 1b | Danmaku mounting (logic ≈ extension) | `@danmaku-anywhere/danmaku-engine` `DanmakuRenderer` over the `<video>` |
| 1c | Super-resolution | `@danmaku-anywhere/upscale-engine` `Renderer` (Anime4K) |
| 1d | Frame interpolation (customizable) | Same `Renderer`, Framegen N× (`480p`/`720p`/`1080p`, factor or target fps) |
| 2a | Volume adjustment | Volume slider + `video.volume` |
| 2b | Left/right = seek | Global keydown (`±5s`, configurable) |
| 2c | Up/down = volume | Global keydown (`±5%`) |
| — | "Mature product" polish | Play/pause, progress bar w/ buffered + hover preview time, time display, fullscreen, mute, playback-rate, danmaku on/off + opacity/speed, settings drawer, recent files, empty state |

## 2. Feasibility verdict — GO (Tauri is a good fit)

- **Toolchain present on this machine:** Rust `cargo 1.97.1` (`~/.cargo/bin`, `stable-x86_64-pc-windows-msvc`), Visual Studio 2022 (MSVC linker), WebView2 runtime `150.x` (Chromium/Edge → **WebGPU-capable**), Node 24 + pnpm 10. Tauri v2 builds and links here. Only `@tauri-apps/cli` needs adding (npm).
- **Maximum reuse, minimum new code:** the two hard parts (Anime4K super-resolution AND Framegen frame interpolation) already live in the framework-independent `@danmaku-anywhere/upscale-engine` `Renderer`, which takes only a `<video>` + `<canvas>`. Danmaku rendering is the framework-independent `DanmakuRenderer`. Both run unchanged in a WebView2/Chromium webview. We add a thin React shell + a ~100-line Rust file-streaming layer.
- **Why not Electron:** user asked about Tauri; Tauri gives a ~3–10 MB installer vs Electron's ~150 MB and reuses the OS WebView2 (already WebGPU-capable here). No downside for our needs.
- **Why WebView2 works for WebGPU:** WebView2 150 == Edge 150 (WebGPU shipped in 113). `shader-f16` (needed by Framegen) depends on the GPU, and the engine already falls back to Anime4K-only when it's missing.

## 3. High-level architecture

```
┌──────────────────────────────────────────────────────────────┐
│ Tauri shell (Rust, src-tauri/)                                │
│  • window + menu                                              │
│  • plugin-dialog (open file), plugin-fs (read danmaku text)   │
│  • plugin-http (DanDanPlay fetch, no CORS)                    │
│  • custom `stream://` URI protocol: range-capable, CORS-clean │
│    local video streaming so WebGPU copyExternalImageToTexture │
│    stays untainted                                            │
└───────────────────────────────┬──────────────────────────────┘
                                │ webview (WebView2 / Chromium)
                                ▼
┌──────────────────────────────────────────────────────────────┐
│ Frontend (Vite + React 19 + TS + MUI, app/player/src)         │
│  PlayerHost                                                   │
│   ├─ <video> (audio + GPU texture source; hidden when upscaling)│
│   ├─ <canvas> upscale overlay  ← upscale-engine Renderer       │
│   ├─ danmaku overlay div       ← danmaku-engine DanmakuRenderer │
│   └─ Controls (play/seek/volume/fullscreen/danmaku/settings)   │
│  State: Zustand store + platform adapter (tauri | browser)     │
└──────────────────────────────────────────────────────────────┘
```

### Platform adapter (single most important abstraction)
All environment-specific calls go through `src/platform/` so the exact same React
tree runs in **(a)** the Tauri webview and **(b)** a plain browser (Vite dev) for
Playwright verification.

```ts
interface Platform {
  isTauri: boolean
  pickVideoFile(): Promise<PickedMedia | null>   // dialog → {url, name, path?}
  pickDanmakuFile(): Promise<PickedText | null>   // dialog → {text, name}
  toMediaUrl(path: string): string                // convertFileSrc / stream://
  httpText(url, init): Promise<string>            // plugin-http | window.fetch
}
```
- **Tauri impl:** `@tauri-apps/plugin-dialog`, `@tauri-apps/plugin-fs`, `@tauri-apps/plugin-http`, custom `stream://` protocol for `toMediaUrl`.
- **Browser impl:** `<input type=file>` + `URL.createObjectURL` (blob URLs are CORS-clean → WebGPU works), `window.fetch`. `path` unavailable → `toMediaUrl` returns the blob URL as-is.

## 4. Directory layout (new — `app/player/`, exclusive to this feature)

```
app/player/
├── CONTRACT.md                      ← this file
├── package.json                     ← @danmaku-anywhere/player (private)
├── vite.config.ts                   ← react + alias @ → src, port 3060, WebGPU-friendly target
├── tsconfig.json / tsconfig.node.json
├── index.html
├── biome.json (extends root) — or rely on root
├── public/
│   ├── assets/framegen/             ← COPY of rt_v7s.bin/.json + LICENSE + WEIGHTS_LICENSE.md
│   └── danmaku.css                  ← .da-danmaku* styles (shipped for the engine)
├── src/
│   ├── main.tsx                     ← React root, theme, store bootstrap
│   ├── App.tsx                      ← layout: PlayerHost + Controls + drawers
│   ├── platform/                    ← Platform adapter (tauri.ts, browser.ts, index.ts, types.ts)
│   ├── store/                       ← Zustand store (playerStore.ts, settingsStore.ts) + persistence
│   ├── player/
│   │   ├── PlayerHost.tsx           ← <video>+<canvas>+danmaku overlay wiring, refs
│   │   ├── useVideoElement.ts       ← play/pause/seek/volume/rate/fullscreen imperatives + events
│   │   ├── useKeyboardControls.ts   ← ←/→ seek, ↑/↓ volume, space, f, m, d
│   │   ├── upscale/UpscaleController.ts  ← wraps upscale-engine Renderer + overlay canvas geometry
│   │   └── danmaku/DanmakuController.ts  ← wraps DanmakuRenderer + overlay container
│   ├── danmaku/
│   │   ├── parse.ts                 ← local file → CommentEntity[] (xml/json/ass) via danmaku-converter
│   │   └── ddp.ts                   ← online search/episodes/comments via danmaku-provider
│   ├── ui/
│   │   ├── Controls.tsx             ← bottom control bar
│   │   ├── ProgressBar.tsx, VolumeControl.tsx, TimeDisplay.tsx
│   │   ├── SettingsDrawer.tsx       ← upscale + interpolation + danmaku settings
│   │   ├── UpscaleSettings.tsx      ← (modeled on extension UpscaleControls.tsx)
│   │   ├── DanmakuSettings.tsx
│   │   ├── DanmakuSourceDialog.tsx  ← local import + DDP search
│   │   └── EmptyState.tsx           ← drag-drop / open prompt
│   └── theme/theme.ts               ← manga ink theme (vermilion/paper, zero radius, halftone)
└── src-tauri/
    ├── Cargo.toml
    ├── tauri.conf.json              ← window, security CSP, protocol allowlist, bundle
    ├── build.rs
    ├── capabilities/default.json    ← dialog/fs/http permissions
    ├── icons/                       ← generated
    └── src/
        ├── main.rs
        ├── lib.rs                   ← builder, plugins, register stream protocol
        └── stream.rs               ← range-capable, CORS-clean file streamer
```

## 5. Reused workspace packages (deps of `@danmaku-anywhere/player`)

| Package | Use |
|---------|-----|
| `@danmaku-anywhere/upscale-engine` (`workspace:*`) | `Renderer`, `resolveEffectChain`, `waitForVideoReady`, types |
| `@danmaku-anywhere/danmaku-engine` (`workspace:*`) | `DanmakuRenderer` |
| `@danmaku-anywhere/danmaku-converter` (`workspace:*`) | `CommentEntity`, `p`/gradient parsers, XML/format converters |
| `@danmaku-anywhere/danmaku-provider` (`workspace:*`) | DanDanPlay search/episode/comment fetch (online, optional) |
| `@danmaku-anywhere/result` (`workspace:*`) | `Result<T,E>` unwrapping for provider calls |
| npm: `anime4k-webgpu`, `framegen` | transitive via upscale-engine |
| npm: `@mr-quin/danmu` | transitive via danmaku-engine |

These packages are consumed as **TypeScript source** (workspace, `main: src/index.js`
but Vite resolves `src`). vite/tsconfig must include them for transpilation
(mirror how the extension consumes them; add to `optimizeDeps`/`server.fs.allow` as
needed and DO NOT rely on prebuilt `dist`).

## 6. Native command / protocol surface (Rust)

- **`stream://` async URI scheme** (`src-tauri/src/stream.rs`): given `stream://localhost/<url-encoded-abs-path>`, serves the file with:
  - `Accept-Ranges: bytes`, honors `Range:` (206 partial) → enables video seeking of large files without loading into memory,
  - `Content-Type` by extension (mp4→`video/mp4`, mkv→`video/x-matroska`, webm, etc.),
  - `Access-Control-Allow-Origin: *` so `video.crossOrigin="anonymous"` yields CORS-clean frames for WebGPU.
- **Plugins:** `tauri-plugin-dialog`, `tauri-plugin-fs`, `tauri-plugin-http`. No custom Rust `#[command]` strictly required beyond the protocol (keep Rust minimal).
- **CSP** (`tauri.conf.json`): allow `media-src stream: blob:`, `connect-src` for DanDanPlay + proxy, `img-src`, `worker-src blob:` (danmu preparse worker), `script-src 'self'`.

## 7. Settings / data shapes (frontend, persisted to localStorage; Tauri store optional)

```ts
// mirrors extension upscale schema 1:1 so engine glue is identical
type UpscaleSettings = {
  enabled: boolean
  modeId: 'builtin-mode-a'|'-b'|'-c'|'-aa'|'-bb'|'-ca'
  performanceTier: 'performance'|'balanced'|'quality'|'ultra'
  targetResolution: 'x2'|'x4'|'x8'|'720p'|'1080p'|'2k'|'4k'|'native'
  frameInterpolation: {
    enabled: boolean
    resolution: '480p'|'720p'|'1080p'   // model processing resolution (§17)
    mode: 'multiplier'|'targetFps'
    multiplier: 2|3|4
    targetFps: 60|120|144|170
  }
}
// defaults: enabled:false, modeId:'builtin-mode-a', tier:'balanced',
//           targetResolution:'x2', frameInterpolation:{enabled:false,resolution:'720p'}

type DanmakuSettings = Partial<DanmakuOptions> & {
  visible: boolean            // maps to show/hide()
  // opacity, fontSize, speed, area.yEnd, offset, maxOnScreen, overlap …
}
// defaults tuned like extension: opacity 0.7, area.yEnd 80, speed 1, offset 0

type PlayerSettings = {
  seekStepSec: number         // default 5  (←/→)   — "自定义" seek step
  volumeStep: number          // default 0.05 (↑/↓)
}
```

### targetDimensions math (reproduce from `Upscale.service.ts`)
```
src = { w: max(1, video.videoWidth), h: max(1, video.videoHeight) }
switch targetResolution:
  x2→src*2  x4→src*4  x8→src*8
  720p→1280×720  1080p→1920×1080  2k→2560×1440  4k→3840×2160  native→src
then clampToDisplayBounds(dims):
  dpr=devicePixelRatio||1; maxW=round(screen.width*dpr); maxH=round(screen.height*dpr)
  if !maxW||!maxH return dims; scale=min(maxW/w,maxH/h); if scale>=1 return dims
  else round(w*scale)×round(h*scale)
effects = resolveEffectChain(modeIdToBaseMode[modeId], performanceTier)
frameInterpolation = { enabled, resolution,
  weightsBinUrl:'/assets/framegen/rt_v7s.bin',
  weightsManifestUrl:'/assets/framegen/rt_v7s.json' }
canvas.width/height = clamped targetDimensions
Renderer.create({ video, canvas, effects, targetDimensions, frameInterpolation,
  presentationMode:'raf', onFirstFrameRendered:()=>{ canvas.visible=true; video.style.opacity='0' },
  onFrameInterpolationFallback, onError })
// settings change (same video): renderer.updateConfiguration({effects,targetDimensions,frameInterpolation})
// teardown: renderer.destroy(); restore video opacity
```

## 8. Danmaku data flow (1b)

```
Source A (offline, primary): local file → src/danmaku/parse.ts → CommentEntity[]
   • .xml (bilibili):  await zGenericXml.parseAsync(text)            → CommentEntity[]
   • .json:            z.array(zCommentEntity).parse(JSON.parse(t))  (or {comments:[…]} / DDP dump)
   (danmaku-converter re-exports zGenericXml, zCommentEntity, parsers; uses xml-js internally)
Source B (online, optional): DanDanPlay via src/danmaku/ddp.ts (danmaku-provider/ddp)
   • configureApiStore({ daId: <persisted uuid>, daVersion })  // default proxy API_ROOT = https://api.danmaku.weeblify.app
   • searchSearchAnime(keyword)  → Result<SearchAnimeDetails[]>  (each has episodes[])
   • commentGetComment(episodeId) → Result<CommentData[]>  (CommentData ≅ CommentEntity {p,m,cid})
   • Tauri: window.fetch is swapped to @tauri-apps/plugin-http fetch at boot → provider bypasses CORS unmodified
→ DanmakuController.mount(comments):
     container = <div style="position:absolute; inset:0; pointer-events:none">
     new DanmakuRenderer((node,props)=>renderInner(node,props))  // append .da-danmaku inner div
     renderer.create(container, videoEl, comments, danmakuConfig)
→ sync is AUTOMATIC via <video> events (bindVideo). seek = set video.currentTime.
→ settings change: renderer.updateConfig(partial); resize: renderer.resize()
```
Ship `public/danmaku.css` (the `.da-danmaku*` rules) and load it globally.

## 9. Keyboard / controls spec (2a/2b/2c + polish)

| Key | Action |
|-----|--------|
| `←` / `→` | seek −/+ `seekStepSec` (default 5s) |
| `↑` / `↓` | volume +/− `volumeStep` (default 5%), unmutes |
| `Space` / `k` | play / pause |
| `f` | toggle fullscreen |
| `m` | mute toggle |
| `d` | danmaku on/off |
| `,` `.` | when helpful: frame step (optional) |

Ignore when focus is in an input/textarea. Show a transient OSD on volume/seek.
Bottom control bar auto-hides after 2.5s of mouse inactivity during playback.

## 10. Module ownership for parallel implementation (strict file scope)

| Agent | Exclusive scope | Depends on (mock until ready) |
|-------|-----------------|-------------------------------|
| Leader (me) | `package.json`, `vite.config.ts`, `tsconfig*`, `index.html`, `src/main.tsx`, `src/App.tsx`, `public/**`, workspace wiring, `src-tauri/**` | — |
| A: platform+store | `src/platform/**`, `src/store/**` | Platform/types (define first) |
| B: player core | `src/player/**` (video, keyboard, upscale, danmaku controllers) | store types, platform types |
| C: danmaku data | `src/danmaku/**` | CommentEntity type only |
| D: UI | `src/ui/**`, `src/theme/**` | store selectors, platform |

Interfaces (`platform/types.ts`, store shape, controller class signatures) are frozen
in this CONTRACT so B/C/D mock against them.

## 11. Verification plan

1. **Type-check + lint** the new package (`tsgo`/`tsc --noEmit`, biome).
2. **Playwright (headed `channel:'chromium'`)** e2e against Vite dev (proven WebGPU path, mirrors `e2e/upscale.spec.ts`):
   - loads app, opens a generated `captureStream` video (no external asset needed),
   - danmaku: inject sample `CommentEntity[]`, assert `.da-danmaku` nodes appear & move; seek clears/repopulates,
   - controls: `←/→` change currentTime; `↑/↓` change volume,
   - upscale: enable → assert `canvas[data-danmaku-anywhere-upscale]` visible, video opacity 0, canvas size == clamped target,
   - interpolation: enable → assert `data-danmaku-anywhere-frame-interpolation` = `active` (shader-f16) or `fallback`.
3. **Tauri build**: `pnpm --filter @danmaku-anywhere/player tauri build` compiles Rust + bundles the exe/installer (proves desktop packaging).

## 12. Interpretations / decisions (documented, not blocking)

- **"自定义插帧" (custom interpolation):** ~~Framegen is architecturally 2× (midpoint) and extra multipliers are out of scope.~~ **Superseded by §16(4) and §17** — the model's `runT(t)` accepts any `t`, so the shipped knobs are on/off, factor (2×/3×/4×) or target fps, and processing resolution (`480p`/`720p`/`1080p`), plus automatic overload bypass.
- **Danmaku source priority:** local-file import is primary (matches the "network-unreliable" motivation); DanDanPlay online search is an included convenience reusing the provider package.
- **License:** Framegen weights are personal/non-commercial; `LICENSE` + `WEIGHTS_LICENSE.md` ship beside the model and a notice appears in the interpolation settings.
- **No GPU benchmark:** performanceTier is a manual setting (matches extension).

## 13. Verification results (2026-07-24 — DONE)

All acceptance criteria pass; `tsc --noEmit` clean, `vite build` ok, Playwright e2e
green, and `pnpm tauri build` produced `danmaku-player.exe` + MSI + NSIS installer.

| Criterion | Result |
|-----------|--------|
| 1a open video | ✅ 640×360 loaded (blob = same as Tauri stream://) |
| 1b danmaku | ✅ `.da-danmaku` nodes render + scroll, synced to video |
| 1c super-resolution | ✅ WebGPU canvas 1280×720 (=640×360 ×2), video hidden behind it |
| 1d frame interpolation | ✅ Framegen **active** at 640×352, generating midpoint frames |
| 2a volume | ✅ slider + `video.volume` |
| 2b seek keys | ✅ `←/→` change currentTime |
| 2c volume keys | ✅ `↑/↓` change volume |

### Two real bugs found & fixed (both also affect the upstream extension)
1. **Corrupt Framegen manifest in the fork** — `packages/danmaku-anywhere/public/assets/framegen/rt_v7s.json` (3188 B) does not match `rt_v7s.bin`, so Framegen's weight `writeBuffer` overflows and interpolation silently falls back on real (shader-f16) GPUs. The canonical manifest ships in `node_modules/framegen/weights/rt_v7s.json` (2997 B; last layer ends exactly at the bin size). The player bundles the canonical copy.
2. **Local web filter blocks in-browser `.bin` downloads** — on this machine, browser fetches of `*.bin` return an empty HTTP 204 (curl gets 200; `.dat`/`.weights` get 200). The player serves weights as `rt_v7s.dat` and points `weightsBinUrl` at it (bytes identical).

### Packaged-exe verification (2026-07-25) — two more bugs, exe-only, fixed
The browser e2e never exercised the real WebView2 runtime; the first packaged exe
opened to a black screen. Diagnosed by launching the exe with
`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222` and
attaching Playwright over CDP (`e2e/cdp-inspect.mjs`).

3. **Tauri CSP nonce disabled `'unsafe-inline'` → invisible app.** The inline
   `<style>` in `index.html` made Tauri append a `'nonce-…'` to `style-src`;
   per the CSP spec a nonce makes `'unsafe-inline'` ignored, so every
   Emotion/MUI runtime `<style>` was blocked. React mounted fine, but the root
   `Box` (`position:fixed; inset:0` from Emotion) collapsed to 0×0 on a #000
   page = black screen. Fix: base styles moved to `public/app.css` (no inline
   styles anywhere) + `security.dangerousDisableAssetCspModification:
   ["style-src"]`.
4. **Global `window.fetch = plugin-http fetch` swap broke Tauri internals.**
   plugin-http scope-denies anything outside the capability allowlist, which
   broke Tauri's IPC custom-protocol probe (`IPC custom protocol failed …`
   falling back to postMessage) and would scope-deny the relative-URL framegen
   weight fetches. Fix: selective bridge — only `api.danmaku.weeblify.app` and
   `*.dandanplay.net` route through plugin-http; everything else keeps native
   fetch. `main.tsx` also paints bootstrap errors into `#root` now instead of
   failing to a silent black screen.

**Exe re-verification:** `e2e/verify-exe.mjs` (CDP attach) — 14/14 checks pass
inside the packaged exe: CSP-clean bootstrap, layout fills window, video via
`http://stream.localhost/<encoded path>` (640×360, 10 s, range-seekable),
play/seek/volume keys, danmaku nodes, upscale canvas 1280×720 with video
hidden, frame interpolation **active** with generated frames, screenshots in
`test-results/exe-*.png`. Browser e2e suite still green after the fixes.

## 14. Playlist feature (2026-07-25 — DONE, verified in exe)

VLC-style queue, implemented by parallel agents (store / platform / UI) against
this frozen contract; leader owned commands/PlayerHost/keyboard/verification.

- **Store** (`playerStore.ts`): `PlaylistItem {url,name,path?}`, state
  `playlist` / `playlistIndex` (−1 = detached) / `playlistOpen` (all
  session-only), actions `setPlaylist(items, startIndex?)` /
  `appendToPlaylist` / `playPlaylistIndex` / `removePlaylistIndex` /
  `clearPlaylist` / `setPlaylistOpen`. Item switches also clear
  comments/danmakuSource and reset the playback mirror. New setting
  `playbackSettings.autoAdvance` (default on).
- **Platform**: `pickVideoFile` → `pickVideoFiles(): Promise<PickedMedia[]>`
  (multi-select dialog / `<input multiple>`; `[]` on cancel).
- **Commands**: `openVideo` now multi-selects and replaces the playlist;
  added `openVideosFromPaths/Files`, `addVideosToPlaylist`, `playlistPrev` /
  `playlistNext` / `playlistPlayAt`, `togglePlaylist`. Keyboard: `[` / `]`.
- **UI**: `PlaylistDrawer.tsx` (right drawer: count, add/clear, 自动连播
  switch, active-highlighted list, per-item delete), prev/next buttons in
  `Controls.tsx`, 播放列表 button (+count) in `TopBar.tsx`.
- **PlayerHost**: `ended` → auto-advance (when enabled); multi-file drag-drop
  builds a playlist (videos first, then danmaku files); **sibling danmaku
  autoload** — on Tauri, opening `foo.mp4` tries `foo.xml` then `foo.json`
  next to it and mounts it automatically unless danmaku was loaded explicitly.
  `e2e/fixtures/test.xml` exercises this.

### Two more bugs found & fixed during verification
5. **zustand persist shallow-merge wipes newly added settings defaults** — an
   older persisted `playbackSettings` object (without `autoAdvance`) replaced
   the default wholesale, so `autoAdvance` was `undefined` and auto-advance
   never fired for existing installs. Fixed with a deep `merge` option in
   `playerStore.ts` (defaults ← persisted, per settings object incl. nested
   `frameInterpolation`). This protects every future settings addition.
6. **PowerShell 5.1 `Get-Content`/`Set-Content` round-trip mojibakes BOM-less
   UTF-8** — regex-editing `verify-exe.mjs` via PowerShell corrupted its
   Chinese string literals (read as ANSI/GBK). Rewrote the file; edit
   non-ASCII files with proper tools only. Also fixed a latent Playwright
   `waitForFunction(fn, arg, options)` misuse (options were being passed as
   `arg`, so custom timeouts were silently ignored).

**Final exe verification: 19/19 checks pass** (14 original + playlist
creation, sibling-danmaku autoload, drawer UI, next-switching, auto-advance
on ended). Screenshot: `test-results/exe-3-playlist.png`.

## 15. HDR10 support (2026-07-26 — DONE, verified in exe)

Scope decision: full **Dolby Vision / Dolby Atmos are NOT feasible** in the
WebView2 `<video>` architecture (Chromium doesn't decode DV RPU or render Atmos
objects / bitstream-passthrough, and both are Dolby-licensed). What IS feasible
and shipped is **HDR10** — Chromium/WebView2 does the decode + tone-mapping; our
job is detection, not breaking the pipeline, and surfacing status.

Capability probe on this machine (`e2e/probe-hdr.mjs`): HEVC Main10 **HDR10
hardware decode = supported/smooth/powerEfficient** (HEVC Video Extension
2.4.13 installed); AV1 HDR10 = not supported (no AV1 extension); the display is
currently in **SDR mode**, so HDR content tone-maps to SDR (true HDR output
needs Windows HDR toggle + an HDR panel — could not be verified on this SDR
display).

Implementation:
- **Detection** (`src/player/detectHdr.ts`): `new VideoFrame(video).colorSpace.transfer`
  === `'pq'` (HDR10) / `'hlg'` (HLG) on the first `requestVideoFrameCallback`.
  Chromium doesn't expose transfer on `<video>` directly; the VideoFrame does.
  (The DOM lib's `VideoTransferCharacteristics` union predates the HDR values →
  read `transfer` as a plain string.)
- **Store**: session-only `isHdr` / `hdrTransfer`, `setHdr()`; reset on every
  media switch (`setMedia` + `resetPlaybackForNewMedia`).
- **HDR × Anime4K conflict** (the one real hazard): the upscale path renders
  through an 8-bit sRGB WebGPU canvas, which clips/mangles PQ/BT.2020. So HDR
  sources **suppress upscaling at runtime** — the user's `upscale.enabled`
  setting is kept, but a dedicated decision effect in `PlayerHost` skips
  applying it (keeps the native `<video>`, which WebView2 outputs/tone-maps
  correctly) and shows a one-time OSD. Switching back to an SDR source resumes
  upscaling automatically.
- **UI**: gold `HDR10` / `HLG` chip in `TopBar` next to the filename.

Verified: `e2e/verify-hdr.mjs` (5/5) using an ffmpeg-generated
`e2e/fixtures/hdr10_test.mp4` (HEVC Main10, PQ, BT.2020) — SDR clip not flagged,
HDR clip decodes + flagged `pq`, upscale suppressed on HDR (video stays
visible), upscale resumes on SDR (1280×720 canvas). The 19-check acceptance and
browser suite still pass. Screenshot: `test-results/exe-4-hdr-badge.png`.

### Verification harness notes
- e2e drives the player through `window.__player` (store + commands) with a real
  ffmpeg-generated seekable `e2e/fixtures/test.mp4` loaded as a blob.
- Vite `preview` also returns 204 for `.bin`; the e2e serves the prebuilt `dist/`
  with `e2e/serve-dist.mjs` (range + CORS). Build first, then run the suite.
- The Vite **dev** dep-optimizer chokes on the excluded/aliased workspace TS
  packages, so `pnpm dev` currently can't load the app — irrelevant to the
  product (Tauri packages via `vite build`). Fix later if `tauri dev` is wanted.

```

## 16. UX fixes + variable frame interpolation (2026-07-26 — DONE, verified in exe)

Four follow-up items requested after the HDR10 pass. All verified: **24/24**
`e2e/verify-exe.mjs` (was 19) + **5/5** `verify-hdr.mjs` + **14** engine unit
tests + browser e2e.

**(1) Danmaku position wrong after fullscreen toggle.** The `@mr-quin/danmu`
engine caches the container width when tracks are built and nothing called
`DanmakuRenderer.resize()` on a resize, so comments spawned from a stale
x-position after entering/leaving fullscreen. Fix: `PlayerHost` observes the
danmaku overlay with a `ResizeObserver` (rAF-coalesced) → `danmakuCtrl.resize()`.

**(2) Settings/danmaku/playlist unreachable in fullscreen.** MUI `Drawer`/`Dialog`
portal to `document.body`, which is hidden behind the fullscreen element (only the
fullscreen subtree renders). Fix: `FullscreenPortalContext` (`src/player/fullscreenPortal.ts`)
carries the stage element; the three overlays pass `slotProps={{ root: { container } }}`
so they portal INTO the stage (which is the fullscreen root). The stage carries a
`data-player-stage` attribute; verify-exe asserts `stage.contains(drawer)`.

**(3) Persistent playlist as history + resume.** `playerStore` persists the
`playlist` (path-backed items only — blob opens can't be revived) and a
`progress: Record<path, {time, duration, updatedAt}>` map. Opening media now
**adds to** the playlist instead of replacing it (dedup by path/url, capped at
200, oldest dropped) via the `openMedia` action, so the list is a running history
that survives restarts; the first opened item becomes current and plays. On
launch the queue is restored **detached** (`playlistIndex: -1`, media never
auto-loaded — a moved/deleted file can't wedge startup); clicking an item resumes
from `progress`. `openMedia` assigns a fresh media object so re-opening the
current file still re-runs load + resume. Resume seeks on `loadedmetadata` when
`3 < time < duration*0.95`; progress is saved throttled on `timeupdate`, on
`pause`, on `pagehide`, and cleared on `ended`. verify-exe/verify-hdr clear
localStorage via `addInitScript` for determinism.

**(4) Variable frame interpolation (factor / target fps).** The Framegen model's
`runT(t)` accepts any `t`, so N-1 intermediate frames per source pair is a direct
extension (was hard-coded `runT(0.5)`). `FrameInterpolationOptions` gained
optional `multiplier` and `targetFps` (extension passes neither → 2×, unchanged).
Engine (`frame-interpolator.ts`): pure `resolveInterpolationFactor` / 
`computeMaxInterpolationFactor` (unit-tested), mid-texture pool sized to
`(maxFactor-1)*3+2`, `processPair` loops `k/factor` and enqueues each at a
proportional `displayAt`; overload budget is now the whole source interval
(`intervalMs*0.85`). `takeDueFrame` already pulls at the monitor refresh via rAF,
so output naturally caps at the refresh rate. Factor cap is 8. Player UI adds a
mode toggle (倍率 2×/3×/4× · 目标帧率 60/120/144/170); `targetFps` adapts the live
factor to the measured source fps. **Ceiling reality:** output ≤ display refresh;
2× already saturates 60Hz for 24–30fps content — higher factors only pay off on
high-refresh monitors (targeted here at a 170Hz display).

### One caveat observed
Rapidly changing the factor 3× back-to-back (verify-exe #12) logs a transient
`getCurrentTexture: context is not configured` from the presentation loop firing
mid-reconfigure. It is caught, non-fatal, and self-heals to `active`; it is the
renderer's existing reconfigure path, not the multi-frame change. A single
user-driven factor change triggers one reinit and is unaffected.


## 17. Interpolation processing resolution up to 1080p (2026-07-26 — DONE, verified in exe)

**Complaint:** "当前这个补帧的分辨率只有 720P 吗?能不能补到跟当前分辨率一样?"

**What was actually true.** The *output* resolution was never capped at 720p — the
Anime4K chain still scales to `targetResolution` (up to 4K). But with interpolation
on, **every** frame (real ones too) is first resampled down to the interpolation
working size (`calculateInterpolationDimensions`, height ≤ 720) before Framegen,
and the Anime4K chain then runs on *that* texture (`createResources` sizes
`videoFrameTexture` from `frameInterpolator.dimensions`;
`processDueInterpolatedFrame` → `encodeInterpolationInput` → pipelines). So detail
was genuinely capped at 720p: a 1080p source got downsampled and then guessed back
up. The user's perception was correct even though the canvas said 4K.

**Change.** `FrameInterpolationResolution` gains `'1080p'` (engine `types.ts`,
mapped in `calculateInterpolationDimensions`), mirrored in the player's
`InterpolationResolution` and exposed as a third toggle. Default stays `720p`; the
extension never sets `1080p`, so its behavior is unchanged.

**Why 1080p and not native/4K.** Cost scales with pixel count (1080p = 2.25× of
720p) and multiplies with the factor from §16(4). On this machine's mid-range GPU,
4K neural interpolation would mostly live in the overload-bypass path, which looks
worse than not interpolating. 1080p is the honest ceiling here; raising it later is
a one-line map change plus a UI entry.

**No upsampling.** The scale is `min(1, …)`, so a 640×360 source stays 640×352 at
any setting — choosing `1080p` for a sub-1080p source is a no-op, not a quality
gain. 16-pixel alignment means 1080p processes as 1920×1072.

**Verified:** engine unit tests 16/16 (added 1080p and 4K-source dimension
asserts), engine + player type-check, `vite build`, `tauri build`, and in the real
exe `verify-exe.mjs` **25/25** plus an ad-hoc CDP check that setting
`resolution:'1080p'` stays `active` and keeps generating frames.

## 18. Post-review bug sweep (2026-07-26 — DONE, verified in exe)

A review of §16/§17 found one bug of the same class the user had already
reported, plus several gaps the new persistent history exposed. All fixed and
covered by `verify-exe.mjs` (now **30 checks**) / `verify-hdr.mjs` (**6**).

**(1) Overlays were only half fixed for fullscreen.** §16(2) gave the three
drawers/dialog an explicit portal container, but the playback-rate `Menu` and
every `Tooltip` still went to `document.body`. Reproduced over CDP in the exe:
the menu opened at 83x209 but `elementFromPoint` at its own centre returned the
`<video>` — invisible, and `Menu`'s backdrop swallowed the next click, so
fullscreen looked frozen. Fixed *systemically* instead of per call site: a
nested `ThemeProvider` in `PlayerHost` sets `defaultProps.container` for
`MuiModal`/`MuiPopover`/`MuiPopper` to the stage, so every present and future
overlay portals correctly. (The explicit `slotProps.root.container` on the three
overlays stays as belt-and-braces.)

**(2) Failed loads were silent.** Nothing listened to `<video>`'s `error`. With
a history that outlives the files it points at, a moved/deleted file just showed
a black screen. Added an error listener in `useVideoElement`, `mediaError` in the
store, and a dismissible `Alert` (with the offending path) over the stage.

**(3) The playlist showed no watch state.** `progress` was persisted but never
displayed. The drawer now shows `看到 mm:ss / mm:ss · 3 天前` (or `已看完`) plus a
progress bar, and highlights the *playing* entry by path rather than by
`playlistIndex` — the two diverge once the playing entry is removed. Order is
deliberately still insertion order: the list doubles as the play queue, so
re-sorting by recency would silently change what "next" means.

**(4) HDR suppression lied about status.** The HDR branch called `reset()`,
which tears the renderer down *without* firing the status callbacks, so the panel
kept showing "已启用 / 补帧运行中". Now calls `disable()`.

**(5) "Clear the resume point when finished" never ran.** Traced in the exe: the
auto-advance `ended` listener switches media, React flushes that store update
**synchronously inside the same event dispatch**, the media-keyed effect's
cleanup unregisters the remaining listeners, and a listener removed mid-dispatch
is never invoked — so the `clearProgress` that lived next to the save handlers
was dead code. Moved into the element-keyed effect (which survives media
changes). `save()` also now bails when `video.ended`, so the cleanup that runs
while switching cannot write the point back at ~100%.

**(6) A high target fps at 1080p would have thrashed.** Cost is
`(factor - 1) x processing pixels`, and pools are sized for the worst case: a
170fps target reserved 23 mid textures (~190 MB at 1080p) and then could not
finish a pair inside one 24fps interval, so it would oscillate through the
2-second overload bypass. Added `computeResolutionFactorCap()` — a per-pair
megapixel budget that leaves 720p at the full 8x and settles 1080p at 4x — and a
UI note. 480p/720p behaviour is unchanged.

**(7) Smaller ones.** Removing the playing entry now parks the cursor just before
the freed slot so next/auto-advance carry on instead of going dead;
`playPlaylistIndex` takes a fresh media copy so re-selecting the current entry
reloads like `openMedia` does; keyboard shortcuts are ignored inside an open
overlay (Space no longer steals activation from a focused switch); `progress` is
capped at 500 entries (least-recently-updated dropped); and the history cap no
longer leaks when the re-opened item is the oldest one.

**Aspect-ratio fix.** `calculateInterpolationDimensions` used to floor both sides
onto the 16-pixel grid independently, squashing 640x360 by 2.2% (-> 640x352) and
1080p by 0.74%. It now picks the aligned width nearest the source aspect
(640x360 -> 624x352, 1920x1080 -> 1904x1072).

## 19. Main-window redesign: frameless chrome + idle stage (2026-07-26 — DONE)

User feedback: the native Windows title bar ("大黑条") and the form-like empty
state read as a wrapped web page, and the flat two-stop purple looked cheap.

**Frameless window.** `decorations: false`; the top pill bar is the title bar
now — `data-tauri-drag-region` on the bar/pill/middle-stack (children stay
clickable), double-click maximizes, and ─ □ ✕ render at the pill's right end via
new `Platform.minimizeWindow/toggleMaximizeWindow/closeWindow` (no-ops in the
browser adapter, buttons gated on `isTauri`). Capabilities add
`core:window:allow-{minimize,toggle-maximize,close,start-dragging}`.

**Idle stage (EmptyState).** Manga ink scene: halftone dot ground + conic
speed-lines, four drifting danmaku (left:100% → ink-dm sweep), a rotated PAPER
hero block with `弾幕プレイヤー` in Zen Antique + vermilion hard shadow, anime
sparkles (✦), a sweep-animated open button, a continue-watching grid (3 cols,
`minmax(0,1fr)`, fed from playlist+progress top 3 by `updatedAt`), and a
floating mascot (`mascot-manga.png`, responsive shrink <1600px, hidden <1200px).
Scroll-safe centering via `min-height:100%` flex centerer inside an overflow-auto
layer. The bottom Controls bar no longer renders with no media loaded.

**Verify:** 30/30 in the packaged exe; the empty-state innerText check now sees
the ghost danmaku, which is expected.

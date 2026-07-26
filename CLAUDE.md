# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

A separate `AGENTS.md` at the repo root covers Windows shell setup (force the console to UTF-8 with `[Console]::InputEncoding/OutputEncoding` + `chcp 65001` before anything else) and an optional local proxy. Its install/build/package commands duplicate the ones below — when you change a command here, change it there too.

## Working Preferences

- **Prefer agent teams and subagents**: For non-trivial tasks (multi-file changes, code review, refactoring, feature implementation), use `TeamCreate` + `Task` tool to spawn multiple agents working in parallel. Split work by file scope or responsibility (e.g., one agent per file group, or separate agents for implementation vs testing). Use the `Explore` subagent for codebase exploration and the `Plan` subagent for architecture planning.
- **Architectural Integrity (Plan-First)**: For 0-to-1 features or new modules, the `Plan` subagent must define the architecture and output a `CONTRACT.md` or API specs before any implementation begins. No code should be written until the "contract" is established and confirmed.
- **Strict File Scope & Responsibility**: When spawning teams, assign **exclusive** file paths or directories to each agent to prevent merge conflicts. Agents are strictly forbidden from modifying files outside their assigned scope (e.g., `Agent-A` for `src/`, `Agent-B` for `tests/`).
- **Dependency & Mocking**: Only the Leader agent or user can modify root-level configs (e.g., `package.json`, `pom.xml`). Parallel agents must use **Mocks** if a dependency from a teammate is not yet ready to maintain parallel speed.
- **Synchronization**: After team tasks are complete, invoke the `Explore` subagent to perform a cross-check, ensuring no duplicate logic exists and all code adheres to the initial `Plan`.
- **Single agent for simple tasks**: Only work inline for single-file edits, trivial fixes, or quick lookups.

## Project Overview

Danmaku Anywhere is a monorepo for a browser extension and web app that displays danmaku (bullet comments) on video platforms. Uses pnpm workspaces.

**Repo root:** `danmaku-anywhere/` (relative to this file)

### Fork Info

This is a performance/UX fork (`2832599985/danmaku-anywhere-perf`) of `Mr-Quin/danmaku-anywhere`. Active feature branch: `feat/anime4k-upscale`.

**Fork-specific features** (preserve during upstream merges):
- Glass/neon UI theme (violet/fuchsia palette, `backdropFilter: blur(12px)`, dark mode only)
- Fixed time skip button (default 90s, `FixedSkip.service.ts`)
- Auto skip OP via danmaku timestamp analysis (`VideoSkip.service.ts`)
- Batch download in season details page (`SeasonDetailsPage.tsx`)
- Comment dedup (`common/utils/utils.ts` + `DanmakuMergeService`): within one source keys prefer a provider-scoped `cid`; the cross-provider multi-source merge dedupes on the `p+m` composite ONLY — a bare `cid` is never a cross-provider identity (they collide between providers)
- CID preservation as optional field in `CommentEntity`
- MacCMS title mapping support (season/episode persistence for automatic matching)
- Anime4K WebGPU super-resolution (`packages/upscale-engine`, `src/content/player/upscaler/`); integration points are extension options v34-v35, player RPC commands, floating-panel controls, and the optional `anime4k-cors` DNR ruleset
- Optional Framegen frame interpolation before Anime4K (variable factor; the extension leaves multiplier/targetFps unset → 2×); extension options v36 stores the processing-resolution preference (480p/720p/1080p), model assets live in `public/assets/framegen/`, and unsupported GPUs / OOM fall back to Anime4K without disabling super-resolution
- Local Tauri v2 desktop player (`app/player/`) reusing the danmaku/upscale engines for local video files: persistent playlist with auto-advance + resume-history (per-file position), sibling-danmaku autoload, fullscreen-safe overlays (portal into the stage), Anime4K + variable Framegen interpolation (2×/3×/4× or target-fps, processed at 480p/720p/1080p), HDR10 detection, `stream://` range protocol; spec and verification log in `app/player/CONTRACT.md`

## Common Commands

All commands run from repo root (`danmaku-anywhere/`).

```bash
# Install & build (extension and its dependencies)
corepack enable
corepack prepare pnpm@10.11.0 --activate
corepack pnpm -r --filter @mr-quin/danmaku-anywhere... install
corepack pnpm -r --filter @mr-quin/danmaku-anywhere... build

# Test extension. The `run` arg is REQUIRED — the package's `test` script is bare
# `vitest`, so omitting it starts watch mode and hangs a non-interactive session.
corepack pnpm -C packages/danmaku-anywhere test run

# Run single test file
corepack pnpm -C packages/danmaku-anywhere test run src/path/to/file.test.ts

# Test and type-check the WebGPU upscale engine
corepack pnpm --filter @danmaku-anywhere/upscale-engine test
corepack pnpm --filter @danmaku-anywhere/upscale-engine type-check

# Run the real-browser upscale and package-asset checks
corepack pnpm -C packages/danmaku-anywhere exec playwright test e2e/upscale.spec.ts e2e/package-assets.spec.ts --workers=1

# Desktop player (app/player): gates, browser e2e, package the exe
corepack pnpm -C app/player type-check
corepack pnpm -C app/player build                       # vite build (`pnpm dev` is broken, see player notes)
corepack pnpm -C app/player exec playwright test --workers=1   # runs against the prebuilt dist
export PATH="$HOME/.cargo/bin:$PATH" && corepack pnpm -C app/player tauri build   # cargo is NOT on PATH

# Verify the packaged exe itself (25 checks incl. WebGPU + playlist + resume):
# launch it with WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222, then
node app/player/e2e/verify-exe.mjs

# Package extension (Chrome/Edge) — output: packages/danmaku-anywhere/package/
corepack pnpm -C packages/danmaku-anywhere package

# Lint & format (all packages)
corepack pnpm -r -F "./packages/**" lint
corepack pnpm -r -F "./packages/**" format

# Type check. Workspace packages must be BUILT FIRST or consumers report phantom
# errors against missing dist output — this is the order CI (pr-quality.yml) uses.
corepack pnpm build:packages && corepack pnpm type-check

# Upstream merge workflow
git fetch upstream
git merge upstream/main
```

## Project Structure

```
danmaku-anywhere/
├── packages/
│   ├── danmaku-anywhere/   # Browser extension (React + Vite)
│   ├── danmaku-converter/  # Danmaku format conversion + canonical types
│   ├── danmaku-engine/     # Canvas rendering engine + plugins
│   ├── danmaku-provider/   # API wrappers (Bilibili, DanDanPlay, MacCMS)
│   ├── upscale-engine/     # Anime4K WebGPU super-resolution engine (fork)
│   ├── bangumi-api/        # Bangumi API client with auto-generated schemas
│   ├── integration-policy/ # XPath/AI integration policy types
│   ├── result/             # Result<T, E> type (@danmaku-anywhere/result)
│   └── web-scraper/        # Web scraping utilities
├── app/player/             # Local Tauri v2 desktop danmaku player (fork)
├── app/web/                # Angular web application
├── backend/
│   ├── proxy/              # Cloudflare Workers + D1 + drizzle + better-auth
│   └── deploy/             # Node/Docker community server (Dockerfile, compose)
├── patches/                # pnpm patch for @mui/system — account for it on MUI upgrades
└── docs/                   # Astro documentation (NOT a pnpm workspace, see below)
```

Workspace globs (`pnpm-workspace.yaml`) are `packages/**`, `backend/**`, `app/**` — `docs/` is deliberately outside, so `pnpm -r <script>` never touches it.

Type-checking is not uniform: most packages run `tsgo` (`@typescript/native-preview`), while `packages/danmaku-anywhere`, `app/player`, and `upscale-engine` run plain `tsc`. `backend/proxy` names its script `type-check:local`, not `type-check`.

## Extension Architecture

The extension uses a three-layer content script architecture with RPC communication:

```
┌─────────────────────────────────────────────────────────────────┐
│                     Background Service Worker                   │
│  src/background/index.ts                                        │
│  - RpcManager: handles ~90 RPC methods                          │
│  - ScriptingManager: dynamic script injection                   │
│  - PortsManager: streaming data (danmaku parse)                 │
│  - IoC container (Inversify) for all services                   │
└───────────────────────────┬─────────────────────────────────────┘
                            │ chrome.runtime.sendMessage
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Controller Script (React)                    │
│  src/content/controller/index.tsx                               │
│  - UI for danmaku management (floating button, panels)          │
│  - FrameManager: tracks video frames, injects player scripts    │
│  - Integration observers (XPath/AI) for media matching          │
│  - Renders in Shadow DOM + Popover API                          │
└───────────────────────────┬─────────────────────────────────────┘
                            │ playerRpcClient (frameId-filtered)
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Player Script (per-frame)                    │
│  src/content/player/index.ts                                    │
│  - DanmakuManagerService: mount/unmount/seek                    │
│  - VideoNodeObserverService: detects video elements             │
│  - VideoSkipService: skip OP/ED detection                       │
│  - FixedSkipService: timed skip button                          │
│  - Renders danmaku via danmaku-engine                           │
└─────────────────────────────────────────────────────────────────┘
```

### Entry Points

The extension has four distinct entry points (paths relative to `packages/danmaku-anywhere/`):

| Entry | HTML / Script | Purpose |
|-------|--------------|---------|
| **Popup** | `pages/popup.html` → `src/popup/index.tsx` | Toolbar popup UI (hash router, all settings/search/danmaku pages) |
| **Dashboard** | `pages/dashboard.html` → reuses popup script | Full-page version of popup |
| **Controller** | `src/content/controller/index.tsx` | Injected into matching pages; Shadow DOM + Popover React app |
| **Player** | `src/content/player/index.ts` | Injected per-frame on video detection; danmaku rendering + skip services |
| **App bridge** | `src/content/app/index.ts` | Runs on web app URLs; relays RPC via `window.postMessage` |

Each entry point wraps in `EnvironmentContext` (`popup`, `controller`, etc.) to differentiate behavior.

### Key Files

| Area | Path | Purpose |
|------|------|---------|
| Background IoC | `src/background/ioc.ts` | Inversify container, singleton services |
| Background RPC | `src/background/rpc/RpcManager.ts` | ~90 RPC method handlers |
| Episode Matching | `src/background/services/matching/EpisodeMatchingService.ts` | Three-strategy matching pipeline |
| Provider Factory | `src/background/services/providers/ProviderFactory.ts` | Creates provider instances per config |
| Controller Entry | `src/content/controller/index.tsx` | React app in Shadow DOM |
| Frame Manager | `src/content/controller/danmaku/frame/FrameManager.tsx` | Multi-frame orchestration |
| Player Entry | `src/content/player/index.ts` | RPC server + service initialization |
| RPC Types | `src/common/rpcClient/background/types.ts` | All RPC method definitions |
| Popover Host | `src/content/common/host/createPopoverRoot.ts` | Shadow DOM + Popover setup |
| Database | `src/common/db/db.ts` | Dexie DB (`DanmakuAnywhereDb`) with 13 migration versions |
| Theme | `src/common/theme/Theme.tsx` | Glass/neon theme (fork feature) |
| Fixed Skip | `src/content/player/fixedSkip/FixedSkip.service.ts` | Timed skip button (fork feature) |
| Video Skip | `src/content/player/videoSkip/VideoSkip.service.ts` | Auto OP skip (fork feature) |
| Upscale Service | `src/content/player/upscaler/Upscale.service.ts` | Connects extension options, video lifecycle, Anime4K, and Framegen fallback reporting |
| WebGPU Renderer | `packages/upscale-engine/src/core/renderer.ts` | Anime4K pipeline, presentation loop, resource rebuild serialization |
| Frame Interpolator | `packages/upscale-engine/src/core/frame-interpolator.ts` | Framegen capture, timeline/seek handling, overload bypass, and generated-frame queue |
| DDP API | `packages/danmaku-provider/src/providers/ddp/api.ts` | DanDanPlay API wrapper (Result-boundary validation) |
| Comment Dedup | `src/common/utils/utils.ts` | `commentKey`/`dedupeComments`/`fuzzyDedupeComments` |
| Batch Download | `src/popup/pages/search/seasonDetails/SeasonDetailsPage.tsx` | Multi-episode download |

### RPC Communication

- **Background ↔ Content**: `chromeRpcClient` using `chrome.runtime.sendMessage`
- **Controller → Player**: `playerRpcClient.player['relay:command:*']({ frameId, data })`
- **Player → Controller**: `playerRpcClient.controller['relay:event:*']({ frameId })`
- **Streaming**: `chrome.runtime.connect()` ports for large data (danmaku parsing)

### Shadow DOM & Popover

All UI renders in Shadow DOM with `popover="manual"` for top-layer positioning. On fullscreen change, call `hidePopover()` then `showPopover()` to stay on top. Use `textContent` (never `innerHTML`) for injecting styles into shadow style elements.

### Episode Matching Pipeline

When a video is detected, `EpisodeMatchingService` runs three strategies in order. The first to return a non-null result wins; returning `null` passes to the next strategy.

```
LocalMatchingStrategy → MappingMatchingStrategy → SearchMatchingStrategy
```

1. **LocalMatchingStrategy**: Checks for locally-imported custom danmaku matching the title. Skipped if `matchLocalDanmaku` is disabled.
2. **MappingMatchingStrategy**: Looks up existing title-to-season mappings. Uses `EpisodeResolutionService` to resolve the specific episode number via the provider's `findEpisode()`.
3. **SearchMatchingStrategy**: Performs an online search via all enabled automatic providers. If exactly one season is found, auto-maps it. If multiple results, returns `disambiguation` status for user selection.

Result type: `MatchEpisodeResult` — discriminated union with statuses `success`, `disambiguation`, `notFound`.

### Provider Factory

`DanmakuProviderFactory` (Inversify factory) creates provider instances from `ProviderConfig`. Each call creates a **new instance** — providers are stateless between calls. Four provider types: `DanDanPlay`, `Bilibili`, `Tencent`, `MacCMS`.

MacCMS keeps a module-level `episodeCache` (bounded Map keyed by `indexedId`, ~100 entries, shared across factory instances; tests reset it via `clearMacCmsEpisodeCache()`). On cache miss, `getEpisodesByIndexedId()` re-searches by title to recover — this handles service worker restarts. `getEpisodes()` intentionally throws: MacCMS season identity lives only in `indexedId`, so callers must use `getEpisodesByIndexedId()`.

### Data Storage

**Dexie.js** (IndexedDB wrapper) with three databases:
- `danmaku-anywhere`: Main DB — tables: `episode`, `season`, `customEpisode`, `seasonMap` (13 migration versions)
- `danmaku-anywhere-logs`: Logging DB — table: `logs`
- `danmaku-anywhere-image`: Image cache DB — table: `image`

**chrome.storage** (via `ExtStorageService`): Options/config stored in `chrome.storage.local/sync/session`.

Dexie upgrade rules (each was a shipped data-loss bug): never pass an `async` callback to `each()` — the returned promise is discarded, so the upgrade reports done while writes are in flight; use `toArray()` + an awaited loop. Wrap per-row writes in try/catch — one unhandled rejection aborts the whole upgrade transaction, and Dexie retries it on every open, bricking the DB. Options migrations must guard missing fields and must never `reset()` on failure (that wipes all user settings); adding a value to an existing enum needs no new version.

### Internationalization

Two-layer i18n:
- **chrome.i18n**: `_locales/{en,zh_CN}/messages.json` for manifest strings (`extName`, `extDescription`)
- **i18next + react-i18next**: `src/common/localization/locales/{en,zh}/translation.json` for UI strings with type-safe `t()` keys

The type augmentation in `src/common/localization/resources.ts` MUST keep the `{ translation: typeof enTranslation }` shape — flattening it silently disables `t()` key checking (~120 phantom tsc errors once buried real runtime crashes for months). `i18n:check` / `i18next-cli extract` MUTATES the locale files when run. Table-driven keys (assembled dynamically, invisible to static extraction) must be listed in `preservePatterns` in `i18next.config.ts` or the extractor deletes their translations.

## Tech Stack

| Area | Stack |
|------|-------|
| Extension | React 19+, MUI, TanStack Query, Zustand, Vite, Inversify |
| Web App | Angular 20+, PrimeNG, Tailwind, TanStack Query, Signals |
| Backend | Cloudflare Workers, TypeScript |
| Core | TypeScript (strict), Biome, pnpm workspaces |
| Validation | Zod for runtime schema validation (provider APIs, config) |
| Error Handling | `Result<T, E>` pattern (`@danmaku-anywhere/result`) for provider APIs |

## Code Style

**Biome** enforces: 2-space indent, 80-column width, single quotes (JSX uses double), `semicolons: "asNeeded"` (not "none" — semicolons still appear where syntactically required), trailing commas (ES5), LF endings. Config: `biome.json`, which sets `linter.rules.recommended: false` and hand-picks rules; `noExplicitAny` and `noNonNullAssertion` are warnings, not errors. Test files (`**/*.test.ts`) relax `noExplicitAny` and `noEmptyBlockStatements`.

`lefthook.yml` installs a pre-commit hook (via `pnpm prepare`) that runs `biome check --write` on staged files with `stage_fixed: true` — **commits rewrite and re-stage your files**. `packages/danmaku-anywhere`'s `lint` is `tsc && biome check --fix`, so type errors fail lint there but not in other packages. The extension is currently at **zero** `tsc --noEmit` errors — keep it there; when the count was left red the noise hid genuine runtime crashes.

**TypeScript**: Strict mode, `import type` for type-only imports, no `any` (use `unknown`). Extension tsconfig enables `experimentalDecorators` + `emitDecoratorMetadata` for Inversify. Path alias: `@/*` → `./src/*`.

## Key Patterns

### React Hooks Rules
- All hooks (`useState`, `useMemo`, `useEffect`, etc.) MUST be called before any early returns
- Use `useEventCallback` (from MUI) for event handlers that need fresh closure values without re-triggering effects
- Read Zustand store state with `useStore.getState()` inside callbacks (not from render closure) for freshness

### Inversify Services
- Services use `@injectable('Singleton')` + `@inject()` decorators
- Background services registered in `src/background/ioc.ts` — `Container({ autobind: true, defaultScope: 'Singleton' })`
- Content services use separate IoC containers (`uiContainer` in `src/common/ioc/uiIoc.ts`)
- `DanmakuProviderFactory` bound as Inversify factory (creates new instances per call)

### Provider API Pattern
- All provider APIs return `Result<T, DanmakuProviderError>` (never throw)
- Check `result.success` before accessing `result.data`
- DanDanPlay API uses `fetchDanDanPlay` wrapper with context-based routing (custom URL vs proxy)
- Zod schemas validate all API responses

### Zustand + Immer
- Store updates via `set()` callback — always read state inside the callback for draft safety
- `frameId === 0` is valid — use `frameId !== undefined` checks, not falsy checks

## Framework Guidelines

### React (packages/danmaku-anywhere/)
- Functional components with hooks
- TanStack Query for server state, Zustand for global client state
- Services use `@injectable('Singleton')` + `@inject()` decorators
- Use `React.memo` for expensive components, `useMemo`/`useCallback` appropriately
- Error boundaries for component error handling
- Test with Vitest — tests colocated with source (`.test.ts` suffix), setup mocks in `src/tests/`
- Vite builds via `@crxjs/vite-plugin` with `manifest.ts` (Manifest V3)
- Standalone mode available via `vite.standalone.config.ts` + `VITE_STANDALONE` env var
- Env vars: `VITE_PROXY_URL` and `VITE_PROXY_ORIGIN` (see `.env.example`), plus `VITE_STANDALONE` and `VITE_TARGET_BROWSER`
- CI (`.github/workflows/pr-quality.yml`, Node 24) runs `pnpm install` → `build:packages` → `type-check` → `lint` → tests for **changed packages only** (`pnpm --filter '...[<base-sha>]' test run`), so a green PR does not mean the whole suite ran. A separate workflow enforces PR title format, and `i18n-check.yml` enforces translation keys (`pnpm -C packages/danmaku-anywhere i18n:check`).

### Angular (app/web/)
- Standalone components (no `standalone: true` needed)
- `input()` / `output()` functions, not decorators
- Signals + `computed()` for state
- `@if` / `@for` / `@switch` control flow (not structural directives)
- `injectQuery` / `injectMutation` from TanStack Query
- `ChangeDetectionStrategy.OnPush` always
- No `ngClass` / `ngStyle` — use class/style bindings
- Reactive Forms only
- Test with Jasmine

## Extension Development Notes

- Content scripts inject via `ScriptingManager` based on `MountConfig`
- Player script injected per-frame on video detection
- Use `pointer-events: none` on containers, `pointer-events: auto` on interactive elements
- Validate all user inputs; no `eval()` or `innerHTML`
- External RPC whitelist: only expose safe read-only methods via `onMessageExternal`
- Always add cleanup in `ResizeObserver`/event listener teardown (disconnect observers, remove listeners, clear intervals)
- Treat Framegen as optional. Initialization or GPU-capacity failures must keep Anime4K active, reset the interpolation preference, and notify the user.
- Keep resize, configuration, and interpolation resource rebuilds serialized. Rendering must skip frames while shared GPU resources are being replaced.
- Frame interpolation timing must use rVFC `mediaTime` and `expectedDisplayTime`; clear queued frames on seeks and discard stale frame-pair work before GPU readback.
- Pipeline rebuilds publish on success and roll back on failure — never destroy the live pipeline set before its replacement is ready (a mid-rebuild throw must leave the old chain rendering), and device-loss recovery must run inside the rebuild lock and end with exactly ONE rVFC loop.
- Interpolation overload detection counts pairs that produced no displayable sub-frame. Never time the GPU queue via `onSubmittedWorkDone` — it measures the entire queue including the Anime4K passes and misattributes saturation to Framegen. Source-pool saturation must briefly bypass interpolation, never freeze the presented frame behind a success return.
- Keep `public/assets/framegen/LICENSE` and `WEIGHTS_LICENSE.md` beside the bundled model. The weights are restricted to personal, non-commercial use.

## Desktop Player (app/player)

Tauri v2 + React 19 desktop player (fork feature) that reuses the workspace engines for local video. Architecture, frozen module contracts, and the full verification log live in `app/player/CONTRACT.md` — read it before changing the player.

**Architecture in one line:** platform adapter (`src/platform/`) lets the identical React tree run in a plain browser (blob URLs, for Playwright) and in WebView2 (`http://stream.localhost/<encoded path>` served by the range-capable, CORS-clean Rust protocol in `src-tauri/src/stream.rs`); Zustand store + imperative `UpscaleController`/`DanmakuController` glue the engines to one `<video>`.

**Hard rules (each one was a real shipped bug — violations mean black screen or silently broken features):**
- NEVER put inline `<style>` or `style=` attributes in `index.html`. Tauri gives inline content a CSP nonce, and a nonce makes `'unsafe-inline'` ignored, which blocks every Emotion/MUI runtime style → app renders 0×0 on black. Base CSS belongs in `public/app.css`; keep `security.dangerousDisableAssetCspModification: ["style-src"]` in `tauri.conf.json`.
- NEVER swap `window.fetch` wholesale to `@tauri-apps/plugin-http`. The plugin rejects URLs outside the capability scope, which breaks Tauri's own IPC probe and same-origin asset fetches (Framegen weights). Keep the selective bridge in `src/platform/tauri.ts` (only DanDanPlay/proxy hosts).
- When adding a field to persisted settings, it only survives existing users' localStorage because of the deep `merge` in `playerStore.ts` persist options (zustand's default merge is shallow and wipes new defaults). Extend that merge for any new nested settings object.
- WebView2 blocks autoplay without a user gesture. The window config sets `additionalBrowserArgs` with `--autoplay-policy=no-user-gesture-required`; if you edit that string, preserve Tauri's default `--disable-features=...` args.
- Framegen weights ship as `rt_v7s.dat` (a local web filter returns empty 204 for `.bin` fetches) using the canonical manifest from `node_modules/framegen/weights/rt_v7s.json`. (The extension's `public/assets/framegen/` copy was once size-mismatched but is now verified self-consistent — re-check manifest offsets against .bin byte size before "fixing" either copy from the other.)
- `pnpm dev` / `tauri dev` do not work (Vite dep-optimizer chokes on the aliased workspace TS sources). Always verify against `vite build` output; the browser e2e serves `dist/` via `e2e/serve-dist.mjs` (Vite preview 204s `.bin`-like assets and orphans zombie servers on port 3060).
- Playlist semantics: every "open" goes through the playlist store actions (single file = playlist of 1); switching items clears danmaku, then on Tauri a sibling `<name>.xml`/`<name>.json` next to the video is auto-mounted unless danmaku was explicitly loaded.
- Browser-green ≠ exe-green: CSP, IPC, capability scopes, and autoplay only fail in the real WebView2. After meaningful changes run `e2e/verify-exe.mjs` (CDP attach to the exe launched with `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222`; also handy interactively via `e2e/cdp-inspect.mjs`).
- On this machine cargo lives at `~/.cargo/bin` but is NOT on PATH; prefix builds with `export PATH="$HOME/.cargo/bin:$PATH"`. Never regex-edit files containing non-ASCII text via PowerShell 5.1 (`Get-Content`/`Set-Content` read BOM-less UTF-8 as ANSI and mojibake it) — use proper editing tools.
- MUI `Drawer`/`Dialog` portal to `document.body`, which is HIDDEN behind the fullscreen element (only the fullscreen subtree renders in the top layer). Overlays that must work in fullscreen pass `slotProps={{ root: { container } }}` pointing at the stage element (`data-player-stage`, carried via `FullscreenPortalContext`). The `@mr-quin/danmu` engine caches container width, so call `DanmakuController.resize()` from a `ResizeObserver` on fullscreen/window resize or danmaku spawns from a stale x-position.
- Framegen interpolation is variable-factor: `FrameInterpolationOptions.multiplier`/`targetFps` (extension sets neither → 2×). The model's `runT(t)` takes any `t`; `frame-interpolator.ts` generates N-1 sub-frames per pair. Output is capped at the display refresh rate (rAF), so factors above 2× only help on high-refresh monitors. `resolution` is the model's *processing* size (`480p`/`720p`/`1080p` in both the player and the extension): with interpolation on, every frame — real ones included — is resampled to it before Anime4K runs, so it, not `targetResolution`, is the real detail ceiling. The engine caps the factor per resolution (`computeResolutionFactorCap`, 1080p tops out at 4×).

## Release Workflow

```bash
# Build, package, and release (from repo root)
corepack pnpm -r --filter @mr-quin/danmaku-anywhere... build
corepack pnpm -C packages/danmaku-anywhere package

# Create zip (Windows — PowerShell)
Compress-Archive -Path "packages/danmaku-anywhere/package/*" -DestinationPath "danmaku-anywhere.zip"

# Tag and publish
git tag v1.x.x-perf.N
git push origin v1.x.x-perf.N
gh release create v1.x.x-perf.N danmaku-anywhere.zip --repo 2832599985/danmaku-anywhere-perf --title "vX.X.X" --notes "Release notes"
```

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

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
- DDP comment dedup using `p+m` composite key (`ddp/api.ts`)
- CID preservation as optional field in `CommentEntity`
- MacCMS title mapping support (season/episode persistence for automatic matching)
- Anime4K WebGPU super-resolution (`packages/upscale-engine`, `src/content/player/upscaler/`); integration points are extension options v34-v35, player RPC commands, floating-panel controls, and the optional `anime4k-cors` DNR ruleset
- Optional Framegen 2× video interpolation before Anime4K; extension options v36 stores the 480p/720p preference, model assets live in `public/assets/framegen/`, and unsupported GPUs fall back to Anime4K without disabling super-resolution

## Common Commands

All commands run from repo root (`danmaku-anywhere/`).

```bash
# Install & build (extension and its dependencies)
corepack enable
corepack prepare pnpm@10.11.0 --activate
corepack pnpm -r --filter @mr-quin/danmaku-anywhere... install
corepack pnpm -r --filter @mr-quin/danmaku-anywhere... build

# Test extension
corepack pnpm -C packages/danmaku-anywhere test

# Run single test file
corepack pnpm -C packages/danmaku-anywhere test -- src/path/to/file.test.ts

# Test and type-check the WebGPU upscale engine
corepack pnpm --filter @danmaku-anywhere/upscale-engine test
corepack pnpm --filter @danmaku-anywhere/upscale-engine type-check

# Run the real-browser upscale and package-asset checks
corepack pnpm -C packages/danmaku-anywhere exec playwright test e2e/upscale.spec.ts e2e/package-assets.spec.ts --workers=1

# Package extension (Chrome/Edge) — output: packages/danmaku-anywhere/package/
corepack pnpm -C packages/danmaku-anywhere package

# Lint & format (all packages)
corepack pnpm -r -F "./packages/**" lint
corepack pnpm -r -F "./packages/**" format

# Type check
corepack pnpm -r type-check

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
├── app/web/                # Angular web application
├── backend/                # Cloudflare Workers backend
└── docs/                   # Astro documentation
```

## Extension Architecture

The extension uses a three-layer content script architecture with RPC communication:

```
┌─────────────────────────────────────────────────────────────────┐
│                     Background Service Worker                   │
│  src/background/index.ts                                        │
│  - RpcManager: handles 60+ RPC methods                          │
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
| Background RPC | `src/background/rpc/RpcManager.ts` | 60+ RPC method handlers |
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
| DDP API | `packages/danmaku-provider/src/providers/ddp/api.ts` | DanDanPlay API + dedup |
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

MacCMS uses an in-memory `episodeCache` (Map keyed by `indexedId`). On cache miss, `getEpisodesByIndexedId()` can re-search by title to recover. This handles service worker restarts.

### Data Storage

**Dexie.js** (IndexedDB wrapper) with three databases:
- `danmaku-anywhere`: Main DB — tables: `episode`, `season`, `customEpisode`, `seasonMap` (13 migration versions)
- `danmaku-anywhere-logs`: Logging DB — table: `logs`
- `danmaku-anywhere-image`: Image cache DB — table: `image`

**chrome.storage** (via `ExtStorageService`): Options/config stored in `chrome.storage.local/sync/session`.

### Internationalization

Two-layer i18n:
- **chrome.i18n**: `_locales/{en,zh_CN}/messages.json` for manifest strings (`extName`, `extDescription`)
- **i18next + react-i18next**: `src/common/localization/locales/{en,zh}/translation.json` for UI strings with type-safe `t()` keys

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

**Biome** enforces: 2-space indent, single quotes, no semicolons, trailing commas (ES5), LF endings. Config: `biome.json`. Test files (`**/*.test.ts`) relax `noExplicitAny` and `noEmptyBlockStatements`.

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
- Keep `public/assets/framegen/LICENSE` and `WEIGHTS_LICENSE.md` beside the bundled model. The weights are restricted to personal, non-commercial use.

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

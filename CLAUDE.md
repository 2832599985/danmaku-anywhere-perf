# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Danmaku Anywhere is a monorepo for a browser extension and web app that displays danmaku (bullet comments) on video platforms. Uses pnpm workspaces.

**Repo root:** `danmaku-anywhere/` (relative to this file)

### Fork Info

This is a performance/UX fork (`2832599985/danmaku-anywhere-perf`) of `Mr-Quin/danmaku-anywhere`. Branch: `feat/ui-beautification`.

**Fork-specific features** (preserve during upstream merges):
- Glass/neon UI theme (violet/fuchsia palette, `backdropFilter: blur(12px)`, dark mode only)
- Fixed time skip button (default 90s, `FixedSkip.service.ts`)
- Auto skip OP via danmaku timestamp analysis (`VideoSkip.service.ts`)
- Batch download in season details page (`SeasonDetailsPage.tsx`)
- DDP comment dedup using `p+m` composite key (`ddp/api.ts`)
- CID preservation as optional field in `CommentEntity`

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
│   ├── web-scraper/        # Web scraping utilities
│   └── shared-ui/          # Shared UI components
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

### Key Files

| Area | Path | Purpose |
|------|------|---------|
| Background IoC | `src/background/ioc.ts` | Inversify container, singleton services |
| Background RPC | `src/background/rpc/RpcManager.ts` | 60+ RPC method handlers |
| Controller Entry | `src/content/controller/index.tsx` | React app in Shadow DOM |
| Frame Manager | `src/content/controller/danmaku/frame/FrameManager.tsx` | Multi-frame orchestration |
| Player Entry | `src/content/player/index.ts` | RPC server + service initialization |
| RPC Types | `src/common/rpcClient/background/types.ts` | All RPC method definitions |
| Popover Host | `src/content/common/host/createPopoverRoot.ts` | Shadow DOM + Popover setup |
| Theme | `src/common/theme/Theme.tsx` | Glass/neon theme (fork feature) |
| Fixed Skip | `src/content/player/fixedSkip/FixedSkip.service.ts` | Timed skip button (fork feature) |
| Video Skip | `src/content/player/videoSkip/VideoSkip.service.ts` | Auto OP skip (fork feature) |
| DDP API | `packages/danmaku-provider/src/providers/ddp/api.ts` | DanDanPlay API + dedup |
| Batch Download | `src/popup/pages/search/seasonDetails/SeasonDetailsPage.tsx` | Multi-episode download |

### RPC Communication

- **Background ↔ Content**: `chromeRpcClient` using `chrome.runtime.sendMessage`
- **Controller → Player**: `playerRpcClient.player['relay:command:*']({ frameId, data })`
- **Player → Controller**: `playerRpcClient.controller['relay:event:*']({ frameId })`
- **Streaming**: `chrome.runtime.connect()` ports for large data (danmaku parsing)

### Shadow DOM & Popover

All UI renders in Shadow DOM with `popover="manual"` for top-layer positioning. On fullscreen change, call `hidePopover()` then `showPopover()` to stay on top. Use `textContent` (never `innerHTML`) for injecting styles into shadow style elements.

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

**Biome** enforces: 2-space indent, single quotes, no semicolons, trailing commas (ES5), LF endings. Config: `biome.json`.

**TypeScript**: Strict mode, `import type` for type-only imports, no `any` (use `unknown`).

## Key Patterns

### React Hooks Rules
- All hooks (`useState`, `useMemo`, `useEffect`, etc.) MUST be called before any early returns
- Use `useEventCallback` (from MUI) for event handlers that need fresh closure values without re-triggering effects
- Read Zustand store state with `useStore.getState()` inside callbacks (not from render closure) for freshness

### Inversify Services
- Services use `@injectable('Singleton')` + `@inject()` decorators
- Background services registered in `src/background/ioc.ts`
- Content services use separate IoC containers (`uiContainer`)

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
- Test with Vitest

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

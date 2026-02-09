# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Danmaku Anywhere is a monorepo for a browser extension and web app that displays danmaku (bullet comments) on video platforms.
- **Root**: `danmaku-anywhere/`
- **Package Manager**: pnpm (v10+, managed via corepack)
- **Monorepo**: pnpm workspaces

## Common Commands

All commands should be run from the repo root unless specified.

### Setup & Build
```bash
# Install dependencies
corepack enable
corepack prepare pnpm@10.11.0 --activate
corepack pnpm install

# Build all packages
corepack pnpm -r build

# Build specific package (e.g., extension)
corepack pnpm -F @mr-quin/danmaku-anywhere build
```

### Development Servers
```bash
# Extension (Vite)
corepack pnpm -C packages/danmaku-anywhere dev

# Web App (Angular) - "Danmaku Somewhere"
corepack pnpm -C app/web start
```

### Testing
```bash
# Extension (Vitest)
corepack pnpm -C packages/danmaku-anywhere test
corepack pnpm -C packages/danmaku-anywhere test -- run src/path/to/test.ts

# Web App (Karma/Jasmine)
corepack pnpm -C app/web test:ng
```

### Quality Assurance
```bash
# Lint & Format (Biome)
corepack pnpm -r -F "./packages/**" lint
corepack pnpm -r -F "./packages/**" format

# Type Check
corepack pnpm -r type-check
```

## Project Structure

```
danmaku-anywhere/
├── packages/
│   ├── danmaku-anywhere/   # Browser Extension (React 19, Vite, MUI v7)
│   ├── danmaku-converter/  # Danmaku format conversion utils
│   ├── danmaku-engine/     # Canvas rendering engine
│   ├── danmaku-provider/   # API wrappers (Bilibili, etc.)
│   ├── web-scraper/        # Web scraping utilities
│   └── shared-ui/          # Shared UI components
├── app/web/                # Web App (Angular 21, PrimeNG, Tailwind v4)
├── backend/                # Cloudflare Workers
└── docs/                   # Documentation (Astro)
```

## Architecture & Tech Stack

### Browser Extension (`packages/danmaku-anywhere`)
- **Stack**: React 19, MUI v7, TanStack Query, Zustand, Inversify, Vite.
- **Architecture**: 3-Layer RPC Model.
    1.  **Background**: `src/background/`. Singleton services via Inversify IoC. Handles network & parsing.
    2.  **Controller**: `src/content/controller/`. React app in Shadow DOM (Popover API). UI for settings/search.
    3.  **Player**: `src/content/player/`. Injected per-video-frame. Renders danmaku on canvas.
- **Communication**:
    - `chrome.runtime.sendMessage` for Content ↔ Background.
    - Custom RPC for Controller ↔ Player frames.
- **UI**: Uses Shadow DOM to isolate styles. `popover="manual"` used for z-index management.

### Web App (`app/web`)
- **Stack**: Angular 21, PrimeNG v20, Tailwind CSS v4, Signals.
- **State**: Signal-based state management, TanStack Query (Angular Experimental).
- **Styling**: Tailwind v4 with PrimeNG theming.

## Code Style & Guidelines

- **Linter/Formatter**: **Biome**. 2-space indent, single quotes, no semicolons, trailing commas.
- **TypeScript**: Strict mode enabled. No `any`. Use `import type` for type-only imports.
- **React**:
    - Functional components with Hooks.
    - Services injected via decorators (`@injectable`, `@inject`).
- **Angular**:
    - **Signals** for all state (computed, effects).
    - `ChangeDetectionStrategy.OnPush`.
    - Control flow syntax (`@if`, `@for`) instead of structural directives.
    - No `ngClass`/`ngStyle` - use binding syntax.

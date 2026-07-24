import path from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

// app/player → monorepo packages live at ../../packages
const packages = path.resolve(import.meta.dirname, '../../packages')

const pkg = (p: string) => path.resolve(packages, p)

/**
 * The workspace danmaku packages are consumed as TypeScript SOURCE (no build
 * step). Several of them (danmaku-converter/engine/provider/result) use explicit
 * `.js` specifiers in relative imports that actually point at sibling `.ts`
 * files (TS `moduleResolution: bundler` style). Vite's default resolver looks for
 * a real `.js` file and fails. This pre-resolver rewrites a relative `*.js`
 * import to its `*.ts` twin when that twin exists, otherwise falls through so
 * genuine `.js` assets (node_modules) still resolve normally.
 */
const resolveTsFromJs = (): Plugin => ({
  name: 'da-resolve-ts-from-js',
  enforce: 'pre',
  async resolveId(source, importer, options) {
    if (!importer || !source.startsWith('.') || !source.endsWith('.js')) {
      return null
    }
    const candidate = `${source.slice(0, -3)}.ts`
    const resolved = await this.resolve(candidate, importer, {
      ...options,
      skipSelf: true,
    })
    return resolved ?? null
  },
})

const port = 3060

export default defineConfig({
  plugins: [resolveTsFromJs(), react({})],
  // Prevent Vite from starting on a different port silently in Tauri.
  clearScreen: false,
  resolve: {
    // Array form so subpath entries (…/ddp) match before the package root.
    alias: [
      {
        find: '@danmaku-anywhere/danmaku-provider/ddp',
        replacement: pkg('danmaku-provider/src/providers/ddp/index.ts'),
      },
      {
        find: '@danmaku-anywhere/danmaku-provider',
        replacement: pkg('danmaku-provider/src/index.ts'),
      },
      {
        find: '@danmaku-anywhere/danmaku-converter',
        replacement: pkg('danmaku-converter/src/index.ts'),
      },
      {
        find: '@danmaku-anywhere/danmaku-engine',
        replacement: pkg('danmaku-engine/src/index.ts'),
      },
      {
        find: '@danmaku-anywhere/upscale-engine',
        replacement: pkg('upscale-engine/src/index.ts'),
      },
      {
        find: '@danmaku-anywhere/result',
        replacement: pkg('result/src/index.ts'),
      },
      { find: '@', replacement: path.resolve(import.meta.dirname, 'src') },
    ],
  },
  optimizeDeps: {
    // These are consumed as source; let Vite process their `.ts` directly
    // instead of trying to pre-bundle them as opaque deps.
    exclude: [
      '@danmaku-anywhere/danmaku-converter',
      '@danmaku-anywhere/danmaku-engine',
      '@danmaku-anywhere/danmaku-provider',
      '@danmaku-anywhere/upscale-engine',
      '@danmaku-anywhere/result',
    ],
  },
  server: {
    port,
    strictPort: true,
    // Allow serving the workspace package sources that live above app/player.
    fs: { allow: [path.resolve(import.meta.dirname, '../..')] },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // WebGPU engine + top-level await need a modern target.
    target: 'esnext',
  },
  // Tauri env passthrough (harmless in browser dev).
  envPrefix: ['VITE_', 'TAURI_'],
})

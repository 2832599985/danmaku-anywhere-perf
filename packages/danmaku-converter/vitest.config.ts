import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // Allow benchmarking other workspace sources (e.g. danmaku-engine) that import
      // this package by name, without requiring a full workspace install.
      '@danmaku-anywhere/danmaku-converter': fileURLToPath(
        new URL('./src/index.ts', import.meta.url)
      ),
    },
  },
  test: {},
})

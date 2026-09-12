import path from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    // Mirror vite.config.ts's `@` alias: unit tests import the same modules the
    // app does, so they must resolve `@/…` the same way (`alias` in a separate
    // vitest config is not inherited from vite.config.ts).
    alias: [
      { find: '@', replacement: path.resolve(import.meta.dirname, 'src') },
    ],
  },
  test: {
    // The player's end-to-end suite is Playwright (`e2e/*.spec.ts`); vitest must
    // not try to run it as a unit test.
    include: ['src/**/*.test.ts'],
  },
})

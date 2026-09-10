import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // The player's end-to-end suite is Playwright (`e2e/*.spec.ts`); vitest must
    // not try to run it as a unit test.
    include: ['src/**/*.test.ts'],
  },
})

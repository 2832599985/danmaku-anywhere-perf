import { defineConfig } from '@playwright/test'

// Headed full-Chromium is the proven WebGPU path (mirrors the extension's
// e2e/upscale.spec.ts). The Vite dev server is started automatically.
export default defineConfig({
  testDir: './e2e',
  timeout: 180_000,
  expect: { timeout: 20_000 },
  retries: 0,
  workers: 1,
  reporter: [['list']],
  use: {
    channel: 'chromium',
    headless: false,
    baseURL: 'http://localhost:3060',
    launchOptions: {
      args: [
        '--enable-unsafe-webgpu',
        '--enable-features=Vulkan',
        '--ignore-gpu-blocklist',
      ],
    },
  },
  webServer: {
    // Serve the prebuilt dist/ with a correct static server (run `pnpm build`
    // first). A direct child process Playwright can reliably kill — avoids the
    // orphaned `vite preview` zombies and the build-window poll race.
    command: 'node e2e/serve-dist.mjs',
    url: 'http://localhost:3060',
    reuseExistingServer: false,
    timeout: 60_000,
  },
})

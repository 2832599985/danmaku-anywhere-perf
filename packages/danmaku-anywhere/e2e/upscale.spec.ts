import { expect, test } from './fixtures'

test('player settings exposes a single inline Anime4K control surface', async ({
  extensionId,
  page,
}) => {
  await page.goto(
    `chrome-extension://${extensionId}/pages/dashboard.html#/options/player`
  )
  await expect(page.getByText(/Anime4K/)).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'A', exact: true })
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: '2×', exact: true })
  ).toBeVisible()
  await expect(
    page.getByTestId('upscale-settings').getByRole('combobox')
  ).toHaveCount(0)
})

test('upscale defaults are persisted and the CORS ruleset is disabled', async ({
  context,
}) => {
  const worker =
    context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'))

  await expect
    .poll(async () => {
      return worker.evaluate(async () => {
        const stored = await chrome.storage.sync.get('extensionOptions')
        return stored.extensionOptions?.data?.playerOptions?.upscale
      })
    })
    .toEqual({
      enabled: false,
      modeId: 'builtin-mode-a',
      performanceTier: 'balanced',
      targetResolution: 'x2',
      enableCrossOriginFix: false,
    })

  const enabledRulesets = await worker.evaluate(() =>
    chrome.declarativeNetRequest.getEnabledRulesets()
  )
  expect(enabledRulesets).not.toContain('anime4k-cors')
})

test('changing the CORS option updates the static ruleset', async ({
  context,
}) => {
  const worker =
    context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'))

  await expect
    .poll(() =>
      worker.evaluate(async () => {
        const stored = await chrome.storage.sync.get('extensionOptions')
        return Boolean(stored.extensionOptions?.data)
      })
    )
    .toBe(true)

  await worker.evaluate(async () => {
    const stored = await chrome.storage.sync.get('extensionOptions')
    const extensionOptions = stored.extensionOptions
    await chrome.storage.sync.set({
      extensionOptions: {
        ...extensionOptions,
        data: {
          ...extensionOptions.data,
          playerOptions: {
            ...extensionOptions.data.playerOptions,
            upscale: {
              ...extensionOptions.data.playerOptions.upscale,
              enableCrossOriginFix: true,
            },
          },
        },
      },
    })
  })

  await expect
    .poll(() =>
      worker.evaluate(() => chrome.declarativeNetRequest.getEnabledRulesets())
    )
    .toContain('anime4k-cors')
})

test('renders an Anime4K canvas while keeping the player popover above it', async ({
  context,
  page,
}) => {
  test.setTimeout(120_000)
  const worker =
    context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'))

  // Wait for the background to persist default options before touching storage
  await expect
    .poll(() =>
      worker.evaluate(async () => {
        const stored = await chrome.storage.sync.get('extensionOptions')
        return Boolean(stored.extensionOptions?.data)
      })
    )
    .toBe(true)

  // Content scripts are only registered for sites with an enabled mount
  // config, so seed one for the test page
  await worker.evaluate(async () => {
    const stored = await chrome.storage.sync.get('mountConfig')
    const wrapper = stored.mountConfig ?? { version: 6, data: [] }
    wrapper.data = [
      {
        id: crypto.randomUUID(),
        name: 'e2e-upscale',
        patterns: ['https://example.com/*'],
        mediaQuery: 'video',
        enabled: true,
        mode: 'manual',
        preferredProviders: [],
      },
    ]
    await chrome.storage.sync.set({ mountConfig: wrapper })
  })
  await expect
    .poll(() =>
      worker.evaluate(async () => {
        const scripts = await chrome.scripting.getRegisteredContentScripts()
        return scripts.flatMap((script) => script.matches ?? [])
      })
    )
    .toContain('https://example.com/*')

  await page.goto('https://example.com')
  const hasGpuAdapter = await page.evaluate(async () => {
    if (!('gpu' in navigator) || !navigator.gpu) return false
    try {
      return Boolean(await navigator.gpu.requestAdapter())
    } catch {
      return false
    }
  })
  test.skip(!hasGpuAdapter, 'WebGPU adapter is unavailable in this environment')

  await page.evaluate(() => {
    const video = document.createElement('video')
    video.muted = true
    video.autoplay = true
    video.controls = true
    video.crossOrigin = 'anonymous'
    video.src =
      'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4'
    document.body.appendChild(video)
  })
  await page.locator('video').waitFor({ state: 'attached' })
  await page.locator('#danmaku-anywhere-player').waitFor({
    state: 'attached',
    timeout: 30_000,
  })

  await worker.evaluate(async () => {
    const stored = await chrome.storage.sync.get('extensionOptions')
    const extensionOptions = stored.extensionOptions
    await chrome.storage.sync.set({
      extensionOptions: {
        ...extensionOptions,
        data: {
          ...extensionOptions.data,
          playerOptions: {
            ...extensionOptions.data.playerOptions,
            upscale: {
              ...extensionOptions.data.playerOptions.upscale,
              enabled: true,
              modeId: 'builtin-mode-a',
              targetResolution: 'x2',
              enableCrossOriginFix: true,
            },
          },
        },
      },
    })
  })

  const canvas = page.locator('canvas[data-danmaku-anywhere-upscale="true"]')
  await expect(canvas).toBeVisible({ timeout: 60_000 })
  const state = await page.evaluate(() => {
    const video = document.querySelector('video')
    const upscaleCanvas = document.querySelector<HTMLCanvasElement>(
      'canvas[data-danmaku-anywhere-upscale="true"]'
    )
    const playerRoot = document.querySelector('#danmaku-anywhere-player')
    return {
      videoOpacity: video?.style.opacity,
      videoWidth: video?.videoWidth,
      videoHeight: video?.videoHeight,
      canvasWidth: upscaleCanvas?.width,
      canvasHeight: upscaleCanvas?.height,
      playerPopoverOpen: playerRoot?.matches(':popover-open'),
      canvasPopoverOpen: upscaleCanvas?.matches(':popover-open'),
    }
  })
  expect(state.videoOpacity).toBe('0')
  expect(state.canvasWidth).toBe((state.videoWidth ?? 0) * 2)
  expect(state.canvasHeight).toBe((state.videoHeight ?? 0) * 2)
  expect(state.playerPopoverOpen).toBe(true)
  expect(state.canvasPopoverOpen).toBe(false)
})

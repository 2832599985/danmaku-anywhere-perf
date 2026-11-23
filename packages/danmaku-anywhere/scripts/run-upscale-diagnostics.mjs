import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { chromium } from '@playwright/test'

const extensionPath = path.resolve('build')
const profilePath = await fs.mkdtemp(path.join(os.tmpdir(), 'da-upscale-'))
const proxy = process.env.DA_DIAGNOSTICS_PROXY ?? 'socks5://127.0.0.1:10808'
const browserChannel = process.env.DA_DIAGNOSTICS_CHANNEL ?? 'chromium'
const cases = [
  {
    name: 'full-16f',
    query: 'daUpscaleMode=full&daUpscalePresentation=rvfc',
  },
  {
    name: 'full-16f-raf',
    query: 'daUpscaleMode=full&daUpscalePresentation=raf',
  },
  {
    name: 'full-16f-early',
    query: 'daUpscaleMode=full&daUpscaleEarly=1&daUpscalePresentation=rvfc',
  },
  {
    name: 'copy-16f',
    query: 'daUpscaleMode=copy-only&daUpscalePresentation=rvfc',
  },
  {
    name: 'copy-8',
    query:
      'daUpscaleMode=copy-only&daUpscaleFormat=rgba8unorm&daUpscalePresentation=rvfc',
  },
  {
    name: 'canvas-only',
    query: 'daUpscaleMode=canvas-only&daUpscalePresentation=rvfc',
  },
  {
    name: 'freeze-input',
    query: 'daUpscaleMode=freeze-input&daUpscalePresentation=rvfc',
  },
  { name: 'hidden-canvas', query: 'daUpscaleMode=full&daUpscaleView=video' },
]

const average = (values, key) =>
  values.reduce((sum, value) => sum + Number(value[key] ?? 0), 0) /
  Math.max(1, values.length)

const maximum = (values, key) =>
  Math.max(...values.map((value) => Number(value[key] ?? 0)))

const summarize = (name, samples) => ({
  name,
  samples: samples.length,
  frames: samples.reduce((sum, value) => sum + value.frames, 0),
  presentedFrameGaps: samples.reduce(
    (sum, value) => sum + value.presentedFrameGaps,
    0
  ),
  rendererBusyDrops: samples.reduce(
    (sum, value) => sum + value.rendererBusyDrops,
    0
  ),
  lateCallbacks: samples.reduce((sum, value) => sum + value.lateCallbacks, 0),
  avgHeadroomMs: average(samples, 'averageHeadroomMs'),
  minHeadroomMs: Math.min(
    ...samples.map((value) => Number(value.minimumHeadroomMs))
  ),
  avgCallbackDeltaMs: average(samples, 'averageCallbackDeltaMs'),
  maxCallbackDeltaMs: maximum(samples, 'maximumCallbackDeltaMs'),
  avgCopyCallMs: average(samples, 'averageCopyCallMs'),
  maxCopyCallMs: maximum(samples, 'maximumCopyCallMs'),
  avgEncodeMs: average(samples, 'averageEncodeMs'),
  maxEncodeMs: maximum(samples, 'maximumEncodeMs'),
  avgSubmitMs: average(samples, 'averageSubmitMs'),
  maxSubmitMs: maximum(samples, 'maximumSubmitMs'),
  avgCpuFrameMs: average(samples, 'averageCpuFrameMs'),
  maxCpuFrameMs: maximum(samples, 'maximumCpuFrameMs'),
  maxQueueDrainMs: maximum(samples, 'latestQueueDrainMs'),
  finalVideoDroppedFrames: samples.at(-1)?.videoDroppedFrames ?? 0,
  finalVideoTotalFrames: samples.at(-1)?.videoTotalFrames ?? 0,
})

const context = await chromium.launchPersistentContext(profilePath, {
  channel: browserChannel,
  headless: false,
  viewport: { width: 1280, height: 720 },
  args: [
    `--disable-extensions-except=${extensionPath}`,
    `--load-extension=${extensionPath}`,
    `--proxy-server=${proxy}`,
    '--autoplay-policy=no-user-gesture-required',
    '--disable-features=DisableLoadExtensionCommandLineSwitch',
  ],
})

try {
  const worker =
    context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'))
  await worker.evaluate(async () => {
    const stored = await chrome.storage.sync.get('mountConfig')
    const wrapper = stored.mountConfig ?? { version: 6, data: [] }
    wrapper.data = [
      {
        id: crypto.randomUUID(),
        name: 'upscale-diagnostics',
        patterns: ['https://example.com/*'],
        mediaQuery: 'video',
        enabled: true,
        mode: 'manual',
        preferredProviders: [],
      },
    ]
    await chrome.storage.sync.set({ mountConfig: wrapper })
  })

  const results = []
  for (const diagnosticCase of cases) {
    const page = await context.newPage()
    await page.goto(`https://example.com/?${diagnosticCase.query}`)
    const hasWebGpu = await page.evaluate(async () => {
      if (!navigator.gpu) return false
      return Boolean(await navigator.gpu.requestAdapter())
    })
    if (!hasWebGpu) throw new Error('Hardware WebGPU adapter is unavailable')

    await page.evaluate(() => {
      document.body.innerHTML = ''
      const video = document.createElement('video')
      video.muted = true
      video.autoplay = true
      video.loop = true
      video.crossOrigin = 'anonymous'
      video.style.width = '960px'
      video.style.height = '540px'
      video.src =
        'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4'
      document.body.appendChild(video)
    })

    await worker.evaluate(async () => {
      const stored = await chrome.storage.sync.get('extensionOptions')
      const extensionOptions = stored.extensionOptions
      const upscale = extensionOptions.data.playerOptions.upscale
      await chrome.storage.sync.set({
        extensionOptions: {
          ...extensionOptions,
          data: {
            ...extensionOptions.data,
            playerOptions: {
              ...extensionOptions.data.playerOptions,
              upscale: { ...upscale, enabled: false },
            },
          },
        },
      })
      await new Promise((resolve) => setTimeout(resolve, 100))
      await chrome.storage.sync.set({
        extensionOptions: {
          ...extensionOptions,
          data: {
            ...extensionOptions.data,
            playerOptions: {
              ...extensionOptions.data.playerOptions,
              upscale: {
                ...upscale,
                enabled: true,
                modeId: 'builtin-mode-a',
                performanceTier: 'balanced',
                targetResolution: '1080p',
                enableCrossOriginFix: true,
              },
            },
          },
        },
      })
    })

    const canvasSelector = 'canvas[data-danmaku-anywhere-upscale="true"]'
    await page.waitForSelector(canvasSelector, {
      state: 'attached',
      timeout: 60_000,
    })
    const samples = []
    let lastValue = ''
    const deadline = Date.now() + 8_000
    while (Date.now() < deadline) {
      await page.waitForTimeout(250)
      const value = await page.$eval(
        canvasSelector,
        (canvas) => canvas.dataset.danmakuAnywhereUpscaleDiagnostics ?? ''
      )
      if (value && value !== lastValue) {
        samples.push(JSON.parse(value))
        lastValue = value
      }
    }
    if (samples.length === 0) {
      throw new Error(`${diagnosticCase.name}: no diagnostic samples`)
    }
    results.push(summarize(diagnosticCase.name, samples))
    await page.close()
  }

  process.stdout.write(`${JSON.stringify(results, null, 2)}\n`)
} finally {
  await context.close()
  await fs.rm(profilePath, { recursive: true, force: true })
}

import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { chromium } from '@playwright/test'

const extensionPath = path.resolve('build')
const profilePath = await fs.mkdtemp(path.join(os.tmpdir(), 'da-upscale-cast-'))
const proxy = process.env.DA_DIAGNOSTICS_PROXY ?? 'socks5://127.0.0.1:10808'
const browserChannel = process.env.DA_DIAGNOSTICS_CHANNEL ?? 'chromium'
const durationMs = Number(process.env.DA_DIAGNOSTICS_DURATION_MS ?? 10_000)
const cases = [
  { name: 'native', enabled: false, query: '' },
  {
    name: 'rvfc',
    enabled: true,
    query: 'daUpscaleMode=full&daUpscalePresentation=rvfc',
  },
  {
    name: 'rvfc-copy-only',
    enabled: true,
    query: 'daUpscaleMode=copy-only&daUpscalePresentation=rvfc',
  },
  {
    name: 'rvfc-canvas-only',
    enabled: true,
    query: 'daUpscaleMode=canvas-only&daUpscalePresentation=rvfc',
  },
  {
    name: 'production-default',
    enabled: true,
    query: '',
  },
  {
    name: 'native-with-gpu',
    enabled: true,
    query: 'daUpscaleMode=full&daUpscaleView=video',
  },
]

const percentile = (sorted, ratio) => {
  if (sorted.length === 0) return 0
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))]
}

const summarizeIntervals = (timestamps) => {
  const intervals = timestamps
    .slice(1)
    .map((timestamp, index) => (timestamp - timestamps[index]) * 1000)
    .filter((value) => value > 0)
    .sort((a, b) => a - b)
  const median = percentile(intervals, 0.5)
  return {
    frames: timestamps.length,
    medianMs: median,
    p95Ms: percentile(intervals, 0.95),
    maximumMs: intervals.at(-1) ?? 0,
    gapsOver1_5x: intervals.filter((value) => value > median * 1.5).length,
    gapsOver2_5x: intervals.filter((value) => value > median * 2.5).length,
  }
}

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
        name: 'upscale-screencast',
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
  for (const testCase of cases) {
    const page = await context.newPage()
    await page.goto(
      `https://example.com/${testCase.query ? `?${testCase.query}` : ''}`
    )
    await page.evaluate(() => {
      document.body.innerHTML = ''
      document.body.style.margin = '0'
      document.body.style.background = 'black'
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

    await worker.evaluate(async (enabled) => {
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
              upscale: {
                ...upscale,
                enabled,
                modeId: 'builtin-mode-a',
                performanceTier: 'balanced',
                targetResolution: '1080p',
                enableCrossOriginFix: true,
              },
            },
          },
        },
      })
    }, testCase.enabled)

    await page.waitForFunction(
      () => {
        const video = document.querySelector('video')
        return Boolean(
          video && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
        )
      },
      undefined,
      { timeout: 60_000 }
    )
    if (testCase.enabled) {
      await page.waitForSelector(
        'canvas[data-danmaku-anywhere-upscale="true"]',
        { state: 'attached', timeout: 60_000 }
      )
    }
    await page.bringToFront()
    await page.waitForTimeout(2_000)

    const cdp = await context.newCDPSession(page)
    const emittedTimestamps = []
    const changedTimestamps = []
    let previousHash = ''
    cdp.on('Page.screencastFrame', async (event) => {
      const timestamp = event.metadata.timestamp
      emittedTimestamps.push(timestamp)
      const hash = crypto.createHash('sha1').update(event.data).digest('hex')
      if (hash !== previousHash) {
        changedTimestamps.push(timestamp)
        previousHash = hash
      }
      await cdp.send('Page.screencastFrameAck', {
        sessionId: event.sessionId,
      })
    })
    await cdp.send('Page.startScreencast', {
      format: 'jpeg',
      quality: 60,
      maxWidth: 960,
      maxHeight: 540,
      everyNthFrame: 1,
    })
    await page.waitForTimeout(durationMs)
    await cdp.send('Page.stopScreencast')

    const playback = await page.evaluate(() => {
      const video = document.querySelector('video')
      const quality = video?.getVideoPlaybackQuality()
      return {
        currentTime: video?.currentTime ?? 0,
        totalVideoFrames: quality?.totalVideoFrames ?? 0,
        droppedVideoFrames: quality?.droppedVideoFrames ?? 0,
      }
    })
    results.push({
      name: testCase.name,
      emitted: summarizeIntervals(emittedTimestamps),
      changed: summarizeIntervals(changedTimestamps),
      playback,
    })
    await page.close()
  }

  process.stdout.write(`${JSON.stringify(results, null, 2)}\n`)
} finally {
  await context.close()
  await fs.rm(profilePath, { recursive: true, force: true })
}

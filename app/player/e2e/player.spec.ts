import { readFileSync } from 'node:fs'
import path from 'node:path'
import { expect, test } from '@playwright/test'

const videoBase64 = readFileSync(
  path.join(import.meta.dirname, 'fixtures/test.mp4')
).toString('base64')

// Sample danmaku spanning the first seconds of the clip (rtl scrolling, white).
const SAMPLE_COMMENTS = [
  { p: '0.3,1,16777215', m: '第一条弹幕' },
  { p: '0.6,1,16711680', m: 'hello world' },
  { p: '1.0,1,65280', m: '超分测试' },
  { p: '1.4,5,16777215', m: '顶部弹幕' },
  { p: '1.8,1,16776960', m: '补帧 60fps' },
  { p: '2.2,1,16777215', m: 'テスト' },
  { p: '2.6,4,16711935', m: '底部弹幕' },
  { p: '3.0,1,16777215', m: '最后一条' },
]

test('local player: video, danmaku, keyboard controls, upscale + interpolation', async ({
  page,
}) => {
  const consoleErrors: string[] = []
  const allConsole: string[] = []
  page.on('console', (msg) => {
    const text = msg.text()
    allConsole.push(`${msg.type()}: ${text}`)
    if (/framegen|interpolat|webgpu|anime4k/i.test(text)) {
      console.log(`[browser ${msg.type()}] ${text}`)
    }
    if (msg.type() === 'error') consoleErrors.push(text)
  })
  page.on('pageerror', (err) => consoleErrors.push(err.message))

  await page.goto('/')
  await page.waitForFunction(
    () => !!(window as unknown as { __player?: unknown }).__player,
    undefined,
    { timeout: 30_000 }
  )

  // --- 1a: load a local video file (blob URL = CORS-clean, like Tauri stream) ---
  await page.evaluate((b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
    const url = URL.createObjectURL(new Blob([bytes], { type: 'video/mp4' }))
    const w = window as unknown as {
      __player: { store: { getState: () => any } }
    }
    w.__player.store.getState().setMedia({ url, name: 'test.mp4' })
  }, videoBase64)

  const readVideo = () =>
    page.evaluate(() => {
      const v = document.querySelector('video') as HTMLVideoElement | null
      return v
        ? {
            w: v.videoWidth,
            h: v.videoHeight,
            duration: v.duration,
            currentTime: v.currentTime,
            volume: v.volume,
            muted: v.muted,
            paused: v.paused,
            opacity: v.style.opacity,
          }
        : null
    })

  await expect
    .poll(async () => (await readVideo())?.w ?? 0, { timeout: 20_000 })
    .toBe(640)
  const meta = await readVideo()
  expect(meta?.h).toBe(360)
  expect(meta?.duration).toBeGreaterThan(9)

  // --- play ---
  await page.evaluate(() => (window as any).__player.commands.play())
  await expect
    .poll(async () => (await readVideo())?.currentTime ?? 0, {
      timeout: 10_000,
    })
    .toBeGreaterThan(0.1)

  // --- 1b: danmaku mounting ---
  await page.evaluate((comments) => {
    ;(window as any).__player.store
      .getState()
      .setComments(comments, { label: 'e2e', count: comments.length })
  }, SAMPLE_COMMENTS)

  await expect(page.locator('.da-danmaku').first()).toBeVisible({
    timeout: 15_000,
  })
  const danmakuCount = await page.locator('.da-danmaku').count()
  expect(danmakuCount).toBeGreaterThan(0)

  // --- 2a/2c: volume via ArrowUp/ArrowDown ---
  await page.evaluate(() => (window as any).__player.commands.setVolume(0.5))
  const pressKey = (key: string) =>
    page.evaluate(
      (k) =>
        window.dispatchEvent(
          new KeyboardEvent('keydown', {
            key: k,
            bubbles: true,
            cancelable: true,
          })
        ),
      key
    )

  await pressKey('ArrowDown')
  await expect
    .poll(async () => (await readVideo())?.volume ?? 1)
    .toBeLessThan(0.5)
  const afterDown = (await readVideo())?.volume ?? 0
  await pressKey('ArrowUp')
  await expect
    .poll(async () => (await readVideo())?.volume ?? 0)
    .toBeGreaterThan(afterDown)

  // --- 2b: seek via ArrowLeft/ArrowRight (step = 1s, paused for determinism) ---
  await page.evaluate(() => {
    const s = (window as any).__player.store.getState()
    s.updatePlaybackSettings({ seekStepSec: 1 })
    ;(window as any).__player.commands.pause()
    ;(window as any).__player.commands.seekTo(3)
  })
  await expect
    .poll(async () => (await readVideo())?.currentTime ?? 0)
    .toBeGreaterThan(2.5)

  await pressKey('ArrowRight')
  await expect
    .poll(async () => (await readVideo())?.currentTime ?? 0)
    .toBeGreaterThan(3.6)
  await pressKey('ArrowLeft')
  await expect
    .poll(async () => (await readVideo())?.currentTime ?? 0)
    .toBeLessThan(3.6)

  // resume playback for the GPU tests (video must be a live texture source)
  await page.evaluate(() => (window as any).__player.commands.play())

  // --- 1c/1d: upscale + interpolation (WebGPU) ---
  const gpu = await page.evaluate(async () => {
    const nav = navigator as any
    if (!nav.gpu) return { adapter: false, shaderF16: false }
    try {
      const adapter = await nav.gpu.requestAdapter()
      return {
        adapter: !!adapter,
        shaderF16: !!adapter?.features?.has('shader-f16'),
      }
    } catch {
      return { adapter: false, shaderF16: false }
    }
  })
  console.log('[e2e] WebGPU:', JSON.stringify(gpu))

  if (gpu.adapter) {
    await page.evaluate(() => {
      ;(window as any).__player.store.getState().updateUpscale({
        enabled: true,
        modeId: 'builtin-mode-a',
        targetResolution: 'x2',
        frameInterpolation: { enabled: true, resolution: '480p' },
      })
    })

    const canvas = page.locator('canvas[data-danmaku-anywhere-upscale="true"]')
    await expect(canvas).toBeVisible({ timeout: 60_000 })

    // original <video> hidden behind the upscaled canvas
    await expect
      .poll(async () => (await readVideo())?.opacity, { timeout: 60_000 })
      .toBe('0')

    // canvas buffer == 2x source (640x360 -> 1280x720), unless display-clamped
    const size = await canvas.evaluate((el) => ({
      w: (el as HTMLCanvasElement).width,
      h: (el as HTMLCanvasElement).height,
    }))
    expect(size.w).toBeGreaterThan(640)
    expect(size.h).toBeGreaterThan(360)

    // Frame interpolation must ENGAGE. With shader-f16 (this GPU) and a valid
    // Framegen manifest it goes 'active' and generates midpoint frames; without
    // shader-f16 it degrades to 'fallback' (Anime4K continues). 'off'/absent
    // would mean the subsystem never ran.
    await expect
      .poll(
        async () =>
          await canvas.getAttribute(
            'data-danmaku-anywhere-frame-interpolation'
          ),
        { timeout: 60_000 }
      )
      .not.toBe(null)
    const interp = await canvas.getAttribute(
      'data-danmaku-anywhere-frame-interpolation'
    )
    console.log(`[e2e] frame-interpolation attribute: ${interp}`)
    if (interp !== 'active') {
      console.log(
        '[e2e] framegen console lines:\n' +
          allConsole.filter((l) => /framegen|interpolat/i.test(l)).join('\n')
      )
    }
    expect(['active', 'fallback']).toContain(interp)
    if (gpu.shaderF16) {
      expect(
        interp,
        'shader-f16 present → interpolation should be active'
      ).toBe('active')
    }

    if (interp === 'active') {
      // real generated (interpolated) frames prove the model is running
      await expect
        .poll(
          async () =>
            (await canvas.getAttribute(
              'data-danmaku-anywhere-frame-interpolation-generated'
            )) ?? '',
          { timeout: 60_000 }
        )
        .toMatch(/^[1-9]\d*$/)
    }
  } else {
    test.info().annotations.push({
      type: 'warning',
      description:
        'WebGPU adapter unavailable — skipped upscale/interpolation asserts',
    })
  }

  // No uncaught errors during the whole run (ignore benign resource noise).
  const fatal = consoleErrors.filter(
    (e) => !/favicon|ERR_|Failed to load resource/i.test(e)
  )
  expect(fatal, `console errors:\n${fatal.join('\n')}`).toEqual([])
})

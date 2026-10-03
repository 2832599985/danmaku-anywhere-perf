import { readFileSync } from 'node:fs'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import type { PlayerCommands } from '../src/player/commands'
import type { usePlayerStore } from '../src/store/playerStore'

type PlayerWindow = Window & {
  __player: { commands: PlayerCommands; store: typeof usePlayerStore }
}

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
  // A real key press is keydown + keyup. The right-arrow seek now fires on
  // keyup (so a hold can be distinguished from a tap), so a faithful press
  // must dispatch both.
  const pressKey = (key: string) =>
    page.evaluate((k) => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: k,
          bubbles: true,
          cancelable: true,
        })
      )
      window.dispatchEvent(
        new KeyboardEvent('keyup', { key: k, bubbles: true, cancelable: true })
      )
    }, key)
  // Simulate a long press: an auto-repeated keydown (repeat:true) then release.
  const holdKey = (key: string) =>
    page.evaluate((k) => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: k,
          repeat: true,
          bubbles: true,
          cancelable: true,
        })
      )
    }, key)
  const releaseKey = (key: string) =>
    page.evaluate((k) => {
      window.dispatchEvent(
        new KeyboardEvent('keyup', { key: k, bubbles: true, cancelable: true })
      )
    }, key)
  const readRate = () =>
    page.evaluate(() => {
      const v = document.querySelector('video') as HTMLVideoElement | null
      return v ? v.playbackRate : null
    })

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

  // --- 2d: hold right arrow = temporary speed, release restores global rate ---
  // Set a NON-default global rate (1.5×) so we can prove the release restores
  // the *global* rate, not 1×. The video stays paused here, which also lets us
  // assert that a hold does NOT seek (currentTime is frozen while paused).
  await page.evaluate(() =>
    (window as any).__player.commands.setPlaybackRate(1.5)
  )
  await expect.poll(readRate, { timeout: 5_000 }).toBe(1.5)
  const tBeforeHold = (await readVideo())?.currentTime ?? 0

  await holdKey('ArrowRight')
  // the held (temporary) rate engages
  await expect.poll(readRate, { timeout: 5_000 }).toBe(3)
  // a hold must not seek — paused, so currentTime stays put
  expect(
    Math.abs(((await readVideo())?.currentTime ?? 0) - tBeforeHold)
  ).toBeLessThan(0.1)

  await releaseKey('ArrowRight')
  // releasing restores the GLOBAL rate (1.5), not 1×
  await expect.poll(readRate, { timeout: 5_000 }).toBe(1.5)

  // a plain tap still seeks and does NOT touch the rate
  await pressKey('ArrowRight')
  await expect.poll(readRate, { timeout: 5_000 }).toBe(1.5)
  await expect
    .poll(async () => (await readVideo())?.currentTime ?? 0)
    .toBeGreaterThan(tBeforeHold + 0.5)

  // restore the default rate so the GPU tests below aren't run at 1.5×
  await page.evaluate(() =>
    (window as any).__player.commands.setPlaybackRate(1)
  )

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

test.use({ headless: process.env.PLAYER_HEADLESS === '1' })

test.describe('quick panels and settings navigation', () => {
  test.use({ viewport: { width: 1280, height: 800 } })

  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.waitForFunction(() => !!(window as PlayerWindow).__player)
    await page.evaluate((b64) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
      ;(window as PlayerWindow).__player.commands.openVideoFromFile(
        new File([bytes], 'test.mp4', { type: 'video/mp4' })
      )
    }, videoBase64)
    await page.waitForFunction(() => {
      const video = document.querySelector('video')
      return video && video.readyState >= 2
    })
    await page.evaluate(() =>
      (window as PlayerWindow).__player.commands.pause()
    )
  })

  test('subtitle file, visibility, live slider and full settings share state', async ({
    page,
  }) => {
    await page.getByRole('button', { name: '选择字幕', exact: true }).click()
    const panel = page.locator('[data-quick-panel="subtitle"]')
    await expect(panel).toBeVisible()
    await expect(panel.getByRole('button', { name: '移除字幕' })).toBeDisabled()

    const picker = page.waitForEvent('filechooser')
    await panel.getByRole('button', { name: '加载字幕文件…' }).click()
    await (await picker).setFiles({
      name: 'sample.srt',
      mimeType: 'text/plain',
      buffer: Buffer.from('1\n00:00:00,000 --> 00:00:10,000\n字幕测试\n'),
    })
    await expect(panel.getByText(/当前 · sample.srt/)).toBeVisible()
    const slider = panel.getByRole('slider', { name: '字号', exact: true })
    await slider.focus()
    await page.keyboard.press('ArrowRight')
    await expect(slider).toHaveAttribute('aria-valuenow', '32')
    await expect
      .poll(() =>
        page.evaluate(() => document.querySelector('video')?.currentTime ?? 0)
      )
      .toBeLessThan(1)
    await panel.getByRole('switch', { name: '显示字幕' }).click()
    await expect(
      panel.getByRole('switch', { name: '显示字幕' })
    ).toHaveAttribute('aria-checked', 'false')
    await page.keyboard.press('Escape')
    await expect(panel).not.toBeVisible()
    await page
      .getByRole('button', { name: '显示字幕 (S)', exact: true })
      .click()
    await expect(
      page.getByRole('button', { name: '隐藏字幕 (S)', exact: true })
    ).toHaveAttribute('aria-pressed', 'true')

    await page.getByRole('button', { name: '字幕快捷设置' }).click()
    await panel.getByRole('button', { name: '更多设置 →' }).click()
    await expect(panel).not.toBeVisible()
    const settings = page.locator('[data-settings-page]')
    await expect(
      settings.getByRole('button', { name: '字幕', exact: true })
    ).toHaveAttribute('aria-current', 'page')
    await expect(
      settings.getByRole('slider', { name: '字号', exact: true })
    ).toHaveAttribute('aria-valuenow', '32')
    await settings.getByRole('button', { name: '移除字幕' }).click()
    await expect(
      settings.getByText('当前没有字幕', { exact: true })
    ).toBeVisible()
    await settings.getByRole('button', { name: '返回播放' }).click()
    await expect(panel).not.toBeVisible()
    await expect(
      page.getByRole('button', { name: '选择字幕', exact: true })
    ).toBeVisible()
  })

  test('settings land on playback, group matching under danmaku and reset scroll', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 880, height: 560 })
    await page.getByRole('button', { name: '設 设置' }).click()
    const settings = page.locator('[data-settings-page]')
    await expect(
      settings.getByRole('button', { name: '播放', exact: true })
    ).toHaveAttribute('aria-current', 'page')
    await expect(settings.getByText('快进步长', { exact: true })).toBeVisible()
    await settings.getByRole('button', { name: '快捷键', exact: true }).click()
    await expect(settings.getByText('快进步长', { exact: true })).toHaveCount(0)
    await settings.getByRole('button', { name: '弹幕', exact: true }).click()
    await expect(
      settings.getByText('记住文件名格式', { exact: true })
    ).toHaveCount(1)
    const content = page.locator('[data-settings-content]')
    await content.evaluate((el) => {
      el.scrollTop = el.scrollHeight
    })
    await expect
      .poll(() => content.evaluate((el) => el.scrollTop))
      .toBeGreaterThan(0)
    await settings.getByRole('button', { name: '字幕', exact: true }).click()
    await expect.poll(() => content.evaluate((el) => el.scrollTop)).toBe(0)
    await expect(settings.getByText('来源', { exact: true })).toBeVisible()
    for (const name of ['播放', '弹幕', '字幕', '画质增强', '快捷键']) {
      await settings.getByRole('button', { name, exact: true }).click()
      expect(
        await content.evaluate((el) => el.scrollWidth - el.clientWidth),
        name
      ).toBeLessThanOrEqual(1)
    }
    await page.screenshot({ path: test.info().outputPath('settings-880.png') })
  })

  test('quick panels fit the minimum window and stay inside fullscreen', async ({
    page,
  }) => {
    for (const size of [
      { width: 880, height: 560 },
      { width: 1280, height: 800 },
    ]) {
      await page.setViewportSize(size)
      const buttons = page.locator('[data-controls-bar] button')
      const bounds = await buttons.evaluateAll((items) =>
        items.map((el) => {
          const r = el.getBoundingClientRect()
          return {
            text: el.getAttribute('aria-label') ?? el.textContent,
            left: r.left,
            right: r.right,
          }
        })
      )
      expect(bounds.filter((r) => r.left < 0 || r.right > size.width)).toEqual(
        []
      )
      for (const label of ['画质', '弹幕', '字幕']) {
        await page.getByRole('button', { name: `${label}快捷设置` }).click()
        const panel = page.locator('[data-quick-panel]')
        await expect(panel).toBeVisible()
        await expect(panel).toHaveCSS('opacity', '1')
        const rect = await panel.boundingBox()
        expect(rect).not.toBeNull()
        if (rect) {
          expect(rect.x).toBeGreaterThanOrEqual(0)
          expect(rect.y).toBeGreaterThanOrEqual(0)
          expect(rect.x + rect.width).toBeLessThanOrEqual(size.width)
          expect(rect.y + rect.height).toBeLessThanOrEqual(size.height)
        }
        if (label === '画质') {
          await expect(
            panel.getByRole('button', { name: '快速', exact: true })
          ).toBeDisabled()
          await expect(
            panel.getByRole('switch', { name: '补帧', exact: true })
          ).toBeDisabled()
        }
        await page.screenshot({
          path: test.info().outputPath(`quick-${label}-${size.width}.png`),
        })
        await page.keyboard.press('Escape')
        await expect(panel).not.toBeVisible()
      }
    }
    await page
      .getByRole('button', { name: '全屏 / Fullscreen', exact: true })
      .click()
    await expect
      .poll(() => page.evaluate(() => !!document.fullscreenElement))
      .toBe(true)
    await page.getByRole('button', { name: '字幕快捷设置' }).click()
    const panel = page.locator('[data-quick-panel="subtitle"]')
    await expect(panel).toBeVisible()
    await expect(panel).toHaveCSS('opacity', '1')
    expect(
      await panel.evaluate((el) => document.fullscreenElement?.contains(el))
    ).toBe(true)
    expect(
      await panel.evaluate((el) => {
        const r = el.getBoundingClientRect()
        const top = document.elementFromPoint(
          r.x + r.width / 2,
          r.y + r.height / 2
        )
        return top !== null && el.contains(top)
      })
    ).toBe(true)
  })

  test('opening full settings externally dismisses the quick panel', async ({
    page,
  }) => {
    await page.getByRole('button', { name: '字幕快捷设置' }).click()
    await expect(page.locator('[data-quick-panel="subtitle"]')).toBeVisible()
    await page.evaluate(() =>
      (window as PlayerWindow).__player.store
        .getState()
        .openSettingsAt('subtitle')
    )
    await expect(
      page.locator('[data-quick-panel="subtitle"]')
    ).not.toBeVisible()
    await page.getByRole('button', { name: '返回播放' }).click()
    await expect(
      page.locator('[data-quick-panel="subtitle"]')
    ).not.toBeVisible()
    await page.getByRole('button', { name: '弹幕快捷设置' }).click()
    await page.getByRole('button', { name: '挂载弹幕…' }).click()
    await expect(page.locator('[data-quick-panel="danmaku"]')).not.toBeVisible()
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as PlayerWindow).__player.store.getState().danmakuDialogOpen
        )
      )
      .toBe(true)
  })
})

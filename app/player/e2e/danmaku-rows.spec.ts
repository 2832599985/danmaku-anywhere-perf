import { readFileSync } from 'node:fs'
import path from 'node:path'
import { expect, test } from '@playwright/test'

/**
 * Row spacing regression. With the engine's old fixed 32px tracks, a 26px font
 * (browser line box ≈ 1.35em = 35px) already touched the row below, and any
 * larger font piled up. These checks read the REAL laid-out boxes in Chromium:
 * the text box height must be pinned to `fontSize * 1.15`, and the vertical
 * distance between two rows must be at least that.
 */

const videoBase64 = readFileSync(
  path.join(import.meta.dirname, 'fixtures/test.mp4')
).toString('base64')

// Enough scrolling comments in a short window that many rows fill at once.
const BURST = Array.from({ length: 40 }, (_, i) => ({
  p: `${(i * 0.1).toFixed(1)},1,16777215`,
  m: `第${i + 1}条弹幕 行距检查`,
}))

const TEXT_BOX_RATIO = 1.15

/** Every laid-out danmaku: its box top/height and the inherited line box. */
const measure = (page: import('@playwright/test').Page) =>
  page.evaluate(() => {
    const nodes = Array.from(
      document.querySelectorAll<HTMLElement>('.da-danmaku')
    )
    return nodes.map((node) => {
      const rect = node.getBoundingClientRect()
      const style = getComputedStyle(node)
      return {
        top: Math.round(rect.top * 100) / 100,
        height: Math.round(rect.height * 100) / 100,
        fontSize: Number.parseFloat(style.fontSize),
        lineHeight: Number.parseFloat(style.lineHeight),
        opacity: style.opacity,
      }
    })
  })

test('danmaku rows never overlap, whatever the font size', async ({ page }) => {
  await page.goto('/')
  await page.waitForFunction(
    () => !!(window as unknown as { __player?: unknown }).__player,
    undefined,
    { timeout: 30_000 }
  )

  await page.evaluate((b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
    const url = URL.createObjectURL(new Blob([bytes], { type: 'video/mp4' }))
    const w = window as unknown as {
      __player: { store: { getState: () => any } }
    }
    w.__player.store.getState().setMedia({ url, name: 'test.mp4' })
  }, videoBase64)

  await page.evaluate(() => (window as any).__player.commands.play())
  await expect
    .poll(
      async () =>
        page.evaluate(
          () => (document.querySelector('video') as HTMLVideoElement).readyState
        ),
      { timeout: 20_000 }
    )
    .toBeGreaterThan(1)

  for (const fontSize of [12, 26, 36, 48]) {
    // Rewind: every round needs the comment burst (0–3.9s) still ahead of the
    // playhead, otherwise the renderer has nothing to emit on later rounds.
    await page.evaluate(() => {
      const video = document.querySelector('video') as HTMLVideoElement
      video.currentTime = 0
    })
    // Set the size FIRST, then mount: every node is created at that size.
    await page.evaluate((size) => {
      ;(window as any).__player.store
        .getState()
        .updateDanmakuSettings({ fontSize: size })
    }, fontSize)
    await page.evaluate((comments) => {
      ;(window as any).__player.store
        .getState()
        .setComments(comments, { label: 'e2e', count: comments.length })
    }, BURST)
    // Enough playback for several rows to be on screen at once.
    await page.waitForTimeout(1800)

    const boxes = await measure(page)
    expect(
      boxes.length,
      `font ${fontSize}px: no danmaku laid out`
    ).toBeGreaterThan(0)

    for (const box of boxes) {
      // The text box is pinned, so its height is predictable from the font.
      expect(box.fontSize).toBe(fontSize)
      expect(
        box.lineHeight,
        `font ${fontSize}px: line box not pinned`
      ).toBeCloseTo(fontSize * TEXT_BOX_RATIO, 0)
      expect(
        box.height,
        `font ${fontSize}px: box taller than the pinned line box`
      ).toBeLessThanOrEqual(fontSize * TEXT_BOX_RATIO + 1)
    }

    // Vertical distance between two DIFFERENT rows must cover a whole text
    // box: anything less means the rows touch or overlap.
    const tops = [...new Set(boxes.map((box) => box.top))].sort((a, b) => a - b)
    let minPitch = Number.POSITIVE_INFINITY
    for (let i = 1; i < tops.length; i += 1) {
      minPitch = Math.min(minPitch, tops[i] - tops[i - 1])
    }
    if (Number.isFinite(minPitch)) {
      expect(
        minPitch,
        `font ${fontSize}px: rows only ${minPitch.toFixed(1)}px apart, ` +
          `text box is ${(fontSize * TEXT_BOX_RATIO).toFixed(1)}px`
      ).toBeGreaterThanOrEqual(fontSize * TEXT_BOX_RATIO)
    }
  }
})

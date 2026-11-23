// Verify the row-spacing fix in the REAL packaged exe (WebView2), over CDP.
// Reads the actual laid-out danmaku boxes: the text box must be pinned to
// fontSize * 1.15 and two rows must never be closer than that.
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'

const here = path.dirname(fileURLToPath(import.meta.url))
const FIXTURE = path.join(here, 'fixtures', 'test.mp4')

const TEXT_BOX_RATIO = 1.15

const BURST = Array.from({ length: 40 }, (_, i) => ({
  p: `${(i * 0.1).toFixed(1)},1,16777215`,
  m: `第${i + 1}条弹幕 行距检查`,
}))

const main = async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222')
  const context = browser.contexts()[0]
  const page = context.pages()[0] ?? (await context.newPage())
  await page.waitForFunction(() => !!window.__player, undefined, {
    timeout: 30_000,
  })

  // Open the fixture by path (the exe's own pipeline, incl. stream://).
  await page.evaluate(
    (p) => window.__player.commands.openVideoFromPath(p),
    FIXTURE
  )
  await page.waitForFunction(
    () => {
      const v = document.querySelector('video')
      return v && v.readyState >= 2
    },
    undefined,
    { timeout: 30_000 }
  )
  await page.evaluate(() => window.__player.commands.play())

  const results = []
  const check = (name, ok, detail = '') => {
    results.push({ name, ok, detail })
    console.log(
      `${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` -- ${detail}` : ''}`
    )
  }

  for (const fontSize of [12, 26, 36, 48]) {
    await page.evaluate(() => {
      document.querySelector('video').currentTime = 0
    })
    await page.evaluate((size) => {
      window.__player.store.getState().updateDanmakuSettings({ fontSize: size })
    }, fontSize)
    await page.evaluate((comments) => {
      window.__player.store
        .getState()
        .setComments(comments, { label: 'exe', count: comments.length })
    }, BURST)
    await page.waitForTimeout(1800)

    const info = await page.evaluate(() => {
      const nodes = Array.from(document.querySelectorAll('.da-danmaku'))
      const boxes = nodes.map((node) => {
        const rect = node.getBoundingClientRect()
        const style = getComputedStyle(node)
        return {
          top: Math.round(rect.top * 10) / 10,
          height: Math.round(rect.height * 10) / 10,
          fontSize: Number.parseFloat(style.fontSize),
          lineHeight: Number.parseFloat(style.lineHeight),
        }
      })
      const tops = [...new Set(boxes.map((b) => b.top))].sort((a, b) => a - b)
      let minPitch = Number.POSITIVE_INFINITY
      for (let i = 1; i < tops.length; i += 1) {
        minPitch = Math.min(minPitch, tops[i] - tops[i - 1])
      }
      return {
        count: boxes.length,
        rows: tops.length,
        fontSize: boxes[0]?.fontSize ?? 0,
        boxHeight: boxes[0]?.height ?? 0,
        lineHeight: boxes[0]?.lineHeight ?? 0,
        minPitch,
      }
    })

    check(
      `font ${fontSize}px: danmaku laid out`,
      info.count > 0,
      `${info.count} nodes on ${info.rows} rows`
    )
    check(
      `font ${fontSize}px: line box pinned to ${(fontSize * TEXT_BOX_RATIO).toFixed(2)}px`,
      Math.abs(info.lineHeight - fontSize * TEXT_BOX_RATIO) < 0.6,
      `line-height ${info.lineHeight}px`
    )
    check(
      `font ${fontSize}px: box not taller than the line box`,
      info.boxHeight <= fontSize * TEXT_BOX_RATIO + 1,
      `box ${info.boxHeight}px`
    )
    if (Number.isFinite(info.minPitch)) {
      check(
        `font ${fontSize}px: rows >= one text box apart`,
        info.minPitch >= fontSize * TEXT_BOX_RATIO,
        `pitch ${info.minPitch}px, box ${(fontSize * TEXT_BOX_RATIO).toFixed(1)}px`
      )
    }
  }

  const passed = results.filter((r) => r.ok).length
  console.log(`\n${passed}/${results.length} checks passed`)
  await browser.close()
  process.exit(passed === results.length ? 0 : 1)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})

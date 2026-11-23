// Screenshot every screen of the packaged exe over CDP, then scan each one for
// text that overflows or wraps inside a nowrap/fixed box.
// Usage: launch the exe with WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'

const HERE = dirname(fileURLToPath(import.meta.url))
const OUT = join(HERE, '..', 'test-results', 'ui-audit')
const FIXTURE = join(HERE, 'fixtures', 'test.mp4')
mkdirSync(OUT, { recursive: true })

const cdp = await chromium.connectOverCDP('http://127.0.0.1:9222')
const page = cdp.contexts()[0].pages()[0]
await page.waitForFunction(() => !!window.__player, null, { timeout: 20000 })

const shot = async (name) => {
  await page.waitForTimeout(700)
  await page.screenshot({ path: join(OUT, `${name}.png`) })
  // Report any element whose content overflows its box, or that wrapped
  // to more lines than its box height allows.
  const bad = await page.evaluate(() => {
    const out = []
    for (const el of document.querySelectorAll('body *')) {
      const cs = getComputedStyle(el)
      if (cs.visibility === 'hidden' || cs.display === 'none') continue
      const r = el.getBoundingClientRect()
      if (r.width < 2 || r.height < 2) continue
      const hasText = [...el.childNodes].some(
        (n) => n.nodeType === 3 && n.textContent.trim().length > 0
      )
      if (!hasText) continue
      const text = el.textContent.trim().slice(0, 42)
      // overflow:hidden/clip/auto/scroll INTENTIONALLY clip — there scrollWidth
      // exceeding clientWidth is the clipped content (e.g. text-overflow:ellipsis)
      // and is correct, not a defect. Only flag genuinely un-clipped overflow.
      const clipX = ['hidden', 'clip', 'auto', 'scroll'].includes(cs.overflowX)
      const clipY = ['hidden', 'clip', 'auto', 'scroll'].includes(cs.overflowY)
      const overflowsX = !clipX && el.scrollWidth - el.clientWidth > 2
      const overflowsY = !clipY && el.scrollHeight - el.clientHeight > 2
      // A rotated ancestor inflates getBoundingClientRect into an axis-aligned
      // bounding box, so rect-based metrics (and the scroll/client delta it
      // can induce) are unreliable there — skip, those are false positives.
      let rotated = false
      for (
        let p = el.parentElement;
        p && p !== document.body;
        p = p.parentElement
      ) {
        if (getComputedStyle(p).transform !== 'none') {
          rotated = true
          break
        }
      }
      // char-per-line wrapping: very narrow box holding multi-line CJK. Use
      // layout metrics (clientWidth/Height), not the transform-distorted rect.
      const lh =
        Number.parseFloat(cs.lineHeight) || Number.parseFloat(cs.fontSize) * 1.4
      const lines = Math.round(el.clientHeight / lh)
      const squashed =
        cs.whiteSpace !== 'nowrap' &&
        lines >= 2 &&
        el.clientWidth < 60 &&
        text.length > 2
      if (
        !rotated &&
        (overflowsX || overflowsY || squashed) &&
        cs.overflow !== 'auto'
      ) {
        out.push({
          text,
          tag: el.tagName,
          w: Math.round(r.width),
          h: Math.round(r.height),
          scrollW: el.scrollWidth,
          scrollH: el.scrollHeight,
          lines,
          reason: squashed
            ? 'SQUASHED'
            : overflowsX
              ? 'OVERFLOW-X'
              : 'OVERFLOW-Y',
        })
      }
    }
    return out
  })
  console.log(`\n=== ${name} ===`)
  if (!bad.length) console.log('  no overflow detected')
  for (const b of bad) {
    console.log(
      `  [${b.reason}] <${b.tag}> ${b.w}x${b.h} (scroll ${b.scrollW}x${b.scrollH}, ${b.lines} lines) "${b.text}"`
    )
  }
  return bad
}

const set = (fn, arg) => page.evaluate(fn, arg)

// 07 idle
await set(() => {
  const s = window.__player.store.getState()
  s.setSettingsOpen(false)
  s.setPlaylistOpen(false)
  s.setDanmakuDialogOpen(false)
  s.setMedia(null)
})
await shot('07-idle')

// 01 playing (with danmaku + upscale on)
await set((p) => window.__player.commands.openVideoFromPath(p), FIXTURE)
await page.waitForFunction(
  () => {
    const v = document.querySelector('video')
    return v && v.readyState >= 2
  },
  null,
  { timeout: 20000 }
)
await set(() =>
  window.__player.store.getState().updateUpscale({
    enabled: true,
    targetResolution: 'x4',
    frameInterpolation: { enabled: true, mode: 'targetFps', targetFps: 120 },
  })
)
await page.waitForTimeout(2500)
await set(() => document.querySelector('video')?.pause())
await shot('01-playing')

// 02 upscale settings
await set(() => window.__player.store.getState().openSettingsAt('upscale'))
await shot('02-upscale')

// 03 danmaku settings
await set(() => window.__player.store.getState().setSettingsSection('danmaku'))
await shot('03-danmaku')

// 06 settings shortcuts
await set(() =>
  window.__player.store.getState().setSettingsSection('shortcuts')
)
await shot('06-settings')

await set(() => window.__player.store.getState().setSettingsOpen(false))

// 05 playlist
await set(() => window.__player.store.getState().setPlaylistOpen(true))
await shot('05-playlist')
await set(() => window.__player.store.getState().setPlaylistOpen(false))

// 04 danmaku source dialog
await set(() => window.__player.store.getState().setDanmakuDialogOpen(true))
await shot('04-source')
await set(() => window.__player.store.getState().setDanmakuDialogOpen(false))

console.log(`\nscreenshots -> ${OUT}`)
await cdp.close()

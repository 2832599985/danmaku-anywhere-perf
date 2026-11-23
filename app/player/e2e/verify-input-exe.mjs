// Mouse/keyboard input acceptance against the REAL packaged exe, over CDP.
// Launch the exe with a TEMP WEBVIEW2_USER_DATA_FOLDER and
//   WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222
// Checks: a double-click goes fullscreen without pausing/resuming on the way,
// a single click still toggles playback, the mini window restores on a
// double-click (and is NOT maximized by Tauri's drag-region script), and the
// arrow keys tap/hold (3× forward, 3× rewind) with physical-key matching.
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'

const here = path.dirname(fileURLToPath(import.meta.url))
const FIXTURE = path.join(here, 'fixtures', 'test.mp4')

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` -- ${detail}` : ''}`
  )
}

const browser = await chromium.connectOverCDP('http://127.0.0.1:9222')
const page = browser.contexts()[0].pages()[0]
await page.waitForFunction(() => !!window.__player, undefined, {
  timeout: 30_000,
})
await page.bringToFront()

const video = () =>
  page.evaluate(() => {
    const v = document.querySelector('video')
    return { t: v.currentTime, paused: v.paused, rate: v.playbackRate }
  })
const windowState = () =>
  page.evaluate(async () => {
    const win = window.__TAURI__.window.getCurrentWindow()
    const scale = await win.scaleFactor()
    const size = (await win.outerSize()).toLogical(scale)
    return {
      w: Math.round(size.width),
      maximized: await win.isMaximized(),
    }
  })
const countPauseEvents = () =>
  page.evaluate(() => {
    const v = document.querySelector('video')
    window.__pauses = 0
    v.addEventListener('pause', () => {
      window.__pauses += 1
    })
  })
const stageCenter = async () => {
  const box = await page.locator('[data-player-stage]').boundingBox()
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

await page.evaluate(
  (p) => window.__player.commands.openVideoFromPath(p),
  FIXTURE
)
await page.waitForFunction(
  () => (document.querySelector('video')?.readyState ?? 0) >= 2,
  undefined,
  { timeout: 30_000 }
)
await page.evaluate(() => {
  document.querySelector('video').loop = true
  window.__player.commands.play()
})
await page.waitForTimeout(1000)
await countPauseEvents()

// --- double-click: fullscreen, playback never paused on the way ---
const c = await stageCenter()
await page.mouse.dblclick(c.x, c.y)
await page.waitForTimeout(800)
check(
  'dblclick: entered fullscreen',
  await page.evaluate(() => !!document.fullscreenElement)
)
check(
  'dblclick: no pause on the way',
  (await page.evaluate(() => window.__pauses)) === 0,
  `pause events ${await page.evaluate(() => window.__pauses)}`
)
check('dblclick: still playing', !(await video()).paused)
await page.mouse.dblclick(c.x, c.y)
await page.waitForTimeout(800)
check(
  'dblclick again: left fullscreen',
  await page.evaluate(() => !document.fullscreenElement)
)

// --- single click: still toggles playback (after the double-click window) ---
const c2 = await stageCenter()
await page.mouse.click(c2.x, c2.y)
await page.waitForTimeout(500)
check('click: paused', (await video()).paused)
await page.mouse.click(c2.x, c2.y)
await page.waitForTimeout(500)
check('click again: playing', !(await video()).paused)

// --- keyboard: physical keys ---
const mutedBefore = await page.evaluate(
  () => document.querySelector('video').muted
)
await page.keyboard.press('KeyM')
await page.waitForTimeout(200)
check(
  'KeyM: mute toggled',
  (await page.evaluate(() => document.querySelector('video').muted)) !==
    mutedBefore
)
await page.keyboard.press('KeyM')
await page.evaluate(() => {
  window.__player.commands.pause()
  window.__player.store.getState().updatePlaybackSettings({ seekStepSec: 1 })
  window.__player.commands.seekTo(4)
})
await page.waitForTimeout(400)
const t0 = (await video()).t
await page.keyboard.press('ArrowRight')
await page.waitForTimeout(400)
const t1 = (await video()).t
check(
  '→ tap: +1s',
  Math.abs(t1 - t0 - 1) < 0.15,
  `${t0.toFixed(2)} → ${t1.toFixed(2)}`
)
await page.keyboard.press('ArrowLeft')
await page.waitForTimeout(400)
const t2 = (await video()).t
check(
  '← tap: -1s',
  Math.abs(t1 - t2 - 1) < 0.15,
  `${t1.toFixed(2)} → ${t2.toFixed(2)}`
)

// Ctrl+→ must not seek on its release.
await page.keyboard.down('Control')
await page.keyboard.press('ArrowRight')
await page.keyboard.up('Control')
await page.waitForTimeout(400)
check('Ctrl+→: no seek', Math.abs((await video()).t - t2) < 0.05)

// Hold ← (playing): rewinds at 3×, release resumes playback.
await page.evaluate(() => window.__player.commands.play())
await page.waitForTimeout(300)
const tHold = (await video()).t
await page.keyboard.down('ArrowLeft')
for (let i = 0; i < 10; i += 1) {
  await page.keyboard.down('ArrowLeft') // auto-repeat
  await page.waitForTimeout(100)
}
const during = await video()
await page.keyboard.up('ArrowLeft')
await page.waitForTimeout(500)
const afterHold = await video()
check(
  '← hold: rewound',
  during.t < tHold - 1.5,
  `${tHold.toFixed(2)} → ${during.t.toFixed(2)} in ~1s`
)
check('← hold: paused while rewinding', during.paused)
check('← hold release: playing again', !afterHold.paused)
check('← hold: rate untouched', afterHold.rate === 1)

// Hold → : 3× while held, back to 1× on release.
await page.keyboard.down('ArrowRight')
await page.keyboard.down('ArrowRight')
await page.waitForTimeout(200)
check('→ hold: 3×', (await video()).rate === 3)
await page.keyboard.up('ArrowRight')
await page.waitForTimeout(200)
check('→ hold release: 1×', (await video()).rate === 1)

// --- mini: double-click restores, never maximizes ---
const before = await windowState()
await page.keyboard.press('KeyP')
await page.waitForTimeout(1000)
check(
  'KeyP: mini on',
  (await page.evaluate(() => window.__player.store.getState().miniPlayer)) ===
    true
)
const m = await stageCenter()
await page.mouse.dblclick(m.x, m.y)
await page.waitForTimeout(1200)
const after = await windowState()
check(
  'mini dblclick: restored',
  (await page.evaluate(() => window.__player.store.getState().miniPlayer)) ===
    false
)
check(
  'mini dblclick: not maximized',
  after.maximized === before.maximized,
  `maximized ${after.maximized}`
)
check(
  'mini dblclick: normal size back',
  Math.abs(after.w - before.w) <= 2,
  `${after.w} (was ${before.w})`
)
check('mini round trip: still playing', !(await video()).paused)

const passed = results.filter((r) => r.ok).length
console.log(`\n== ${passed}/${results.length} input checks passed ==`)
await browser.close()
process.exit(passed === results.length ? 0 : 1)

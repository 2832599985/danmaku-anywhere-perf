// Mini player (小窗) acceptance against the REAL packaged exe, over CDP.
// Launch the exe with a TEMP WEBVIEW2_USER_DATA_FOLDER and
//   WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222
// Checks: the window shrinks/pins and restores exactly, playback never stops,
// danmaku/subtitle text shrinks only while mini and the stored settings stay
// untouched, upscale is active again after restoring.
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'

const here = path.dirname(fileURLToPath(import.meta.url))
const FIXTURE = path.join(here, 'fixtures', 'test.mp4')
const BURST = Array.from({ length: 30 }, (_, i) => ({
  p: `${(i * 0.15).toFixed(2)},1,16777215`,
  m: `小窗弹幕 ${i + 1}`,
}))

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

const windowState = () =>
  page.evaluate(async () => {
    const win = window.__TAURI__.window.getCurrentWindow()
    const scale = await win.scaleFactor()
    const size = (await win.outerSize()).toLogical(scale)
    const pos = (await win.outerPosition()).toLogical(scale)
    return {
      w: Math.round(size.width),
      h: Math.round(size.height),
      x: Math.round(pos.x),
      y: Math.round(pos.y),
      onTop: await win.isAlwaysOnTop(),
      maximized: await win.isMaximized(),
    }
  })
const state = () => page.evaluate(() => window.__player.store.getState())
const danmakuFontOnScreen = async () => {
  await page.evaluate(() => {
    document.querySelector('video').currentTime = 0
  })
  await page.waitForTimeout(1500)
  return page.evaluate(() => {
    const node = document.querySelector('.da-danmaku')
    return node ? Number.parseFloat(getComputedStyle(node).fontSize) : 0
  })
}
const subtitleSizeVar = () =>
  page.evaluate(() =>
    Number(
      document
        .querySelector('[data-subtitle-layer]')
        .querySelector('.sub-root')
        ?.style.getPropertyValue('--sub-size')
    )
  )
const playing = () =>
  page.evaluate(() => !document.querySelector('video').paused)

await page.evaluate(
  (p) => window.__player.commands.openVideoFromPath(p),
  FIXTURE
)
await page.waitForFunction(
  () => (document.querySelector('video')?.readyState ?? 0) >= 2,
  undefined,
  { timeout: 30_000 }
)
await page.evaluate((comments) => {
  document.querySelector('video').loop = true
  window.__player.commands.play()
  const s = window.__player.store.getState()
  s.setComments(comments, { label: 'mini', count: comments.length })
  s.updateUpscale({ enabled: true })
}, BURST)
await page.waitForTimeout(2500)

const before = await windowState()
// outerSize includes the border; the restore sets the inner size, so compare
// outer to outer and expect no drift at all.
const stored = await state()
const storedFont = stored.danmakuSettings.fontSize
const storedSub = stored.subtitleSettings.fontSize

// --- enter ---
await page.evaluate(() => window.__player.commands.toggleMiniPlayer())
await page.waitForTimeout(800)
const mini = await windowState()
check('mini: store flag on', (await state()).miniPlayer === true)
check(
  'mini: window shrunk to ~480 wide',
  mini.w >= 460 && mini.w <= 500,
  `${mini.w}x${mini.h}`
)
check(
  'mini: height follows the 16:9 source',
  Math.abs(mini.h - 270) <= 20,
  `${mini.h}`
)
check('mini: always on top', mini.onTop === true)
const area = await page.evaluate(() => ({
  w: screen.availWidth,
  h: screen.availHeight,
  l: screen.availLeft ?? 0,
  t: screen.availTop ?? 0,
}))
check(
  'mini: parked in the bottom-right corner',
  mini.x + mini.w > area.l + area.w - 60 &&
    mini.y + mini.h > area.t + area.h - 60,
  `at ${mini.x},${mini.y} in ${area.w}x${area.h}`
)
check(
  'mini: full chrome replaced by the mini strip',
  await page.evaluate(() => !!document.querySelector('[data-mini-controls]'))
)
const miniFont = await danmakuFontOnScreen()
check(
  'mini: danmaku text shrunk',
  miniFont > 0 && miniFont < storedFont,
  `${miniFont}px (stored ${storedFont}px)`
)
check(
  'mini: stored danmaku size untouched',
  (await state()).danmakuSettings.fontSize === storedFont
)
const miniSub = await subtitleSizeVar()
check(
  'mini: subtitle size shrunk',
  miniSub > 0 && miniSub < storedSub,
  `--sub-size ${miniSub} (stored ${storedSub})`
)
check('mini: still playing', await playing())
await page.evaluate(() => window.__player.commands.toggleFullscreen())
await page.waitForTimeout(300)
check(
  'mini: fullscreen refused',
  await page.evaluate(() => !document.fullscreenElement)
)

// --- exit ---
await page.evaluate(() => window.__player.commands.toggleMiniPlayer())
await page.waitForTimeout(1000)
const after = await windowState()
check('restore: store flag off', (await state()).miniPlayer === false)
check(
  'restore: size back',
  Math.abs(after.w - before.w) <= 2 && Math.abs(after.h - before.h) <= 2,
  `${after.w}x${after.h} (was ${before.w}x${before.h})`
)
check(
  'restore: position back',
  Math.abs(after.x - before.x) <= 2 && Math.abs(after.y - before.y) <= 2,
  `${after.x},${after.y} (was ${before.x},${before.y})`
)
check('restore: no longer on top', after.onTop === false)
check('restore: maximized state back', after.maximized === before.maximized)
const backFont = await danmakuFontOnScreen()
check(
  'restore: danmaku back to the stored size',
  backFont === storedFont,
  `${backFont}px`
)
const backSub = await subtitleSizeVar()
check(
  'restore: subtitle size back',
  backSub === storedSub,
  `--sub-size ${backSub}`
)
check(
  'restore: top bar and controls back',
  await page.evaluate(() => !document.querySelector('[data-mini-controls]'))
)
check('restore: still playing', await playing())
await page.waitForTimeout(2500)
const status = (await state()).upscaleStatus
check('restore: upscale active', status === 'active', status)

// --- maximized round trip ---
await page.evaluate(() => window.__TAURI__.window.getCurrentWindow().maximize())
await page.waitForTimeout(600)
await page.evaluate(() => window.__player.commands.toggleMiniPlayer())
await page.waitForTimeout(800)
check('maximized -> mini: shrunk', (await windowState()).w < 520)
await page.evaluate(() => window.__player.commands.toggleMiniPlayer())
await page.waitForTimeout(1000)
check(
  'mini -> maximized: maximized again',
  (await windowState()).maximized === true
)
await page.evaluate(() =>
  window.__TAURI__.window.getCurrentWindow().unmaximize()
)

const passed = results.filter((r) => r.ok).length
console.log(`\n== ${passed}/${results.length} mini checks passed ==`)
await browser.close()
process.exit(passed === results.length ? 0 : 1)

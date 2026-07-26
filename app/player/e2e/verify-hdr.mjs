// Verify HDR10 support in the packaged exe: HDR detection + upscale suppression.
// Launch exe with WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'

const here = path.dirname(fileURLToPath(import.meta.url))
const SDR = path.join(here, 'fixtures', 'test.mp4') // H.264 bt709
const HDR = path.join(here, 'fixtures', 'hdr10_test.mp4') // HEVC PQ/BT.2020

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail })
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` -- ${detail}` : ''}`
  )
}

const cdp = await chromium.connectOverCDP('http://127.0.0.1:9222')
const page = cdp.contexts().flatMap((c) => c.pages())[0]
await page.reload({ waitUntil: 'load' })
await page.waitForFunction(() => '__player' in window, null, { timeout: 15000 })
await page.waitForTimeout(1000)

const openAndSettle = async (p) => {
  await page.evaluate((f) => window.__player.commands.openVideoFromPath(f), p)
  await page.waitForFunction(
    () => {
      const v = document.querySelector('video')
      return v && v.readyState >= 2 && Number.isFinite(v.duration)
    },
    null,
    { timeout: 15000 }
  )
  await page.waitForTimeout(1500) // let the HDR-detection rVFC fire
}

// --- 1. SDR clip must NOT be flagged HDR ---
await openAndSettle(SDR)
const sdr = await page.evaluate(() => {
  const s = window.__player.store.getState()
  const v = document.querySelector('video')
  return { isHdr: s.isHdr, transfer: s.hdrTransfer, w: v.videoWidth }
})
check('SDR clip not flagged HDR', sdr.isHdr === false, JSON.stringify(sdr))

// --- 2. HDR clip decodes + is flagged HDR (pq) ---
await openAndSettle(HDR)
const hdr = await page.evaluate(() => {
  const s = window.__player.store.getState()
  const v = document.querySelector('video')
  return {
    isHdr: s.isHdr,
    transfer: s.hdrTransfer,
    w: v.videoWidth,
    h: v.videoHeight,
    err: v.error ? `${v.error.code}` : null,
    ready: v.readyState,
  }
})
check(
  'HDR clip decodes (HEVC HDR10)',
  hdr.w === 640 && !hdr.err,
  JSON.stringify(hdr)
)
check(
  'HDR clip flagged pq',
  hdr.isHdr === true && hdr.transfer === 'pq',
  `transfer=${hdr.transfer}`
)
await page.screenshot({
  path: path.join(here, '..', 'test-results', 'exe-4-hdr-badge.png'),
})

// --- 3. enabling upscale on HDR must be SUPPRESSED (no upscale canvas shown) ---
await page.evaluate(() =>
  window.__player.store
    .getState()
    .updateUpscale({ enabled: true, targetResolution: 'x2' })
)
await page.waitForTimeout(3000)
const sup = await page.evaluate(() => {
  const c = document.querySelector('canvas[data-danmaku-anywhere-upscale]')
  const v = document.querySelector('video')
  return {
    canvasVisible: c ? c.style.visibility !== 'hidden' && c.width > 0 : false,
    videoOpacity: v.style.opacity,
  }
})
check(
  'upscale suppressed on HDR (video stays visible)',
  sup.canvasVisible === false && sup.videoOpacity !== '0',
  JSON.stringify(sup)
)

// --- 4. switching back to SDR resumes upscale (setting was kept on) ---
await openAndSettle(SDR)
await page.waitForFunction(
  () => {
    const c = document.querySelector('canvas[data-danmaku-anywhere-upscale]')
    return c && c.style.visibility !== 'hidden' && c.width > 0
  },
  null,
  { timeout: 20000 }
)
const resumed = await page.evaluate(() => {
  const c = document.querySelector('canvas[data-danmaku-anywhere-upscale]')
  const v = document.querySelector('video')
  return {
    w: c.width,
    h: c.height,
    videoOpacity: v.style.opacity,
    isHdr: window.__player.store.getState().isHdr,
  }
})
check(
  'upscale resumes on SDR (canvas 1280x720)',
  resumed.w === 1280 &&
    resumed.h === 720 &&
    resumed.videoOpacity === '0' &&
    !resumed.isHdr,
  JSON.stringify(resumed)
)

const failed = results.filter((r) => !r.ok)
console.log(
  `\n== ${results.length - failed.length}/${results.length} HDR checks passed ==`
)
await cdp.close()
process.exit(failed.length ? 1 : 0)

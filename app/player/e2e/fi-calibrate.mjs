// Which repeat test is good enough — and how cheap is it? Runs INSIDE the real
// exe, so Chromium's own scalers do the work. Upscale is turned OFF so nothing
// competes for the GPU. For each presented frame we grab a 160x90 thumbnail by
// three methods plus a 480x270 "truth" frame:
//   sync    160x90 via ctx.drawImage(video, ...) + getImageData (synchronous)
//   low     160x90 via createImageBitmap(VideoFrame, resizeQuality: 'low')
//   medium  160x90 via createImageBitmap(VideoFrame, resizeQuality: 'medium')
//   truth   480x270 via createImageBitmap(VideoFrame, resizeQuality: 'medium')
// Per consecutive pair the truth is the max 6x6-tile mean |dRGB| of the two
// 480x270 frames (a 6x6 block there = a 24x24 block at 1080p, i.e. roughly what
// a viewer sees move). Held = truth < 5 (no visible change), changed = truth
// >= 8. For each method it prints how its per-pair max |dRGB| separates the two
// classes and how many real changes each threshold would miss.
//   node e2e/fi-calibrate.mjs <clip> <seek> [frames]
import { chromium } from '@playwright/test'

const [CLIP, SEEK = '400', FRAMES = '240'] = process.argv.slice(2)
const cdp = await chromium.connectOverCDP('http://127.0.0.1:9222')
const page = cdp.contexts().flatMap((c) => c.pages())[0]
const wait = (ms) => page.waitForTimeout(ms)

await page.evaluate(() =>
  window.__player.store.getState().updateUpscale({ enabled: false })
)
await page.evaluate((p) => window.__player.commands.openVideoFromPath(p), CLIP)
await wait(3000)
await page.evaluate((s) => window.__player.commands.seekTo(Number(s)), SEEK)
await wait(1500)
await page.evaluate(() => window.__player.commands.play())
await wait(800)

const result = await page.evaluate(async (count) => {
  const video = document.querySelector('video')
  const TW = 160
  const TH = 90
  const RW = 480
  const RH = 270
  const TILE = 6
  const make = (w, h) => {
    const c = document.createElement('canvas')
    c.width = w
    c.height = h
    return c.getContext('2d', { willReadFrequently: true })
  }
  const syncCtx = make(TW, TH)
  const bitmapCtx = make(TW, TH)
  const truthCtx = make(RW, RH)

  const grabSync = () => {
    syncCtx.drawImage(video, 0, 0, TW, TH)
    return syncCtx.getImageData(0, 0, TW, TH).data
  }
  const grabBitmap = async (source, quality, w, h, ctx) => {
    const bmp = await createImageBitmap(source, {
      resizeWidth: w,
      resizeHeight: h,
      resizeQuality: quality,
    })
    ctx.drawImage(bmp, 0, 0)
    bmp.close()
    return ctx.getImageData(0, 0, w, h).data
  }
  // Per-pair max and mean of the summed-3-channel |dRGB| (0..765 per pixel).
  const thumbStats = (a, b) => {
    let max = 0
    let sum = 0
    for (let i = 0; i < a.length; i += 4) {
      const d =
        Math.abs(a[i] - b[i]) +
        Math.abs(a[i + 1] - b[i + 1]) +
        Math.abs(a[i + 2] - b[i + 2])
      sum += d
      if (d > max) max = d
    }
    return { max, mean: sum / (a.length / 4) / 3 }
  }
  const tileMax = (a, b) => {
    let best = 0
    for (let ty = 0; ty < RH / TILE; ty++) {
      for (let tx = 0; tx < RW / TILE; tx++) {
        let s = 0
        for (let y = ty * TILE; y < (ty + 1) * TILE; y++) {
          let o = (y * RW + tx * TILE) * 4
          for (let x = 0; x < TILE; x++, o += 4) {
            s +=
              Math.abs(a[o] - b[o]) +
              Math.abs(a[o + 1] - b[o + 1]) +
              Math.abs(a[o + 2] - b[o + 2])
          }
        }
        if (s > best) best = s
      }
    }
    return best / (TILE * TILE)
  }

  const rows = []
  const latency = { sync: [], low: [], medium: [] }
  let prev = null
  for (let n = 0; n < count; n++) {
    await new Promise((r) => video.requestVideoFrameCallback(() => r()))
    let t0 = performance.now()
    const sync = grabSync()
    latency.sync.push(performance.now() - t0)
    const frame = new VideoFrame(video)
    let low
    let medium
    try {
      t0 = performance.now()
      low = await grabBitmap(frame, 'low', TW, TH, bitmapCtx)
      latency.low.push(performance.now() - t0)
      t0 = performance.now()
      medium = await grabBitmap(frame, 'medium', TW, TH, bitmapCtx)
      latency.medium.push(performance.now() - t0)
    } finally {
      frame.close()
    }
    const truth = await grabBitmap(video, 'medium', RW, RH, truthCtx)
    const cur = { sync, low, medium, truth }
    if (prev) {
      rows.push({
        truth: tileMax(prev.truth, cur.truth),
        sync: thumbStats(prev.sync, cur.sync),
        low: thumbStats(prev.low, cur.low),
        medium: thumbStats(prev.medium, cur.medium),
      })
    }
    prev = cur
  }
  return {
    rows,
    latency,
    w: video.videoWidth,
    h: video.videoHeight,
    quality: video.getVideoPlaybackQuality?.(),
  }
}, Number(FRAMES))

const q = (arr, p) => {
  const s = [...arr].sort((a, b) => a - b)
  return s.length ? s[Math.floor(p * (s.length - 1))] : 0
}
const held = result.rows.filter((r) => r.truth < 5)
const changed = result.rows.filter((r) => r.truth >= 8)
const heldPct = ((100 * held.length) / Math.max(1, result.rows.length)).toFixed(
  1
)
console.log(
  `${result.w}x${result.h} pairs=${result.rows.length} held(truth<5)=${held.length} (${heldPct}%) changed(truth>=8)=${changed.length}`
)
console.log(
  `  changed truth tileMax: p1=${q(
    changed.map((r) => r.truth),
    0.01
  ).toFixed(0)} p50=${q(
    changed.map((r) => r.truth),
    0.5
  ).toFixed(0)} p99=${q(
    changed.map((r) => r.truth),
    0.99
  ).toFixed(0)} max=${q(
    changed.map((r) => r.truth),
    1
  ).toFixed(0)}`
)
for (const method of ['sync', 'low', 'medium']) {
  const h = held.map((r) => r[method].max)
  const c = changed.map((r) => r[method].max)
  const cm = changed.map((r) => r[method].mean)
  const hm = held.map((r) => r[method].mean)
  const miss = (t) => c.filter((v) => v <= t).length
  const waste = (t) => h.filter((v) => v > t).length
  console.log(
    `  ${method.padEnd(6)} latency p50=${q(result.latency[method], 0.5).toFixed(2)} p90=${q(result.latency[method], 0.9).toFixed(2)} max=${q(result.latency[method], 1).toFixed(2)}ms`
  )
  console.log(
    `  ${''.padEnd(6)} held max p50=${q(h, 0.5).toFixed(0)} p99=${q(h, 0.99).toFixed(0)} max=${q(h, 1).toFixed(0)} | held mean p99=${q(hm, 0.99).toFixed(2)} max=${q(hm, 1).toFixed(2)}`
  )
  console.log(
    `  ${''.padEnd(6)} chg  max p1=${q(c, 0.01).toFixed(0)} p5=${q(c, 0.05).toFixed(0)} p50=${q(c, 0.5).toFixed(0)} | chg mean p1=${q(cm, 0.01).toFixed(2)} p5=${q(cm, 0.05).toFixed(2)} p50=${q(cm, 0.5).toFixed(2)} p99=${q(cm, 0.99).toFixed(2)}`
  )
  console.log(
    `  ${''.padEnd(6)} ${[4, 6, 8, 10, 12].map((t) => `T${t}: miss=${miss(t)} waste=${waste(t)}`).join('  ')}`
  )
}
// Candidate scene-cut test: a hard cut has a huge *mean*, ordinary motion a tiny one.
const cutMeans = result.rows
  .filter((r) => r.truth >= 8)
  .map((r) => r.medium.mean)
console.log(
  `  changed mean (medium) over 8/15/25/40: ${[8, 15, 25, 40].map((t) => cutMeans.filter((v) => v >= t).length).join('/')} of ${cutMeans.length}`
)
await cdp.close()

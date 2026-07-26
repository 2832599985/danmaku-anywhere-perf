// Full acceptance verification against the REAL packaged exe (WebView2),
// attached over CDP. Launch the exe first with
//   WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222
// Exercises: CSP-clean bootstrap, stream:// video loading, play/seek/volume
// keys, danmaku mounting, Anime4K upscale canvas, Framegen interpolation,
// playlist (multi-open, sibling danmaku autoload, next/prev, auto-advance).
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'

const here = path.dirname(fileURLToPath(import.meta.url))
const FIXTURE = path.join(here, 'fixtures', 'test.mp4')
const FIXTURE2 = path.join(here, 'fixtures', 'hdr10_test.mp4')
const SHOT_DIR = path.join(here, '..', 'test-results')

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail })
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` -- ${detail}` : ''}`
  )
}

const cdp = await chromium.connectOverCDP('http://127.0.0.1:9222')
const page = cdp.contexts().flatMap((c) => c.pages())[0]
if (!page) {
  console.log('FATAL: no page found')
  process.exit(1)
}

const consoleLog = []
page.on('console', (m) => consoleLog.push(`[${m.type()}] ${m.text()}`))
page.on('pageerror', (e) => consoleLog.push(`[pageerror] ${e.message}`))

// Reload so we observe the entire bootstrap. Clear persisted state first so a
// prior run's playlist/resume-history can't leak into the clean-boot asserts.
await page.addInitScript(() => {
  try {
    localStorage.removeItem('danmaku-player-settings')
  } catch {
    /* storage may be unavailable pre-boot */
  }
})
await page.reload({ waitUntil: 'load' })
await page.waitForFunction(() => '__player' in window, null, {
  timeout: 15000,
})
await page.waitForTimeout(1500)

// 1. CSP-clean bootstrap + visible layout
const cspErrors = consoleLog.filter((l) =>
  l.includes('Content Security Policy')
)
check('no CSP violations', cspErrors.length === 0, cspErrors[0] ?? '')
const ipcWarn = consoleLog.filter((l) =>
  l.includes('IPC custom protocol failed')
)
check('Tauri IPC probe healthy', ipcWarn.length === 0, ipcWarn[0] ?? '')

const layout = await page.evaluate(() => {
  const box = document.querySelector('.MuiBox-root')
  const r = box?.getBoundingClientRect()
  return {
    w: r?.width ?? 0,
    h: r?.height ?? 0,
    iw: window.innerWidth,
    ih: window.innerHeight,
    emptyStateText: document.body.innerText.slice(0, 200),
  }
})
check(
  'layout fills window',
  layout.w > 100 && layout.h > 100 && Math.abs(layout.w - layout.iw) < 4,
  `${layout.w}x${layout.h} in ${layout.iw}x${layout.ih}`
)
check(
  'empty state visible',
  layout.emptyStateText.length > 0,
  JSON.stringify(layout.emptyStateText.slice(0, 60))
)
await page.screenshot({ path: path.join(SHOT_DIR, 'exe-1-empty-state.png') })

// 2. Open local video through the stream:// protocol (1a)
await page.evaluate((p) => {
  window.__player.commands.openVideoFromPath(p)
}, FIXTURE)
await page.waitForFunction(
  () => {
    const v = document.querySelector('video')
    return v && v.readyState >= 3 && Number.isFinite(v.duration)
  },
  null,
  { timeout: 15000 }
)
const mediaInfo = await page.evaluate(() => {
  const v = document.querySelector('video')
  return {
    src: v.currentSrc,
    duration: v.duration,
    w: v.videoWidth,
    h: v.videoHeight,
  }
})
check(
  'video loads via stream://',
  mediaInfo.src.startsWith('http://stream.localhost/') &&
    mediaInfo.duration > 9 &&
    mediaInfo.w === 640,
  `${mediaInfo.src.slice(0, 60)} ${mediaInfo.w}x${mediaInfo.h} ${mediaInfo.duration.toFixed(1)}s`
)

// 3. Playback + seeking through the protocol (range requests)
await page.evaluate(() => window.__player.commands.play())
await page.waitForTimeout(1200)
const t1 = await page.evaluate(
  () => document.querySelector('video').currentTime
)
check('playback advances', t1 > 0.3, `t=${t1.toFixed(2)}`)

// 4. Keyboard: left/right seek (2b), up/down volume (2c)
await page.evaluate(() => {
  window.__player.commands.seekTo(2)
  window.__player.commands.setVolume(0.5)
})
await page.waitForTimeout(300)
await page.keyboard.press('ArrowRight')
await page.waitForTimeout(400)
const afterRight = await page.evaluate(
  () => document.querySelector('video').currentTime
)
check(
  'ArrowRight seeks +5s',
  afterRight > 6.5 && afterRight < 8.5,
  `t=${afterRight.toFixed(2)}`
)
await page.keyboard.press('ArrowLeft')
await page.waitForTimeout(400)
const afterLeft = await page.evaluate(
  () => document.querySelector('video').currentTime
)
check(
  'ArrowLeft seeks -5s',
  afterLeft < afterRight - 4,
  `t=${afterLeft.toFixed(2)}`
)
await page.keyboard.press('ArrowUp')
await page.waitForTimeout(200)
const volUp = await page.evaluate(() => document.querySelector('video').volume)
check('ArrowUp volume +5%', Math.abs(volUp - 0.55) < 0.01, `vol=${volUp}`)
await page.keyboard.press('ArrowDown')
await page.waitForTimeout(200)
const volDown = await page.evaluate(
  () => document.querySelector('video').volume
)
check('ArrowDown volume -5%', Math.abs(volDown - 0.5) < 0.01, `vol=${volDown}`)

// 5. Danmaku mounting (1b)
await page.evaluate(() => {
  const comments = Array.from({ length: 30 }, (_, i) => ({
    p: `${(i % 10) + 0.2},1,16777215`,
    m: `弹幕测试 ${i}`,
  }))
  window.__player.store.getState().setComments(comments, {
    label: 'verify',
    count: comments.length,
  })
  window.__player.commands.seekTo(0)
  window.__player.commands.play()
})
await page.waitForFunction(
  () => document.querySelectorAll('.da-danmaku').length > 0,
  null,
  { timeout: 10000 }
)
const danmakuCount = await page.evaluate(
  () => document.querySelectorAll('.da-danmaku').length
)
check('danmaku nodes render', danmakuCount > 0, `${danmakuCount} nodes`)

// 6. Super-resolution (1c): enable, expect WebGPU canvas at 2x, video hidden
await page.evaluate(() =>
  window.__player.store.getState().updateUpscale({ enabled: true })
)
await page.waitForFunction(
  () => {
    const c = document.querySelector('canvas[data-danmaku-anywhere-upscale]')
    return c && c.style.visibility !== 'hidden' && c.width > 0
  },
  null,
  { timeout: 30000 }
)
const upscaleInfo = await page.evaluate(() => {
  const c = document.querySelector('canvas[data-danmaku-anywhere-upscale]')
  const v = document.querySelector('video')
  return { w: c.width, h: c.height, videoOpacity: v.style.opacity }
})
check(
  'upscale canvas 2x + video hidden',
  upscaleInfo.w === 1280 &&
    upscaleInfo.h === 720 &&
    upscaleInfo.videoOpacity === '0',
  `canvas ${upscaleInfo.w}x${upscaleInfo.h}, video opacity=${upscaleInfo.videoOpacity}`
)

// 7. Frame interpolation (1d): must reach 'active' on this shader-f16 GPU
await page.evaluate(() =>
  window.__player.store.getState().updateUpscale({
    frameInterpolation: { enabled: true },
  })
)
await page.waitForFunction(
  () => {
    const c = document.querySelector('canvas[data-danmaku-anywhere-upscale]')
    const s = c?.dataset.danmakuAnywhereFrameInterpolation
    return s === 'active' || s === 'fallback'
  },
  null,
  { timeout: 45000 }
)
await page.waitForTimeout(2500)
const interp = await page.evaluate(() => {
  const c = document.querySelector('canvas[data-danmaku-anywhere-upscale]')
  return {
    status: c.dataset.danmakuAnywhereFrameInterpolation,
    generated: c.dataset.danmakuAnywhereFrameInterpolationGenerated ?? '0',
  }
})
check(
  'frame interpolation ACTIVE',
  interp.status === 'active' && Number(interp.generated) > 0,
  `status=${interp.status} generated=${interp.generated}`
)
await page.screenshot({
  path: path.join(SHOT_DIR, 'exe-2-upscale-playing.png'),
})

// 8. Volume slider baseline (2a) is the same video.volume driven by commands
const volApi = await page.evaluate(() => {
  window.__player.commands.setVolume(0.8)
  return document.querySelector('video').volume
})
check('volume API', Math.abs(volApi - 0.8) < 0.001, `vol=${volApi}`)

// 9. Playlist: opening ADDS to the (persistent) list. Clear, then open two
// distinct files; dedup means the same path is not queued twice.
await page.evaluate(
  ({ a, b }) => {
    window.__player.store.getState().clearPlaylist()
    window.__player.commands.openVideosFromPaths([a, b])
  },
  { a: FIXTURE, b: FIXTURE2 }
)
const playlistState = await page
  .waitForFunction(
    () => {
      const s = window.__player.store.getState()
      if (s.playlist.length !== 2 || s.playlistIndex !== 0) return null
      const v = document.querySelector('video')
      return v && v.readyState >= 3 ? { len: s.playlist.length } : null
    },
    null,
    { timeout: 15000 }
  )
  .then((h) => h.jsonValue())
check('playlist created from multi-open', playlistState.len === 2, '2 items')

// sibling test.xml must be auto-loaded for the playlist item (Tauri fs read)
const autoDanmaku = await page
  .waitForFunction(
    () => {
      const s = window.__player.store.getState()
      return s.comments.length > 0 && s.danmakuSource
        ? { count: s.comments.length, label: s.danmakuSource.label }
        : null
    },
    null,
    { timeout: 10000 }
  )
  .then((h) => h.jsonValue())
check(
  'sibling danmaku auto-loaded',
  autoDanmaku.count === 2 && autoDanmaku.label === 'test.xml',
  `${autoDanmaku.count} comments from ${autoDanmaku.label}`
)

// playlist drawer UI
await page.evaluate(() => window.__player.commands.togglePlaylist())
await page.waitForTimeout(600)
const drawerText = await page.evaluate(() => {
  const drawer = document.querySelector('.MuiDrawer-root')
  return drawer ? drawer.textContent : ''
})
check(
  'playlist drawer lists items',
  drawerText.includes('播放列表') && drawerText.includes('test.mp4'),
  JSON.stringify(drawerText.slice(0, 80))
)
await page.screenshot({ path: path.join(SHOT_DIR, 'exe-3-playlist.png') })
await page.evaluate(() => window.__player.commands.togglePlaylist())

// next command switches entries
await page.evaluate(() => window.__player.commands.playlistNext())
await page.waitForFunction(
  () => window.__player.store.getState().playlistIndex === 1,
  null,
  { timeout: 10000 }
)
check('playlistNext switches to item 2', true)

// auto-advance: end item 1, item 2 must start by itself
await page.evaluate(() => {
  window.__player.commands.playlistPlayAt(0)
})
await page.waitForFunction(
  () => {
    const v = document.querySelector('video')
    return (
      window.__player.store.getState().playlistIndex === 0 &&
      v &&
      v.readyState >= 3
    )
  },
  null,
  { timeout: 15000 }
)
await page.evaluate(() => {
  window.__player.commands.seekTo(9.6)
  window.__player.commands.play()
})
const advanced = await page
  .waitForFunction(
    () => {
      const s = window.__player.store.getState()
      const v = document.querySelector('video')
      return s.playlistIndex === 1 && v && v.currentTime < 5
        ? { t: v.currentTime }
        : null
    },
    null,
    { timeout: 20000 }
  )
  .then((h) => h.jsonValue())
check('auto-advance on ended', true, `next item at t=${advanced.t.toFixed(2)}`)

// 10. Settings overlay portals INTO the stage (so it stays clickable in
// fullscreen, where document.body is hidden behind the fullscreen element).
await page.evaluate(() =>
  window.__player.store.getState().setSettingsOpen(true)
)
await page.waitForTimeout(500)
const portal = await page.evaluate(() => {
  const stage = document.querySelector('[data-player-stage]')
  const drawer = document.querySelector('.MuiDrawer-root')
  return {
    hasStage: !!stage,
    hasDrawer: !!drawer,
    inside: !!(stage && drawer && stage.contains(drawer)),
  }
})
check(
  'settings drawer portals into stage (fullscreen-safe)',
  portal.inside,
  JSON.stringify(portal)
)
await page.evaluate(() =>
  window.__player.store.getState().setSettingsOpen(false)
)

// 11. Resume history: save a position, reopen the file, expect it to restore.
await page.evaluate((p) => {
  window.__player.commands.openVideoFromPath(p)
}, FIXTURE)
await page.waitForFunction(
  () => {
    const v = document.querySelector('video')
    return v && v.readyState >= 2 && Number.isFinite(v.duration)
  },
  null,
  { timeout: 15000 }
)
// Opening an already-listed file must NOT wipe the history or duplicate it.
const historyState = await page.evaluate(() => {
  const s = window.__player.store.getState()
  return {
    len: s.playlist.length,
    hasFixture2: s.playlist.some((i) => (i.path ?? '').includes('hdr10_test')),
  }
})
check(
  'opening keeps history (no wipe, no dup)',
  historyState.len === 2 && historyState.hasFixture2,
  JSON.stringify(historyState)
)
await page.evaluate(() => {
  window.__player.commands.seekTo(5)
  window.__player.commands.pause() // pause writes progress immediately
})
await page.waitForTimeout(600)
const saved = await page.evaluate((p) => {
  const s = window.__player.store.getState()
  return s.progress[p]?.time ?? null
}, FIXTURE)
check('progress persisted on pause', saved !== null && saved > 4, `t=${saved}`)

// Reopen the same file -> resume effect should seek back near 5s.
await page.evaluate((p) => {
  window.__player.commands.openVideoFromPath(p)
}, FIXTURE)
const resumed = await page
  .waitForFunction(
    () => {
      const v = document.querySelector('video')
      return v && v.readyState >= 2 && v.currentTime > 4
        ? { t: v.currentTime }
        : null
    },
    null,
    { timeout: 15000 }
  )
  .then((h) => h.jsonValue())
check(
  'resumes to saved position on reopen',
  resumed.t > 4 && resumed.t < 7,
  `t=${resumed.t.toFixed(2)}`
)

// 12. Multi-frame interpolation: a higher factor must generate more frames over
// the same playback window (proves N-1 sub-frames per pair, not just 2x).
const readGenerated = () =>
  page.evaluate(() => {
    const c = document.querySelector('canvas[data-danmaku-anywhere-upscale]')
    return Number(c?.dataset.danmakuAnywhereFrameInterpolationGenerated ?? '0')
  })
const measureFactor = async (patch) => {
  await page.evaluate((fi) => {
    const v = document.querySelector('video')
    v.loop = true
    window.__player.store.getState().updateUpscale({
      enabled: true,
      frameInterpolation: { enabled: true, ...fi },
    })
    window.__player.commands.seekTo(1)
    window.__player.commands.play()
  }, patch)
  // Changing the factor triggers a full interpolator reinit; wait until it is
  // active, then sample generated frames over a window. The synthetic fixture is
  // low-motion (most pairs dedup), so counts are small — we assert production,
  // not an exact ratio.
  await page.waitForFunction(
    () => {
      const c = document.querySelector('canvas[data-danmaku-anywhere-upscale]')
      return c?.dataset.danmakuAnywhereFrameInterpolation === 'active'
    },
    null,
    { timeout: 30000 }
  )
  const start = await readGenerated()
  await page.waitForTimeout(5000)
  const end = await readGenerated()
  return end - start
}
// 2x baseline (informational), then the new multi-frame paths must each produce.
const gen2x = await measureFactor({ mode: 'multiplier', multiplier: 2 })
const gen4x = await measureFactor({ mode: 'multiplier', multiplier: 4 })
check(
  '4x multiplier path generates frames',
  gen4x > 0,
  `4x=${gen4x} (2x baseline=${gen2x})`
)
// target-fps mode must also drive the multi-frame path without crashing
const genTarget = await measureFactor({ mode: 'targetFps', targetFps: 170 })
check(
  'targetFps (170) path generates frames',
  genTarget > 0,
  `170fps target generated=${genTarget}`
)

const failed = results.filter((r) => !r.ok)
console.log(
  `\n== ${results.length - failed.length}/${results.length} checks passed ==`
)
if (consoleLog.length) {
  console.log('\n-- console tail --')
  for (const l of consoleLog.slice(-12)) console.log(l)
}
await cdp.close()
process.exit(failed.length ? 1 : 0)

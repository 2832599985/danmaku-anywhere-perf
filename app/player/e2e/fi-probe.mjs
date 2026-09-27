// Frame-interpolation probe against the REAL exe (CDP on :9222, launched with a
// throwaway WEBVIEW2_USER_DATA_FOLDER). For each config it opens a clip, lets
// the renderer settle, then reads the engine's cumulative pair accounting over
// a fixed window and GPU load from nvidia-smi.
//
//   node e2e/fi-probe.mjs <clip> <seekSeconds> <label> [configs-json]
//
// Output: one line per config with generated/s and where the pairs went.
import { execSync } from 'node:child_process'
import { chromium } from '@playwright/test'

const [CLIP, SEEK = '60', LABEL = 'run', CONFIGS_JSON] = process.argv.slice(2)
const WINDOW_S = Number(process.env.FI_WINDOW_S ?? 10)
const SETTLE_MS = Number(process.env.FI_SETTLE_MS ?? 7000)

const defaults = [
  { tier: 'performance', fres: '720p', mult: 2 },
  { tier: 'balanced', fres: '720p', mult: 2 },
  { tier: 'quality', fres: '720p', mult: 2 },
  { tier: 'ultra', fres: '720p', mult: 2 },
  { tier: 'ultra', fres: '720p', mult: 3 },
  { tier: 'balanced', fres: '1080p', mult: 2 },
  { tier: 'performance', fres: '720p', mult: 4 },
]
const configs = CONFIGS_JSON ? JSON.parse(CONFIGS_JSON) : defaults

const gpu = () => {
  try {
    return Number.parseInt(
      execSync(
        'nvidia-smi --query-gpu=utilization.gpu --format=csv,noheader,nounits',
        { encoding: 'utf8' }
      ),
      10
    )
  } catch {
    return Number.NaN
  }
}

const cdp = await chromium.connectOverCDP('http://127.0.0.1:9222')
const page = cdp.contexts().flatMap((c) => c.pages())[0]
if (!page) {
  console.log('FATAL: no page')
  process.exit(1)
}
const wait = (ms) => page.waitForTimeout(ms)

const snap = () =>
  page.evaluate(() => {
    const p = window.__player
    const s = p.store.getState()
    const v = document.querySelector('video')
    const q = v?.getVideoPlaybackQuality?.()
    return {
      stats: p.engine?.()?.interpolation ?? null,
      status: s.upscaleStatus,
      interp: s.interpolationStatus,
      hud: s.upscaleStats,
      t: v?.currentTime ?? 0,
      paused: v?.paused ?? true,
      dropped: q?.droppedVideoFrames ?? 0,
      total: q?.totalVideoFrames ?? 0,
    }
  })

await page.evaluate(
  (path) => window.__player.commands.openVideoFromPath(path),
  CLIP
)
await wait(3000)
await page.evaluate(() => window.__player.commands.play())
await wait(1500)

console.log(
  `=== ${LABEL}  clip=${CLIP.split(/[\\/]/).pop()}  seek=${SEEK}s  window=${WINDOW_S}s`
)
for (const c of configs) {
  // Full off → on so every config starts from a fresh renderer.
  await page.evaluate(() =>
    window.__player.store.getState().updateUpscale({ enabled: false })
  )
  await wait(800)
  await page.evaluate((cfg) => {
    window.__player.store.getState().updateUpscale({
      enabled: true,
      modeId: cfg.mode ?? 'builtin-mode-a',
      performanceTier: cfg.tier,
      targetResolution: cfg.target ?? 'x2',
      frameInterpolation: {
        enabled: true,
        resolution: cfg.fres,
        mode: 'multiplier',
        multiplier: cfg.mult,
      },
    })
  }, c)
  await wait(SETTLE_MS)
  await page.evaluate((s) => window.__player.commands.seekTo(Number(s)), SEEK)
  await wait(2500)
  const a = await snap()
  const gpus = []
  for (let i = 0; i < WINDOW_S; i++) {
    await wait(1000)
    gpus.push(gpu())
  }
  const b = await snap()
  const name = `${c.mode ?? 'A'}/${c.tier}/fi${c.fres}/${c.mult}x`.padEnd(30)
  if (!a.stats || !b.stats) {
    console.log(
      `${name} no interpolator (status=${b.status} interp=${b.interp})`
    )
    continue
  }
  const d = (k) => b.stats[k] - a.stats[k]
  const pairs =
    d('produced') +
    d('duplicate') +
    d('sceneCut') +
    d('cadence') +
    d('late') +
    d('bypassed') +
    d('stale')
  const sorted = gpus.filter(Number.isFinite).sort((x, y) => x - y)
  const g = sorted.length ? sorted[Math.floor(sorted.length / 2)] : Number.NaN
  console.log(
    `${name} gen=${(d('generatedFrames') / WINDOW_S).toFixed(1).padStart(5)}/s  ` +
      `pairs=${pairs} ok=${d('produced')} dup=${d('duplicate')} elided=${d('elided')} ` +
      `late=${d('late')} byp=${d('bypassed')} cut=${d('sceneCut')} cad=${d('cadence')} ` +
      `stale=${d('stale')} pool=${d('poolSaturated')} arms=${d('bypassArms')} ` +
      `ceil=${b.stats.factorCeiling}/${b.stats.maxFactor} | ` +
      `wait=${b.stats.averageQueueWaitMs.toFixed(1)} cls=${b.stats.averageClassifyMs.toFixed(1)}/${b.stats.maximumClassifyMs.toFixed(0)} ` +
      `slack=${b.stats.averageSlackMs.toFixed(1)}ms | GPU=${g}% ` +
      `vdrop=${b.dropped - a.dropped}/${b.total - a.total} hud=${b.hud?.fps ?? '-'}(${b.hud?.sourceFps ?? '-'}+${b.hud?.generatedFps ?? '-'})`
  )
}
await cdp.close()

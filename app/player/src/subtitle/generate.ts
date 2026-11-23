/**
 * AI subtitle scheduler (CONTRACT §34): Japanese speech → Chinese subtitles,
 * generated around the playhead while you watch.
 *
 * Two phases, both driven by `pump()` — every event (a recognized clip, a
 * finished translation batch, a playhead tick, a seek, play/pause) re-runs
 * the same decision instead of chaining callbacks:
 *
 * - **burst** — on 生成字幕 (and on a seek into audio nobody recognized yet)
 *   the player AUTO-PAUSES, borrows the GPU (recognize the next ~5 min in ~4 s,
 *   then translate until the Chinese reaches ~1 min ahead), gives the GPU back
 *   (the servers are killed — VRAM returns) and AUTO-RESUMES. The user never
 *   pauses by hand; the overlay offers 直接播放, and pressing play ends the
 *   burst early. GPU use is sequential: one model at a time (8 GB card with
 *   Anime4K at its top tier: ~3.1 GB free; whisper ≈ 1 GB, Murasaki ≈ 2.5 GB).
 * - **follow** — while playing, CPU recognition + CPU translation keep ahead
 *   of the playhead (measured CPU: recognition 4.7x realtime, translation
 *   ~4x), stopping when far enough ahead.
 *
 * Every async result is checked against the session that started it: a media
 * switch (or stop) makes all in-flight work land in a dead session.
 */
import { type AiGenState, usePlayerStore } from '@/store/playerStore'
import { errorMessage } from '@/ui/shared'
import {
  type AiLine,
  addInterval,
  buildCues,
  coveredEnd,
  DISPLAY_MODE_LABEL,
  type ExportKind,
  exportCues,
  hasPendingBefore,
  type Interval,
  mergeLines,
  nextDisplayMode,
  parseTrack,
  pickBatch,
  serializeTrack,
  zhFrontier,
} from './aiTrack'
import { serializeSrt } from './format'
import * as native from './native'

// --- tuning (measured values: PLAN-subtitle-v2.md §1) ---

/** Burst recognition span: GPU does 300 s in ~4 s; CPU 60 s in ~13 s. */
const BURST_ASR_GPU = 300
const BURST_ASR_CPU = 60
/** Burst ends once the Chinese reaches this far past the playhead. */
const BURST_ZH_GPU = 60
const BURST_ZH_CPU = 25
/** Follow: start recognizing when less than this is recognized ahead… */
const ASR_LEAD_LOW = 150
/** …and recognize this much per run (two 120 s clips). */
const FOLLOW_ASR_SPAN = 240
/** Follow: translate while the Chinese is less than this far ahead. */
const MT_LEAD_TARGET = 120
/** Free VRAM (MiB) needed to put an engine on the GPU (measured + margin). */
const ASR_GPU_MB = 1300
const MT_GPU_MB = 2800
/** Progress-bar drags fire many seeks; act once they settle. */
const SEEK_DEBOUNCE_MS = 450
/** Consecutive failures before an engine is given up for this video. */
const MAX_FAILURES = 3
const SAVE_DEBOUNCE_MS = 3000
const MOUNT_THROTTLE_MS = 250

/** Assets generation cannot run without. */
export const REQUIRED_ASSETS = [
  'whisper-turbo-q5',
  'murasaki-4b',
  'whisper-cpu',
  'llama',
] as const

// --- injectable edges (tests swap them) ---

export interface Backend {
  transcribe: typeof native.transcribe
  cancelTranscribe: typeof native.cancelTranscribe
  translateBatch: typeof native.translateBatch
  releaseEngines: typeof native.releaseEngines
  gpuInfo: typeof native.gpuInfo
  assets: typeof native.subtitleAssets
  loadCache: typeof native.loadSubtitleCache
  saveCache: typeof native.saveSubtitleCache
  log: (line: string) => void
}

const nativeBackend: Backend = {
  transcribe: native.transcribe,
  cancelTranscribe: native.cancelTranscribe,
  translateBatch: native.translateBatch,
  releaseEngines: native.releaseEngines,
  gpuInfo: native.gpuInfo,
  assets: native.subtitleAssets,
  loadCache: native.loadSubtitleCache,
  saveCache: native.saveSubtitleCache,
  log: native.subtitleLog,
}

let backend: Backend = nativeBackend

/** Play/pause hooks PlayerHost provides (the scheduler never owns <video>). */
export interface PlayerHooks {
  play(): void
  pause(): void
}

let player: PlayerHooks | null = null

export const bindGenerationPlayer = (hooks: PlayerHooks | null): void => {
  player = hooks
}

// --- session ---

interface Burst {
  from: number
  to: number
  zhTarget: number
  asrGpu: boolean
  mtGpu: boolean
  /** the video was playing when the burst began → resume it afterwards */
  resumeAfter: boolean
  /** the pause has taken effect; a later `playing` = the user pressed play */
  pausedSeen: boolean
  asrDone: boolean
  /** GPU recognizer released before translation started */
  released: boolean
}

interface Session {
  id: number
  path: string
  lines: AiLine[]
  asr: Interval[]
  phase: 'burst' | 'follow'
  burst: Burst | null
  asrRun: {
    from: number
    to: number
    cursor: number
    gpu: boolean
    cancelling: boolean
  } | null
  mtRunning: boolean
  asrGpu: boolean | null
  mtGpu: boolean | null
  asrFailures: number
  mtFailures: number
  /** our cues are on screen (a later foreign mount = the user switched away) */
  mounted: boolean
  saveTimer: ReturnType<typeof setTimeout> | null
  mountTimer: ReturnType<typeof setTimeout> | null
}

let session: Session | null = null
let nextId = 1
let seekTimer: ReturnType<typeof setTimeout> | null = null
let unsubscribe: (() => void) | null = null

const store = () => usePlayerStore.getState()
const alive = (s: Session) => session === s && store().media?.path === s.path

const playhead = () => {
  const t = store().playback.currentTime
  return Number.isFinite(t) && t > 0 ? t : 0
}

const duration = () => {
  const d = store().playback.duration
  return Number.isFinite(d) && d > 0 ? d : Number.POSITIVE_INFINITY
}

// --- mounting ---

const mountNow = (s: Session) => {
  if (!alive(s) || !s.lines.length) return
  const st = store()
  const mode = st.subtitleSettings.aiDisplay
  const cues = buildCues(s.lines, mode)
  const translated = s.lines.filter((l) => typeof l.zh === 'string').length
  const running = s.asrRun !== null || s.mtRunning || s.phase === 'burst'
  st.setSubtitles(cues, {
    label: `AI 字幕 · ${DISPLAY_MODE_LABEL[mode]}${running ? ' · 生成中' : ''}`,
    count: s.lines.length,
    kind: 'generated',
  })
  s.mounted = true
  backend.log(`mount: lines=${s.lines.length} zh=${translated} mode=${mode}`)
}

const mount = (s: Session) => {
  if (s.mountTimer) return
  s.mountTimer = setTimeout(() => {
    s.mountTimer = null
    mountNow(s)
  }, MOUNT_THROTTLE_MS)
}

const scheduleSave = (s: Session) => {
  if (s.saveTimer) clearTimeout(s.saveTimer)
  s.saveTimer = setTimeout(() => {
    s.saveTimer = null
    void flushSave(s)
  }, SAVE_DEBOUNCE_MS)
}

const flushSave = async (s: Session) => {
  if (s.saveTimer) {
    clearTimeout(s.saveTimer)
    s.saveTimer = null
  }
  if (!s.lines.length) return
  try {
    await backend.saveCache(s.path, serializeTrack(s.lines, s.asr))
  } catch (error) {
    backend.log(`cache save failed: ${errorMessage(error)}`)
  }
}

// --- status for the UI ---

const publish = (s: Session) => {
  if (!alive(s)) return
  const t = playhead()
  const frontier = zhFrontier(s.lines, s.asr, t)
  const b = s.burst
  let progress = 0
  let stage: 'recognizing' | 'translating' | 'waiting' = 'waiting'
  if (b) {
    const asrTo = coveredEnd(s.asr, b.from) ?? b.from
    const asrPart = Math.min(1, (asrTo - b.from) / Math.max(1, b.to - b.from))
    const zhPart = Math.min(1, (frontier - t) / Math.max(1, b.zhTarget - t))
    progress = b.asrDone ? 0.4 + 0.6 * Math.max(0, zhPart) : 0.4 * asrPart
    stage = b.asrDone ? 'translating' : 'recognizing'
  } else if (s.asrRun) {
    stage = 'recognizing'
  } else if (s.mtRunning) {
    stage = 'translating'
  }
  const next = {
    phase: s.phase,
    stage,
    progress: Math.round(progress * 100) / 100,
    asrGpu: s.asrGpu,
    mtGpu: s.mtGpu,
    // 直接播放 is offered once the line at the playhead (or the next one) has
    // its Chinese.
    ready: frontier >= t + 5,
    // follow: playback ran past the finished Chinese
    behind:
      s.phase === 'follow' &&
      frontier <= t + 0.5 &&
      t < duration() - 1 &&
      (s.asrRun !== null || s.mtRunning),
  }
  const prev = store().aiGen
  if (
    !prev ||
    prev.phase !== next.phase ||
    prev.stage !== next.stage ||
    prev.progress !== next.progress ||
    prev.asrGpu !== next.asrGpu ||
    prev.mtGpu !== next.mtGpu ||
    prev.ready !== next.ready ||
    prev.behind !== next.behind
  ) {
    store().setAiGen(next)
  }
}

// --- engines ---

const runAsr = (s: Session, from: number, to: number, gpu: boolean) => {
  s.asrRun = { from, to, cursor: from, gpu, cancelling: false }
  backend.log(`asr run [${from.toFixed(1)}, ${to.toFixed(1)}) gpu=${gpu}`)
  const finish = (failed: string | null) => {
    if (session !== s) return
    s.asrRun = null
    if (failed !== null) {
      s.asrFailures += 1
      backend.log(`asr failed (${s.asrFailures}): ${failed}`)
      if (s.asrFailures >= MAX_FAILURES) fail(s, `语音识别失败：${failed}`)
    } else {
      s.asrFailures = 0
    }
    if (s.burst && failed !== null) s.burst.asrDone = true
    mount(s)
    pump()
  }
  void backend
    .transcribe(s.path, from, to, { gpu }, (event) => {
      if (session !== s || !s.asrRun) return
      const run = s.asrRun
      switch (event.type) {
        case 'started':
          s.asrGpu = event.gpu
          break
        case 'clip': {
          const fresh = event.cues.map((c) => ({
            start: c.start,
            end: c.end,
            ja: c.text,
          }))
          s.lines = mergeLines(s.lines, fresh)
          s.asr = addInterval(s.asr, { from: run.cursor, to: event.coveredTo })
          run.cursor = event.coveredTo
          mount(s)
          scheduleSave(s)
          pump()
          break
        }
        case 'done':
          s.asr = addInterval(s.asr, { from: run.cursor, to: event.coveredTo })
          if (s.burst) s.burst.asrDone = true
          finish(null)
          break
        case 'cancelled':
          finish(null)
          break
        case 'failed':
          finish(event.message)
          break
      }
    })
    .catch((error) => finish(errorMessage(error)))
}

/** Stop the current recognition run (once); its `cancelled` event pumps. */
const cancelAsr = (s: Session) => {
  const run = s.asrRun
  if (!run || run.cancelling) return
  run.cancelling = true
  void backend.cancelTranscribe().catch(() => undefined)
}

const runMt = (s: Session, gpu: boolean, until: number) => {
  const t = playhead()
  const batch = pickBatch(s.lines, t, native.TRANSLATE_BATCH)
    .map((i) => s.lines[i])
    .filter((line) => line.start < until)
  if (!batch.length) return
  s.mtRunning = true
  void backend
    .translateBatch(
      batch.map((l) => l.ja),
      gpu
    )
    .then((result) => {
      if (session !== s) return
      s.mtGpu = result.gpu
      // Line objects survive re-sorting, so assigning by reference is safe.
      batch.forEach((line, k) => {
        line.zh = result.lines[k] ?? null
      })
      s.mtFailures = 0
      scheduleSave(s)
    })
    .catch((error) => {
      if (session !== s) return
      s.mtFailures += 1
      backend.log(`mt failed (${s.mtFailures}): ${errorMessage(error)}`)
      if (s.mtFailures >= MAX_FAILURES) {
        // Give the batch up (it stays Japanese) so playback is not blocked.
        for (const line of batch) line.zh = null
        fail(s, `翻译失败，显示原文：${errorMessage(error)}`)
        s.mtFailures = 0
      }
    })
    .finally(() => {
      if (session !== s) return
      s.mtRunning = false
      mount(s)
      pump()
    })
}

const fail = (s: Session, message: string) => {
  if (!alive(s)) return
  store().setAiError(message)
  store().showOsd(message.slice(0, 40), '⚠')
}

// --- the decision loop ---

const pump = (): void => {
  const s = session
  if (!s || !alive(s)) return
  const src = store().subtitleSource
  if (s.mounted && src && src.kind !== 'generated') {
    // The user mounted another subtitle: generation for this video stops.
    backend.log('foreign subtitle mounted — stopping generation')
    void stopGeneration()
    return
  }
  if (s.phase === 'burst') pumpBurst(s)
  else pumpFollow(s)
  publish(s)
}

const pumpBurst = (s: Session) => {
  const b = s.burst
  if (!b) return
  if (!b.asrDone) {
    if (s.asrRun) {
      // A CPU follow run (e.g. started by the seek itself) must not stand in
      // for the GPU burst: stop it, the burst run starts once it winds down.
      if (b.asrGpu && !s.asrRun.gpu) cancelAsr(s)
      return
    }
    const from = coveredEnd(s.asr, b.from) ?? b.from
    if (from >= b.to - 1) {
      b.asrDone = true
    } else {
      runAsr(s, from, b.to, b.asrGpu)
      return
    }
  }
  if (s.asrRun) return // a cancelled run is still winding down
  if (!b.released) {
    // Hand the GPU from the recognizer to the translator.
    b.released = true
    void backend
      .releaseEngines(true)
      .catch(() => undefined)
      .finally(() => pump())
    return
  }
  const t = playhead()
  const target = Math.min(b.zhTarget, b.to, duration())
  if (
    zhFrontier(s.lines, s.asr, t) >= target - 0.5 ||
    !hasPendingBefore(s.lines, target)
  ) {
    if (!s.mtRunning) endBurst(s, 'done')
    return
  }
  if (!s.mtRunning && s.mtFailures < MAX_FAILURES) runMt(s, b.mtGpu, target)
}

const pumpFollow = (s: Session) => {
  const t = playhead()
  const end = duration()
  if (!s.asrRun && s.asrFailures < MAX_FAILURES) {
    const from = coveredEnd(s.asr, t) ?? t
    if (from - t < ASR_LEAD_LOW && from < end - 1) {
      // Stop where a later covered span begins (no re-recognition).
      const nextCovered = s.asr.find((iv) => iv.from > from + 0.5)?.from
      const to = Math.min(
        from + FOLLOW_ASR_SPAN,
        end,
        nextCovered ?? Number.POSITIVE_INFINITY
      )
      if (to - from >= 1) runAsr(s, from, to, false)
    }
  }
  if (!s.mtRunning) {
    const frontier = zhFrontier(s.lines, s.asr, t)
    if (frontier - t < MT_LEAD_TARGET) runMt(s, false, t + MT_LEAD_TARGET + 30)
  }
}

// --- burst ---

/** Decide what may use the GPU right now. */
const gpuPlan = async (): Promise<{ asr: boolean; mt: boolean }> => {
  if (!store().subtitleSettings.aiGpu) return { asr: false, mt: false }
  let freeMb: number | null = null
  let cuda = false
  try {
    const [info, report] = await Promise.all([
      backend.gpuInfo(),
      backend.assets(),
    ])
    freeMb = info.freeMb
    cuda = report.assets.some((a) => a.id === 'whisper-cuda' && a.installed)
  } catch {
    // unknown → try the GPU translator only; Rust falls back on failure
  }
  return {
    // CUDA recognition only exists for NVIDIA (freeMb known).
    asr: cuda && freeMb !== null && freeMb >= ASR_GPU_MB,
    // Vulkan translation: unknown VRAM → try; Rust retries on the CPU.
    mt: freeMb === null || freeMb >= MT_GPU_MB,
  }
}

const startBurst = async (s: Session, reason: string) => {
  const gpu = await gpuPlan()
  if (!alive(s) || s.phase === 'burst') return
  const t = playhead()
  const end = duration()
  const playing = store().playback.playing
  s.phase = 'burst'
  s.burst = {
    from: t,
    to: Math.min(t + (gpu.asr ? BURST_ASR_GPU : BURST_ASR_CPU), end),
    zhTarget: Math.min(t + (gpu.mt ? BURST_ZH_GPU : BURST_ZH_CPU), end),
    asrGpu: gpu.asr,
    mtGpu: gpu.mt,
    resumeAfter: playing,
    pausedSeen: !playing,
    asrDone: false,
    released: false,
  }
  backend.log(
    `burst (${reason}) at ${t.toFixed(1)}: asrGpu=${gpu.asr} mtGpu=${gpu.mt} resume=${playing}`
  )
  // A follow run elsewhere must not hold the recognizer.
  if (s.asrRun && !(s.asrRun.from <= t + 1 && s.asrRun.to > t)) cancelAsr(s)
  if (playing) player?.pause()
  pump()
}

type BurstEnd = 'done' | 'skip' | 'user-play'

const endBurst = (s: Session, why: BurstEnd) => {
  const b = s.burst
  if (!b) return
  s.phase = 'follow'
  s.burst = null
  backend.log(`burst end: ${why}`)
  // Whatever still sits on the GPU goes now (in-flight work on it fails and
  // is retried on the CPU by follow).
  if (s.asrRun?.gpu) cancelAsr(s)
  void backend.releaseEngines(true).catch(() => undefined)
  if (why !== 'user-play' && b.resumeAfter) player?.play()
  mount(s)
  pump()
}

// --- session lifecycle ---

const watchStore = () => {
  if (unsubscribe) return
  let lastTime = -1
  let lastPlaying = store().playback.playing
  let lastMode = store().subtitleSettings.aiDisplay
  unsubscribe = usePlayerStore.subscribe((st) => {
    // Track play/pause even between sessions, or the burst's own pause
    // reads as "no change" and a later user play goes unnoticed.
    const playing = st.playback.playing
    const playingChanged = playing !== lastPlaying
    lastPlaying = playing
    const s = session
    if (!s) return
    if (playingChanged) {
      const b = s.burst
      if (b) {
        if (!playing) b.pausedSeen = true
        else if (b.pausedSeen) endBurst(s, 'user-play')
      }
    }
    if (st.subtitleSettings.aiDisplay !== lastMode) {
      lastMode = st.subtitleSettings.aiDisplay
      if (s.mounted) mountNow(s)
    }
    const t = st.playback.currentTime
    if (Math.abs(t - lastTime) >= 1) {
      lastTime = t
      pump()
    }
  })
}

/** Missing required assets, or null when everything is installed. */
const missingAssets = async (): Promise<string[] | null> => {
  try {
    const report = await backend.assets()
    const missing = REQUIRED_ASSETS.filter(
      (id) => !report.assets.some((a) => a.id === id && a.installed)
    )
    return missing.length ? [...missing] : null
  } catch (error) {
    return [errorMessage(error)]
  }
}

const openSession = async (path: string): Promise<Session | null> => {
  if (session?.path === path) return session
  await stopSession(true)
  const s: Session = {
    id: nextId++,
    path,
    lines: [],
    asr: [],
    phase: 'follow',
    burst: null,
    asrRun: null,
    mtRunning: false,
    asrGpu: null,
    mtGpu: null,
    asrFailures: 0,
    mtFailures: 0,
    mounted: false,
    saveTimer: null,
    mountTimer: null,
  }
  session = s
  watchStore()
  try {
    const cached = parseTrack(await backend.loadCache(path))
    if (session !== s) return null
    if (cached) {
      s.lines = cached.lines
      s.asr = cached.asr
    }
  } catch {
    // no cache — start fresh
  }
  return session === s ? s : null
}

const stopSession = async (releaseAll: boolean) => {
  const s = session
  session = null
  if (seekTimer) {
    clearTimeout(seekTimer)
    seekTimer = null
  }
  if (!s) return
  if (s.mountTimer) clearTimeout(s.mountTimer)
  const wasBurst = s.burst
  if (s.asrRun) await backend.cancelTranscribe().catch(() => undefined)
  await backend.releaseEngines(!releaseAll).catch(() => undefined)
  await flushSave(s)
  if (wasBurst?.resumeAfter && store().media?.path === s.path) player?.play()
  if (store().media?.path === s.path) {
    store().setAiGen(null)
    if (s.mounted && store().subtitleSource?.kind === 'generated') {
      const mode = store().subtitleSettings.aiDisplay
      store().setSubtitles(buildCues(s.lines, mode), {
        label: `AI 字幕 · ${DISPLAY_MODE_LABEL[mode]}`,
        count: s.lines.length,
        kind: 'generated',
      })
    }
  }
}

// --- public API ---

/** 生成字幕: auto-pause, borrow the GPU, resume — then keep up while playing. */
export const startGeneration = async (): Promise<void> => {
  const st = store()
  const path = st.media?.path
  if (!path) return
  st.setAiError(null)
  const missing = await missingAssets()
  if (missing) {
    st.showOsd('请先在 设置 → 字幕 下载 AI 字幕组件', '⬇')
    st.openSettingsAt('subtitle')
    backend.log(`missing assets: ${missing.join(',')}`)
    return
  }
  if (!st.subtitleSettings.visible) st.updateSubtitleSettings({ visible: true })
  const s = await openSession(path)
  if (!s) return
  if (s.lines.length) mountNow(s)
  const t = playhead()
  const ready = zhFrontier(s.lines, s.asr, t) >= t + BURST_ZH_CPU
  if (ready) {
    // Already generated here (cache): no pause needed, just keep up.
    pump()
  } else {
    await startBurst(s, 'start')
  }
}

/** 直接播放: end the burst now; follow (CPU) does the rest. */
export const skipBurst = (): void => {
  const s = session
  if (s?.burst) endBurst(s, 'skip')
}

/** Stop generating for this video (what was generated stays on screen). */
export const stopGeneration = async (): Promise<void> => {
  await stopSession(false)
}

/** Media switch / close: stop everything and free every engine. */
export const resetGeneration = (): void => {
  void stopSession(true)
}

export const isGenerating = (): boolean => session !== null

/**
 * On open: a video that was generated before gets its subtitles back at once
 * (from the cache) and generation resumes on the CPU — no pause, no GPU.
 * Returns false when there is no cache (or the assets are gone).
 */
export const restoreGeneratedTrack = async (path: string): Promise<boolean> => {
  let cached: ReturnType<typeof parseTrack> = null
  try {
    cached = parseTrack(await backend.loadCache(path))
  } catch {
    return false
  }
  if (!cached?.lines.length || store().media?.path !== path) return false
  if (store().subtitleSource) return false
  if (await missingAssets()) {
    // Show what exists; nothing can be generated further.
    const mode = store().subtitleSettings.aiDisplay
    store().setSubtitles(buildCues(cached.lines, mode), {
      label: `AI 字幕 · ${DISPLAY_MODE_LABEL[mode]}`,
      count: cached.lines.length,
      kind: 'generated',
    })
    return true
  }
  const s = await openSession(path)
  if (!s || store().subtitleSource) return false
  mountNow(s)
  pump()
  return true
}

/** A user seek: settle, then fill a gap with a burst or re-aim follow. */
export const onUserSeek = (target: number): void => {
  if (!session) return
  if (seekTimer) clearTimeout(seekTimer)
  seekTimer = setTimeout(() => {
    seekTimer = null
    const s = session
    if (!s || !alive(s) || s.burst) return
    const run = s.asrRun
    if (run && !(target >= run.from - 1 && target < run.to)) cancelAsr(s)
    const uncovered = coveredEnd(s.asr, target) === null
    if (
      uncovered &&
      store().subtitleSettings.aiGpu &&
      target < duration() - 5
    ) {
      void startBurst(s, 'seek')
    } else {
      pump()
    }
  }, SEEK_DEBOUNCE_MS)
}

/** Short status text for buttons and the source picker. */
export const aiGenLabel = (gen: AiGenState): string => {
  if (gen.phase === 'burst') {
    const what = gen.stage === 'translating' ? '翻译' : '识别'
    return `${what} ${Math.round(gen.progress * 100)}%`
  }
  if (gen.behind) return '生成中'
  return gen.stage === 'waiting' ? '跟随' : '后台生成'
}

/** Cycle 双语 → 译文 → 原文 (keyboard T). */
export const cycleDisplayMode = (): void => {
  const st = store()
  const mode = nextDisplayMode(st.subtitleSettings.aiDisplay)
  st.updateSubtitleSettings({ aiDisplay: mode })
  st.showOsd(`AI 字幕 · ${DISPLAY_MODE_LABEL[mode]}`, '🎬')
}

/** The current video's generated lines as .srt text (null when none). */
export const exportGenerated = async (
  kind: ExportKind
): Promise<string | null> => {
  const path = store().media?.path
  if (!path) return null
  let lines = session?.path === path ? session.lines : null
  if (!lines) {
    try {
      lines = parseTrack(await backend.loadCache(path))?.lines ?? null
    } catch {
      lines = null
    }
  }
  return lines?.length ? serializeSrt(exportCues(lines, kind)) : null
}

// --- tests ---

export const __test = {
  setBackend: (b: Backend | null) => {
    backend = b ?? nativeBackend
  },
  reset: () => {
    session = null
    if (seekTimer) clearTimeout(seekTimer)
    seekTimer = null
    unsubscribe?.()
    unsubscribe = null
  },
  session: () => session,
}

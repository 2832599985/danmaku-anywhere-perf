import { invoke } from '@tauri-apps/api/core'
import { usePlayerStore } from '@/store/playerStore'
import { errorMessage } from '@/ui/shared'
import { serializeSrt } from './format'
import {
  cancelTranscribe,
  modelStatus,
  subtitleLog,
  transcribe,
} from './native'
import type { SubtitleCue } from './types'

/**
 * PLAYHEAD-FOLLOWING subtitle generation (the "分段生成 while playing" shape).
 *
 * Recognition never spans the whole file — that is what stalled the player.
 * Instead each task covers a short bounded WINDOW ahead of the playhead
 * (150 s of audio ≈ a ~2 s task) and stops. As playback nears the covered
 * end, the next window opens automatically; a seek into an uncovered spot
 * (debounced so a progress-bar drag doesn't storm cancels) re-anchors the
 * window to the new playhead. Inference is cheap (measured: 60 s audio
 * decodes in ~0.7 s on CPU), so the pipeline is paced by ffmpeg extraction.
 *
 * Coverage is tracked on a 30 s grid and cues MERGE across windows (dedup by
 * start|text). The durable artifact is <video>.srt, reloaded as a sibling on
 * next open (stage 1 path), marking the whole covered span so no re-run.
 */

const WINDOW_SECS = 150
/** Open the next window when the playhead is this close to the covered end. */
const TRIGGER_SECS = 60
/** Seek restart is debounced by this much (progress-bar drag = many seeks). */
const SEEK_DEBOUNCE_MS = 450
/** Progress-log throttle: only log playhead advancement once per this many s. */
const LOG_STEP_SECS = 15

/** Seconds of covered audio ahead of the playhead per video path. */
const coveredUntil = new Map<string, number>()
/** Session cue cache per video path — merged across windows. */
const cueCache = new Map<string, SubtitleCue[]>()
/**
 * Monotonic id of the CURRENT media. Every async step (window run, debounced
 * timers, cancel waits) captures it and stops acting when it no longer
 * matches — the path-based identity check reads the same initially but two
 * windows of the SAME old path can both resolve after the user reopens that
 * path; mediaSession disambiguates stale generations.
 */
let mediaSession = 0
let followingStarted = false
let seekTimer: number | null = null
let lastLogPlayhead = Number.NEGATIVE_INFINITY

export const isGenerating = (): boolean =>
  usePlayerStore.getState().sttStatus !== 'idle'

/** Drop all session state for a media switch (called by PlayerHost). */
export const resetGeneration = (): void => {
  mediaSession += 1
  coveredUntil.clear()
  cueCache.clear()
  if (seekTimer) {
    window.clearTimeout(seekTimer)
    seekTimer = null
  }
  lastLogPlayhead = Number.NEGATIVE_INFINITY
}

const mergeCues = (
  existing: SubtitleCue[],
  incoming: SubtitleCue[]
): SubtitleCue[] => {
  const seen = new Set(existing.map((c) => `${c.start.toFixed(2)}|${c.text}`))
  const fresh = incoming.filter(
    (c) => !seen.has(`${c.start.toFixed(2)}|${c.text}`)
  )
  return [...existing, ...fresh].sort((a, b) => a.start - b.start)
}

const mountTrack = (videoPath: string, session: number): void => {
  const store = usePlayerStore.getState()
  if (session !== mediaSession || store.media?.path !== videoPath) return
  const cues = cueCache.get(videoPath)
  if (!cues?.length) return
  subtitleLog(
    `mount track: cues=${cues.length} visible=${store.subtitleSettings.visible}`
  )
  store.setSubtitles(cues, {
    label: store.sttStatus === 'idle' ? '语音识别' : '语音识别 · 生成中',
    count: cues.length,
    kind: 'generated',
  })
}

const ingest = (
  videoPath: string,
  cues: SubtitleCue[],
  session: number
): void => {
  if (!cues.length) return
  if (session !== mediaSession) return
  const merged = mergeCues(cueCache.get(videoPath) ?? [], cues)
  cueCache.set(videoPath, merged)
  mountTrack(videoPath, session)
}

const saveSrt = async (
  videoPath: string,
  cues: SubtitleCue[],
  session: number
): Promise<void> => {
  const base = videoPath.replace(/\.[^./\\]+$/, '')
  try {
    await invoke('subtitle_save_srt', {
      path: `${base}.srt`,
      contents: serializeSrt(cues),
    })
  } catch {
    // read-only dir — the session cache still works.
  }
}

/**
 * Run ONE window [start, end]. Resolves with the window's cues when it
 * finishes (null on media-switch/cancel/stale). Progress is per-window so
 * the capsule never sits "100% then keeps running".
 */
const runWindow = (
  videoPath: string,
  start: number,
  end: number,
  session: number
): Promise<SubtitleCue[] | null> =>
  new Promise((resolve, reject) => {
    let settled = false
    const finish = (fn: () => void) => {
      if (settled) return
      settled = true
      fn()
    }
    void transcribe(videoPath, start, end, (event) => {
      if (
        session !== mediaSession ||
        usePlayerStore.getState().media?.path !== videoPath
      ) {
        void cancelTranscribe()
        finish(() => resolve(null))
        return
      }
      const s = usePlayerStore.getState()
      switch (event.type) {
        case 'extracting':
          s.setSttStatus('extracting', event.percent ?? 0)
          break
        case 'transcribing':
          s.setSttStatus('transcribing', event.percent)
          break
        case 'partial':
          ingest(videoPath, event.cues, session)
          break
        case 'done':
          finish(() => resolve(event.cues))
          break
        case 'cancelled':
          finish(() => resolve(null))
          break
        case 'failed':
          finish(() => reject(new Error(event.message)))
          break
        default:
          break
      }
    }).catch((error) => {
      finish(() =>
        reject(error instanceof Error ? error : new Error(String(error)))
      )
    })
  })

/** Pre-flight the recognition model; route to the download UI if missing. */
const ensureModel = async (): Promise<boolean> => {
  try {
    const statuses = await modelStatus()
    const sv = statuses.find((m) => m.id === 'sensevoice-int8')
    if (sv?.downloaded) return true
    const store = usePlayerStore.getState()
    store.showOsd('请先在 设置 → 字幕 下载语音识别模型', '⬇')
    store.openSettingsAt('subtitle')
    return false
  } catch {
    // status check failed (non-Tauri/IPC) — let the pipeline surface errors.
    return true
  }
}

/**
 * Core scheduler: if the playhead lacks coverage ahead (or `force` re-anchors
 * to it for a fresh seek/backfill), open one window from there. No-op while a
 * task runs. This is the ONLY place windows are created, so the playhead-
 * following logic and the manual button share one path (no restart storms).
 */
const scheduleWindow = async (force: boolean): Promise<void> => {
  const session = mediaSession
  const store = usePlayerStore.getState()
  const videoPath = store.media?.path
  if (!videoPath) {
    subtitleLog('schedule skip: no media')
    return
  }
  if (store.sttStatus !== 'idle') {
    return
  }
  const playhead = store.playback.currentTime
  if (!Number.isFinite(playhead) || playhead < 0) {
    return
  }

  // Log playhead-driven checks sparsely; the full log drowned real events.
  const verbose = force || playhead - lastLogPlayhead >= LOG_STEP_SECS
  if (playhead - lastLogPlayhead >= 3) lastLogPlayhead = playhead

  const until = coveredUntil.get(videoPath) ?? 0
  // Enough coverage already ahead and not a forced re-anchor → nothing to do.
  if (!force && playhead < until - TRIGGER_SECS) {
    if (verbose) {
      subtitleLog(
        `schedule skip: covered ahead until=${until.toFixed(1)} playhead=${playhead.toFixed(1)}`
      )
    }
    return
  }

  // Forced (button / seek): start AT the playhead. Auto-extend: continue from
  // where coverage ended (but never before the playhead).
  const start = force ? playhead : Math.max(playhead, until)
  const duration = store.playback.duration
  const cap = Number.isFinite(duration) ? duration : start + WINDOW_SECS
  const end = Math.min(start + WINDOW_SECS, cap)
  if (end - start < 5) {
    return // at the very end / nothing left
  }
  subtitleLog(
    `window open: [${start.toFixed(1)}, ${end.toFixed(1)}] force=${force}`
  )

  if (!(await ensureModel())) return
  if (session !== mediaSession) return

  store.setSttError(null)
  store.setSttStatus('extracting', 0)
  let cues: SubtitleCue[] | null = null
  let failed: string | null = null
  try {
    cues = await runWindow(videoPath, start, end, session)
  } catch (error) {
    failed = errorMessage(error)
  }
  const after = usePlayerStore.getState()
  if (session !== mediaSession || after.media?.path !== videoPath) return
  // Advance the watermark BEFORE going idle: setSttStatus('idle') fires the
  // follow subscription synchronously, and an unset watermark made the
  // scheduler immediately open an OVERLAPPING window (duplicate
  // transcriptions of the same audio). Clamp to the actual end so a window
  // cancelled at the video tail doesn't claim silence it never checked.
  coveredUntil.set(videoPath, Math.max(coveredUntil.get(videoPath) ?? 0, end))
  after.setSttStatus('idle')
  if (failed !== null) {
    // A cancellation surfaces as an error through runWindow's reject path
    // (cancel during extraction/inference); treat CANCELLED-ish messages as
    // a quiet stop, not a user-facing failure.
    if (!/cancel|取消/i.test(failed)) {
      after.setSttError(failed)
      after.showOsd(`字幕生成失败: ${failed.slice(0, 60)}`, '⬇')
    }
    return
  }
  if (cues) {
    ingest(videoPath, cues, session)
    mountTrack(videoPath, session)
    void saveSrt(videoPath, cueCache.get(videoPath) ?? [], session)
  }
}

/** Manual entry point (Controls capsule / settings button). */
export const startGeneration = async (): Promise<void> => {
  const store = usePlayerStore.getState()
  // Clicking 生成字幕 expresses the intent to SEE subtitles — if the layer
  // was toggled off in an earlier session (persisted), turning it back on
  // here is what the user means; a hidden layer reads as "feature broken".
  if (!store.subtitleSettings.visible) {
    subtitleLog('visible was false — turning subtitles back on')
    store.updateSubtitleSettings({ visible: true })
    store.showOsd('字幕已开启', '🎬')
  }
  startFollowing()
  await scheduleWindow(true)
}

/**
 * Begin playhead-following: a throttled watcher opens the next window when
 * playback nears the covered end. Only acts once a generated track is
 * mounted (i.e. the user pressed 生成字幕) — external .srt files never spawn
 * inference. Subscribing to the store keeps this out of PlayerHost.
 */
export const startFollowing = (): void => {
  if (followingStarted) return
  followingStarted = true
  let lastSeen = -1
  usePlayerStore.subscribe((state) => {
    // generated source mounted, idle, actually playing, and the playhead
    // stepped forward since the last check → evaluate extending coverage.
    if (state.subtitleSource?.kind !== 'generated') return
    if (state.sttStatus !== 'idle') return
    if (!state.playback.playing) return
    const t = state.playback.currentTime
    if (Math.abs(t - lastSeen) < 3) return
    lastSeen = t
    void scheduleWindow(false)
  })
}

/**
 * A user seek. While following, a seek into uncovered audio re-anchors the
 * window to the new playhead — but DEBOUNCED, because a progress-bar drag
 * fires this on every pointer move and an immediate cancel+restart each time
 * is what made the player stutter.
 */
export const onUserSeek = (_targetTime: number): void => {
  const store = usePlayerStore.getState()
  if (store.media?.path && store.subtitleSource?.kind === 'generated') {
    if (seekTimer) window.clearTimeout(seekTimer)
    seekTimer = window.setTimeout(() => {
      seekTimer = null
      // If a window is mid-run for the OLD position, drop it so the new
      // playhead gets its own window promptly.
      if (isGenerating()) {
        void cancelTranscribe()
      }
      void scheduleWindow(true)
    }, SEEK_DEBOUNCE_MS)
  }
}

export const cancelGeneration = async (): Promise<void> => {
  await cancelTranscribe()
}

/** Reset session state (tests). */
export const resetCoverageForTests = (): void => {
  resetGeneration()
}

import { invoke } from '@tauri-apps/api/core'
import { usePlayerStore } from '@/store/playerStore'
import { errorMessage } from '@/ui/shared'
import { serializeSrt } from './format'
import { cancelTranscribe, modelStatus, transcribe } from './native'
import type { SubtitleCue } from './types'

/**
 * Playhead-following subtitle generation:
 *
 * - startGeneration begins recognition AT THE CURRENT PLAYBACK POSITION (the
 *   Rust pipeline covers playhead→end, then back-fills 0→playhead). What is
 *   on screen gets subtitles first — not a whole-file batch job.
 * - Region coverage tracking: every 30 s grid cell that has been recognized
 *   (either live-streamed or from a previous run / an on-disk .srt) is
 *   marked covered. The track MERGES cues across runs instead of replacing.
 * - Seek handling: when the user seeks OUTSIDE covered cells while a task is
 *   running, the current task is cancelled and one restarts from the new
 *   playhead (covered cells are not re-transcribed). When no task is
 *   running, a mounted generated track simply follows via the controller's
 *   seeked handler; if the seek lands in an uncovered area, generation
 *   restarts from there automatically.
 */

const GRID_SECS = 30

/** Grid cell index for a time position. */
const cellOf = (time: number): number => Math.floor(time / GRID_SECS)

/** Covered grid cells per video path (session). Disk .srt is the durable cache. */
const coveredCells = new Map<string, Set<number>>()

/** Session cue cache per video path — merged across runs. */
const cueCache = new Map<string, SubtitleCue[]>()

export const hasGeneratedCache = (videoPath: string): boolean =>
  cueCache.has(videoPath)

export const isGenerating = (): boolean =>
  usePlayerStore.getState().sttStatus !== 'idle'

/** Mark cells covered by the given cue list (with the lead/tail polish margins). */
const markCovered = (videoPath: string, cues: SubtitleCue[]): void => {
  const covered = coveredCells.get(videoPath) ?? new Set<number>()
  for (const cue of cues) {
    const from = cellOf(Math.max(0, cue.start - 0.5))
    const to = cellOf(cue.end)
    for (let cell = from; cell <= to; cell++) covered.add(cell)
  }
  coveredCells.set(videoPath, covered)
}

/** True when the position lies in a cell that has NOT been recognized yet. */
const isUncovered = (videoPath: string, time: number): boolean => {
  const covered = coveredCells.get(videoPath)
  if (!covered) return true
  return !covered.has(cellOf(time))
}

/** Merge a new cue batch into the track, dropping exact duplicates, sorted. */
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

/** Mount (or re-mount) the merged cue track for the current video. */
const mountTrack = (videoPath: string): void => {
  const store = usePlayerStore.getState()
  if (store.media?.path !== videoPath) return
  const cues = cueCache.get(videoPath)
  if (!cues?.length) return
  store.setSubtitles(cues, {
    label: store.sttStatus === 'idle' ? '语音识别' : '语音识别 · 生成中',
    count: cues.length,
    kind: 'generated',
  })
}

/** Ingest a cue batch: mark coverage, merge, mount. */
const ingest = (videoPath: string, cues: SubtitleCue[]): void => {
  if (!cues.length) return
  markCovered(videoPath, cues)
  const merged = mergeCues(cueCache.get(videoPath) ?? [], cues)
  cueCache.set(videoPath, merged)
  mountTrack(videoPath)
}

/**
 * Called on user seek while a generated track is mounted. If the target is
 * in an uncovered region, (re)start recognition from there. Covered targets
 * need nothing — the SubtitleController's seeked handler follows the track.
 */
export const onUserSeek = (targetTime: number): void => {
  const store = usePlayerStore.getState()
  const path = store.media?.path
  if (!path) return
  if (store.subtitleSource?.kind !== 'generated') return
  if (!isUncovered(path, targetTime)) return
  // Uncovered target: (re)start the pipeline from the playhead. If a task is
  // running it gets cancelled first (single-flight is enforced Rust-side,
  // but we wait for the cancel to land to avoid the "already running" error).
  void (async () => {
    if (store.sttStatus !== 'idle') {
      await cancelTranscribe()
      // give the registry a beat to clear the slot
      await new Promise((r) => setTimeout(r, 150))
    }
    await startGeneration()
  })()
}

const saveSrt = async (
  videoPath: string,
  cues: SubtitleCue[]
): Promise<void> => {
  const base = videoPath.replace(/\.[^./\\]+$/, '')
  try {
    await invoke('subtitle_save_srt', {
      path: `${base}.srt`,
      contents: serializeSrt(cues),
    })
  } catch {
    // e.g. read-only directory — the session cache still works.
  }
}

export const startGeneration = async (): Promise<void> => {
  const store = usePlayerStore.getState()
  const videoPath = store.media?.path
  if (!videoPath || store.sttStatus !== 'idle') return
  const rawDuration = store.playback.duration
  const duration = Number.isFinite(rawDuration) ? rawDuration : null
  // Follow the playhead: start where the user is watching.
  const startAt = store.playback.currentTime

  // Model pre-flight: without SenseVoice the Rust side fails anyway — check
  // up front and route the user straight to the download UI instead of a
  // silent failure.
  try {
    const statuses = await modelStatus()
    const senseVoice = statuses.find((m) => m.id === 'sensevoice-int8')
    if (!senseVoice?.downloaded) {
      store.showOsd('请先在 设置 → 字幕 下载语音识别模型', '⬇')
      store.openSettingsAt('subtitle')
      return
    }
  } catch {
    // Status check failed (non-Tauri / IPC hiccup) — let the Rust pipeline
    // surface the real error instead of blocking here.
  }

  store.setSttError(null)
  store.setSttStatus('extracting', 0)
  try {
    // The session track persists across runs; seed coverage from it so
    // re-runs don't re-transcribe already-covered cells.
    const cues = await new Promise<SubtitleCue[] | null>((resolve, reject) => {
      let settled = false
      const finish = (fn: () => void) => {
        if (settled) return
        settled = true
        fn()
      }
      void transcribe(videoPath, duration, startAt, (event) => {
        // A media switch invalidates the run; stop the Rust side now.
        if (usePlayerStore.getState().media?.path !== videoPath) {
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
            ingest(videoPath, event.cues)
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
    const after = usePlayerStore.getState()
    if (after.media?.path !== videoPath) return
    if (!cues) {
      after.setSttStatus('idle') // cancelled — merged partials stay mounted
      return
    }
    ingest(videoPath, cues)
    void saveSrt(videoPath, cueCache.get(videoPath) ?? cues)
    if (usePlayerStore.getState().media?.path === videoPath) {
      const s = usePlayerStore.getState()
      s.setSttStatus('idle')
      mountTrack(videoPath) // refresh the label now it's done
    }
  } catch (error) {
    const s = usePlayerStore.getState()
    if (s.media?.path !== videoPath) return
    const message = errorMessage(error)
    s.setSttError(message)
    s.setSttStatus('idle')
    s.showOsd(`字幕生成失败: ${message.slice(0, 60)}`, '⚠')
  }
}

export const cancelGeneration = async (): Promise<void> => {
  await cancelTranscribe()
}

/** Reset session state for a media switch (cueCache stays per-path). */
export const resetCoverageForTests = (): void => {
  coveredCells.clear()
  cueCache.clear()
}

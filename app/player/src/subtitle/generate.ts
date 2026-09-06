import { invoke } from '@tauri-apps/api/core'
import { usePlayerStore } from '@/store/playerStore'
import { errorMessage } from '@/ui/shared'
import { serializeSrt } from './format'
import { cancelTranscribe, modelStatus, transcribe } from './native'
import type { SubtitleCue } from './types'

/**
 * Orchestrates "generate Chinese subtitles from audio": Rust transcribe →
 * stream cues to the layer as they arrive → cache to disk (<video>.srt).
 *
 * Every await boundary re-checks that the same video is still playing (the
 * store's stt state is reset on media switch, so stale writes must be
 * guarded); a media switch also cancels the in-flight Rust task via the
 * Channel handler below.
 */

/** Session cache of generated tracks per video path. Disk is the durable cache. */
const cache = new Map<string, SubtitleCue[]>()

export const hasGeneratedCache = (videoPath: string): boolean =>
  cache.has(videoPath)

export const isGenerating = (): boolean =>
  usePlayerStore.getState().sttStatus !== 'idle'

/**
 * Resolve when the Rust pipeline finishes. Resolves null on cancel, rejects
 * on failure. The Channel handler also cancels the Rust task when the video
 * changes mid-run.
 */
const runTranscribe = (
  videoPath: string,
  duration: number | null
): Promise<SubtitleCue[] | null> =>
  new Promise<SubtitleCue[] | null>((resolve, reject) => {
    let settled = false
    const finish = (fn: () => void) => {
      if (settled) return
      settled = true
      fn()
    }
    void transcribe(videoPath, duration, (event) => {
      // A media switch invalidates the run; stop the Rust side now.
      if (usePlayerStore.getState().media?.path !== videoPath) {
        void cancelTranscribe()
        finish(() => resolve(null))
        return
      }
      const store = usePlayerStore.getState()
      switch (event.type) {
        case 'extracting':
          store.setSttStatus('extracting', event.percent ?? 0)
          break
        case 'transcribing':
          store.setSttStatus('transcribing', event.percent)
          break
        case 'partial': {
          // Streaming subtitles: append recognized cues to the mounted track
          // while inference keeps running. Keep appending unless the user
          // mounted an explicit file meanwhile.
          if (
            store.subtitleSource?.kind === 'generated' ||
            store.subtitleCues.length === 0
          ) {
            const merged = [...store.subtitleCues, ...event.cues]
            cache.set(videoPath, merged)
            store.setSubtitles(merged, {
              label: '语音识别 · 生成中',
              count: merged.length,
              kind: 'generated',
            })
          }
          break
        }
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
    const cues = await runTranscribe(videoPath, duration)
    const after = usePlayerStore.getState()
    if (after.media?.path !== videoPath) return
    if (!cues) {
      after.setSttStatus('idle') // cancelled
      return
    }
    cache.set(videoPath, cues)
    after.setSubtitles(cues, {
      label: '语音识别',
      count: cues.length,
      kind: 'generated',
    })
    void saveSrt(videoPath, cues)
    if (usePlayerStore.getState().media?.path === videoPath) {
      usePlayerStore.getState().setSttStatus('idle')
    }
  } catch (error) {
    const s = usePlayerStore.getState()
    if (s.media?.path !== videoPath) return
    const message = errorMessage(error)
    s.setSttError(message)
    s.setSttStatus('idle')
    // The capsule disappears when idle — surface failures via OSD too or
    // they are invisible.
    s.showOsd(`字幕生成失败: ${message.slice(0, 60)}`, '⚠')
  }
}

export const cancelGeneration = async (): Promise<void> => {
  await cancelTranscribe()
}

/**
 * Thin invoke wrappers over the Rust subtitle commands (src-tauri/src/
 * subtitle/). Kept OUT of the Platform adapter on purpose: these are desktop
 * player features, not environment plumbing — the browser build simply never
 * imports this module.
 */
import { Channel, invoke } from '@tauri-apps/api/core'
import type { SubtitleCue } from './types'

/** Progress/result events streamed by subtitle_transcribe. */
export type TranscribeEvent =
  | { type: 'extracting'; percent: number | null }
  | { type: 'transcribing'; percent: number }
  | { type: 'translating'; percent: number }
  | { type: 'done'; cues: SubtitleCue[] }
  | { type: 'cancelled' }
  | { type: 'failed'; message: string }

export type ModelDownloadEvent =
  | { type: 'downloading'; percent: number }
  | { type: 'verifying' }
  | { type: 'extracting' }
  | { type: 'done' }
  | { type: 'failed'; message: string }

export interface ModelStatus {
  id: string
  downloaded: boolean
  /** shipped inside the app — nothing to download */
  bundled: boolean
  size_bytes: number
  size_label: string
}

/** Start a transcription task; events stream through `onEvent`. Single-flight. */
export const transcribe = (
  path: string,
  durationSecs: number | null,
  language: 'auto' | 'ja' | 'zh',
  onEvent: (event: TranscribeEvent) => void
): Promise<void> =>
  invoke('subtitle_transcribe', {
    path,
    durationSecs,
    language,
    onEvent: new Channel<TranscribeEvent>(onEvent),
  })

export const cancelTranscribe = (): Promise<void> => invoke('subtitle_cancel')

export const modelStatus = (): Promise<ModelStatus[]> =>
  invoke('subtitle_model_status')

export const downloadModel = (
  id: string,
  onEvent: (event: ModelDownloadEvent) => void
): Promise<void> =>
  invoke('subtitle_model_download', {
    id,
    onEvent: new Channel<ModelDownloadEvent>(onEvent),
  })

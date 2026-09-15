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
  /** incremental cues: mount while inference continues (streaming subtitles) */
  | { type: 'partial'; cues: SubtitleCue[] }
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

/**
 * One subtitle stream INSIDE the container (matroska/mp4/webm), as reported by
 * ffprobe. The webview cannot see these — `<video>` only knows WebVTT tracks
 * mounted as a sidecar `<track>` — so they are probed and converted in Rust
 * (src-tauri/src/subtitle/tracks.rs).
 */
export interface EmbeddedTrack {
  /** Absolute stream index — the id used for extraction and for the picker. */
  index: number
  /** ffmpeg codec name: `subrip`, `ass`, `mov_text`, `hdmv_pgs_subtitle`, … */
  codec: string
  /** Language tag as stored (`chi`, `jpn`, `eng`), when the muxer wrote one. */
  language: string | null
  /** Stream title (fansub groups put 简体/繁体 here). */
  title: string | null
  /** false = bitmap track (PGS/VobSub): listed, but not convertible to text. */
  text: boolean
  default: boolean
  forced: boolean
}

/** Subtitle streams embedded in the container (empty when there are none). */
export const listEmbeddedTracks = (path: string): Promise<EmbeddedTrack[]> =>
  invoke('subtitle_list_tracks', { path })

/** One embedded track converted to SRT text. Rejects for bitmap tracks. */
export const extractEmbeddedTrack = (
  path: string,
  index: number
): Promise<string> => invoke('subtitle_extract_track', { path, index })

/** Start a transcription task for the window [startSecs, endSecs]; events
 * stream through `onEvent`. Single-flight. Bounded lookahead ahead of the
 * playhead — the frontend opens the next window as playback nears endSecs. */
export const transcribe = (
  path: string,
  startSecs: number,
  endSecs: number,
  onEvent: (event: TranscribeEvent) => void
): Promise<void> =>
  invoke('subtitle_transcribe', {
    path,
    startSecs,
    endSecs,
    onEvent: new Channel<TranscribeEvent>(onEvent),
  })

export const cancelTranscribe = (): Promise<void> => invoke('subtitle_cancel')

/** Frontend diagnostic line → app_log_dir/subtitle.log (see logging.rs). */
export const subtitleLog = (line: string): void => {
  void invoke('subtitle_log', { line }).catch(() => undefined)
}

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

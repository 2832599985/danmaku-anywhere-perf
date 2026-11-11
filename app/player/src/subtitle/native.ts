/**
 * Thin invoke wrappers over the Rust subtitle commands (src-tauri/src/
 * subtitle/). Kept OUT of the Platform adapter on purpose: these are desktop
 * player features, not environment plumbing — the browser build simply never
 * imports this module.
 */
import { Channel, invoke } from '@tauri-apps/api/core'

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

/** One embedded track as text, ready for `parseSubtitleText`. */
export interface ExtractedTrack {
  /** An ASS script (styles and positions intact) or SRT, per `format`. */
  text: string
  format: 'ass' | 'srt'
  /** false = only the requested span was read; the whole track follows. */
  complete: boolean
}

/**
 * Read an embedded track. With `span` (seconds on the video clock) only that
 * stretch is read — fast enough to show before the whole track is in; without
 * it the whole track is read (and every other text track of the file with it,
 * in the same pass). Rejects for bitmap tracks.
 */
export const extractEmbeddedTrack = (
  path: string,
  index: number,
  span?: { start: number; end: number }
): Promise<ExtractedTrack> =>
  invoke('subtitle_extract_track', { path, index, span: span ?? null })

/**
 * Tell the backend which file is open: probes and extractions of any other
 * file are killed instead of reading on in the background (empty = none).
 */
export const focusEmbeddedExtraction = (path: string): Promise<void> =>
  invoke('subtitle_extract_focus', { path })

/** How the backend reports an extraction it stopped on purpose. */
export const EXTRACTION_CANCELLED = '__cancelled__'

// ---------------------------------------------------------------------------
// AI subtitles (CONTRACT §34): recognition + translation sidecars
// ---------------------------------------------------------------------------

/** Cue shape the recognizer streams (absolute seconds, Japanese text). */
export interface RecognizedCue {
  start: number
  end: number
  text: string
}

export type TranscribeEvent =
  /** engine up; gpu = what actually serves (GPU may have fallen back) */
  | { type: 'started'; gpu: boolean }
  /** one clip done: its cues + how far recognition now reaches */
  | { type: 'clip'; cues: RecognizedCue[]; coveredTo: number }
  | { type: 'done'; coveredTo: number; language: string | null }
  | { type: 'cancelled' }
  | { type: 'failed'; message: string }

/** Recognize [from, to) of the video. Single-flight; resolves once started. */
export const transcribe = (
  path: string,
  from: number,
  to: number,
  options: { gpu: boolean; firstClip?: number },
  onEvent: (event: TranscribeEvent) => void
): Promise<void> =>
  invoke('subtitle_transcribe', {
    path,
    from,
    to,
    gpu: options.gpu,
    firstClip: options.firstClip ?? null,
    language: 'ja',
    onEvent: new Channel<TranscribeEvent>(onEvent),
  })

/** Stop the running recognition (its server is killed — VRAM returns). */
export const cancelTranscribe = (): Promise<void> => invoke('subtitle_cancel')

/** Lines per translate call (Rust rejects more). */
export const TRANSLATE_BATCH = 8

/** One batch ja → zh. null entries = keep the Japanese. */
export const translateBatch = (
  lines: string[],
  gpu: boolean
): Promise<{ lines: Array<string | null>; gpu: boolean }> =>
  invoke('subtitle_translate', { lines, gpu })

/** Kill engines: gpuOnly frees VRAM and keeps CPU engines warm. */
export const releaseEngines = (gpuOnly: boolean): Promise<void> =>
  invoke('subtitle_release', { gpuOnly })

export interface GpuInfo {
  /** free VRAM in MiB (NVIDIA only); null = unknown */
  freeMb: number | null
  asrGpu: boolean | null
  mtGpu: boolean | null
}

export const gpuInfo = (): Promise<GpuInfo> => invoke('subtitle_gpu_info')

export interface AssetStatus {
  id: string
  label: string
  installed: boolean
  optional: boolean
  bytes: number
  partialBytes: number
}

export interface AssetsReport {
  dataDir: string
  defaultDir: string
  freeBytes: number | null
  assets: AssetStatus[]
}

export const subtitleAssets = (): Promise<AssetsReport> =>
  invoke('subtitle_assets')

export const setSubtitleDataDir = (path: string): Promise<AssetsReport> =>
  invoke('subtitle_set_data_dir', { path })

export type AssetDownloadEvent =
  | { type: 'downloading'; received: number; total: number }
  | { type: 'verifying' }
  | { type: 'extracting' }
  | { type: 'done' }
  | { type: 'failed'; message: string }

export const downloadAsset = (
  id: string,
  onEvent: (event: AssetDownloadEvent) => void
): Promise<void> =>
  invoke('subtitle_asset_download', {
    id,
    onEvent: new Channel<AssetDownloadEvent>(onEvent),
  })

/** Per-video generation state (opaque JSON, see aiTrack.serializeTrack). */
export const loadSubtitleCache = (path: string): Promise<string | null> =>
  invoke('subtitle_cache_load', { path })

export const saveSubtitleCache = (
  path: string,
  contents: string
): Promise<void> => invoke('subtitle_cache_save', { path, contents })

/** Write an exported .srt to a path picked in a save dialog. */
export const saveSrt = (path: string, contents: string): Promise<void> =>
  invoke('subtitle_save_srt', { path, contents })

/** Frontend diagnostic line → app_log_dir/subtitle.log (see logging.rs). */
export const subtitleLog = (line: string): void => {
  void invoke('subtitle_log', { line }).catch(() => undefined)
}

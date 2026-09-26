/**
 * Embedded (in-container) subtitle tracks: choosing one and mounting it.
 *
 * Fansub releases carry their subtitles INSIDE the file —
 * `[Nix-Raws] … [CATCHPLAY WEB-DL 1080p AVC AAC][SC_TC].mkv` holds two SubRip
 * streams, 简体 and 繁體. The webview cannot reach them (`<video>` only exposes
 * WebVTT tracks mounted as a sidecar `<track>`), so Rust demuxes them
 * (`src-tauri/src/subtitle/tracks.rs`) and this module turns the result into
 * cues for the renderer the player already has.
 *
 * Auto-mount order on open is: sibling `.srt`/`.ass`/`.vtt` file next to the
 * video → embedded track → (manual) speech-to-text. A user's own subtitle file
 * is the more explicit choice, so it still wins.
 */

import { usePlayerStore } from '@/store/playerStore'
import { parseSubtitleText } from './format'
import {
  type EmbeddedTrack,
  EXTRACTION_CANCELLED,
  type ExtractedTrack,
  extractEmbeddedTrack,
  listEmbeddedTracks,
  subtitleLog,
} from './native'

/** Language tags that mean "Chinese", however the muxer spelled it. */
const CHINESE_TAGS = new Set([
  'zh',
  'chi',
  'zho',
  'cmn',
  'chs',
  'cht',
  'zh-cn',
  'zh-tw',
  'zh-hans',
  'zh-hant',
])

/** Fallback when the tags carry no language: fansub titles say it in words. */
const CHINESE_WORDS = [
  '简体',
  '繁体',
  '繁體',
  '简中',
  '繁中',
  '中文',
  'chinese',
]

/**
 * Script markers inside a Chinese track's title/tag. Fansub files routinely
 * carry both (`[SC_TC]` → "Chinese Simplified" + "Chinese Traditional"): pick
 * Simplified, which is what a Simplified-Chinese user is reading. Single
 * letters are deliberately absent — `sc`/`tc` match inside unrelated words.
 */
const SIMPLIFIED_WORDS = ['简', 'simplified', 'chs', 'hans', 'zh-cn']
const TRADITIONAL_WORDS = ['繁', 'traditional', 'cht', 'hant', 'zh-tw', 'zh-hk']

const LANGUAGE_LABELS: Record<string, string> = {
  zh: '中文',
  chi: '中文',
  zho: '中文',
  cmn: '中文',
  chs: '简体中文',
  cht: '繁體中文',
  'zh-cn': '简体中文',
  'zh-hans': '简体中文',
  'zh-tw': '繁體中文',
  'zh-hant': '繁體中文',
  ja: '日本語',
  jpn: '日本語',
  en: 'English',
  eng: 'English',
  ko: '한국어',
  kor: '한국어',
}

/** Human name for a language tag, or null when we do not recognise it. */
export const languageLabel = (language: string | null): string | null => {
  if (!language) return null
  return LANGUAGE_LABELS[language.toLowerCase()] ?? language.toUpperCase()
}

/** True when the track looks Chinese (script preference starts here). */
export const isChinese = (track: EmbeddedTrack): boolean => {
  if (track.language && CHINESE_TAGS.has(track.language.toLowerCase())) {
    return true
  }
  const title = track.title?.toLowerCase() ?? ''
  return CHINESE_WORDS.some((word) => title.includes(word))
}

/**
 * Short name for a track: the muxer's title if it wrote one (fansub groups put
 * 简体/繁体 there), else the language name, else the codec.
 */
export const trackName = (track: EmbeddedTrack): string =>
  track.title?.trim() || languageLabel(track.language) || track.codec

/**
 * What the picker (and the mounted-source label) shows: the short name plus the
 * codec, so two streams of the same language stay distinguishable.
 */
export const trackLabel = (track: EmbeddedTrack): string => {
  const parts = [trackName(track), track.codec]
  if (track.forced) parts.push('强制')
  return parts.join(' · ')
}

/** True when a track's title/tag carries one of `words`. */
const mentions = (track: EmbeddedTrack, words: string[]): boolean => {
  const haystack = `${track.title ?? ''} ${track.language ?? ''}`.toLowerCase()
  return words.some((word) => haystack.includes(word))
}

/**
 * The track to mount when the user has not chosen one.
 *
 * Text tracks only (a bitmap track cannot become cues). Chinese first — a
 * Chinese-speaking user wants the 简体/繁體 stream, not the Japanese closed
 * captions; within Chinese, 简体 over 繁體 when the file offers both; then
 * ffmpeg's `default` disposition; then whatever comes first. `forced` tracks
 * (partial translations for foreign dialogue) are used only when nothing else
 * exists, otherwise the screen would stay mostly empty.
 */
export const pickDefaultTrack = (
  tracks: EmbeddedTrack[]
): EmbeddedTrack | null => {
  const text = tracks.filter((track) => track.text)
  if (text.length === 0) return null
  const nonForced = text.filter((track) => !track.forced)
  const pool = nonForced.length > 0 ? nonForced : text
  const chinese = pool.filter(isChinese)
  const preferred = chinese.length > 0 ? chinese : pool
  const first = (list: EmbeddedTrack[]): EmbeddedTrack =>
    list.find((track) => track.default) ?? list[0]
  if (chinese.length > 0) {
    const simplified = chinese.filter(
      (track) =>
        mentions(track, SIMPLIFIED_WORDS) && !mentions(track, TRADITIONAL_WORDS)
    )
    if (simplified.length > 0) return first(simplified)
  }
  return first(preferred)
}

/**
 * Outcome of one mount attempt. The reasons are distinct because the picker
 * reports them differently: an empty track is the file's fault, a media switch
 * or a subtitle mounted meanwhile is not a failure at all.
 */
export type EmbeddedMountResult =
  | 'mounted'
  | 'no-media'
  | 'media-switched'
  | 'already-mounted'
  | 'empty'

/** Seconds of the timeline read before / after the playhead for the first paint. */
const SPAN_BEFORE_SECS = 20
const SPAN_AFTER_SECS = 120

/**
 * Bumped by every mount attempt. A newer attempt (a pick while the open-time
 * mount is still reading, two picks in a row) supersedes the older one at its
 * next checkpoint, so whichever the user chose LAST is what stays on screen.
 */
let mountGeneration = 0

const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

/**
 * Where playback is — or is about to be: right after opening, the resume
 * point has not been applied yet but is where the first lines are needed.
 */
const expectedPlayhead = (path: string): number => {
  const store = usePlayerStore.getState()
  const now = store.playback.currentTime
  if (now > 1) return now
  const resume = store.progress[path]?.time
  return resume !== undefined && resume > 3 ? resume : 0
}

const cuesOf = (extracted: ExtractedTrack) =>
  parseSubtitleText(extracted.text, `embedded.${extracted.format}`)

/**
 * Read one embedded track and mount it.
 *
 * Two reads, so the first lines are up before the whole track is in: the
 * minutes around the playhead first (a fraction of the file), then the whole
 * track, swapped in when it lands. The whole-track read also caches every
 * other text track of the file, so switching tracks later is instant. When
 * the whole track is already cached the first read answers with it.
 *
 * `auto` is the open-time path: it must never replace a subtitle that got
 * mounted while ffmpeg was running (a dropped `.chs.ass`, a picker choice). A
 * manual pick is the user's explicit choice and replaces whatever is showing.
 * Either way the second read only replaces the first one — never something
 * mounted in between.
 */
export const mountEmbeddedTrack = async (
  index: number,
  { auto = false }: { auto?: boolean } = {}
): Promise<EmbeddedMountResult> => {
  const path = usePlayerStore.getState().media?.path
  if (!path) {
    subtitleLog(`embedded mount skip: no local path (stream #${index})`)
    return 'no-media'
  }
  mountGeneration += 1
  const generation = mountGeneration
  const track = usePlayerStore
    .getState()
    .embeddedTracks.find((item) => item.index === index)
  const label = `内封 · ${track ? trackLabel(track) : `#${index}`}`

  /** Why this attempt may not mount now, or null when it may. */
  const blocked = (
    owner: unknown
  ): 'media-switched' | 'already-mounted' | null => {
    const store = usePlayerStore.getState()
    if (store.media?.path !== path) return 'media-switched'
    if (generation !== mountGeneration) return 'already-mounted'
    if (owner !== undefined && store.subtitleSource !== owner) {
      return 'already-mounted'
    }
    return null
  }

  // --- first read: the minutes around the playhead ---
  const at = expectedPlayhead(path)
  let first: ExtractedTrack | null = null
  try {
    first = await extractEmbeddedTrack(path, index, {
      start: Math.max(0, at - SPAN_BEFORE_SECS),
      end: at + SPAN_AFTER_SECS,
    })
  } catch (error) {
    if (errorText(error) === EXTRACTION_CANCELLED) return 'media-switched'
    // A span that cannot be read (a container that will not seek) is not
    // fatal: the whole-track read below decides.
    subtitleLog(`embedded span failed (#${index}): ${errorText(error)}`)
  }
  const early = blocked(auto ? null : undefined)
  if (early) {
    subtitleLog(`embedded mount drop (${early}): stream #${index}`)
    return early
  }
  const store = usePlayerStore.getState()
  if (first?.complete) {
    // The whole track was already cached: done in one step.
    const cues = cuesOf(first)
    if (cues.length === 0) return 'empty'
    store.setSubtitles(cues, { label, count: cues.length, kind: 'file' }, index)
    subtitleLog(`embedded mount: #${index} ${label} cues=${cues.length}`)
    return 'mounted'
  }
  if (first) {
    // Mounted even when empty (nobody speaks in these minutes): a pick must
    // take the previous track off screen now, not when the whole read lands.
    const cues = cuesOf(first)
    store.setSubtitles(
      cues,
      { label, count: cues.length, kind: 'file', loading: true },
      index
    )
    subtitleLog(`embedded span: #${index} cues=${cues.length} around ${at}s`)
  }
  // What must still be on screen for the whole track to replace it.
  const owner = usePlayerStore.getState().subtitleSource
  const ownsScreen = () =>
    owner?.loading === true &&
    usePlayerStore.getState().subtitleSource === owner

  // --- second read: the whole track ---
  let full: ExtractedTrack
  try {
    full = await extractEmbeddedTrack(path, index)
  } catch (error) {
    if (errorText(error) === EXTRACTION_CANCELLED) return 'media-switched'
    // Take the partial track down only if it is still ours on screen.
    if (!blocked(owner) && ownsScreen()) {
      usePlayerStore.getState().clearSubtitles()
    }
    throw error
  }
  const late = blocked(owner)
  if (late) {
    subtitleLog(`embedded full drop (${late}): stream #${index}`)
    return late
  }
  const cues = cuesOf(full)
  if (cues.length === 0) {
    if (ownsScreen()) usePlayerStore.getState().clearSubtitles()
    subtitleLog(`embedded mount skip: 0 cues (stream #${index})`)
    return 'empty'
  }
  usePlayerStore
    .getState()
    .setSubtitles(cues, { label, count: cues.length, kind: 'file' }, index)
  subtitleLog(`embedded mount: #${index} ${label} cues=${cues.length}`)
  return 'mounted'
}

/**
 * Probe the container and publish the result to the store. Returns the tracks
 * (empty when the file has none, or when the probe is not possible — the
 * reason lands in `embeddedError` so 设置 → 字幕 can say it out loud instead of
 * claiming the file has no subtitles).
 *
 * This runs on EVERY open, even when a sibling `.srt` wins the auto-mount: the
 * picker must be able to offer the embedded tracks anyway, and "没有内封字幕"
 * has to be a fact rather than "we never looked".
 */
export const loadEmbeddedTracks = async (
  videoPath: string
): Promise<EmbeddedTrack[]> => {
  try {
    const tracks = await listEmbeddedTracks(videoPath)
    const store = usePlayerStore.getState()
    // Switched away while ffprobe ran — the answer is about the wrong file.
    if (store.media?.path !== videoPath) return []
    store.setEmbeddedTracks(tracks)
    store.setEmbeddedError(null)
    subtitleLog(
      `embedded probe: ${tracks.length} track(s) [${tracks
        .map((track) => `${track.index}:${track.codec}`)
        .join(' ')}]`
    )
    return tracks
  } catch (error) {
    const message = errorText(error)
    // Stopped on purpose: another file was opened while it ran.
    if (message === EXTRACTION_CANCELLED) return []
    subtitleLog(`embedded probe failed: ${message}`)
    const store = usePlayerStore.getState()
    if (store.media?.path === videoPath) {
      store.setEmbeddedTracks([])
      store.setEmbeddedError(message)
    }
    return []
  }
}

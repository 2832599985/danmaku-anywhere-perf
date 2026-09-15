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
 * Convert one embedded track and mount it. Returns false when nothing was
 * mounted (no media, the video switched while ffmpeg ran, empty/unparsable
 * cues) — callers then leave the danmaku and the OSD alone.
 */
export const mountEmbeddedTrack = async (index: number): Promise<boolean> => {
  const path = usePlayerStore.getState().media?.path
  if (!path) {
    subtitleLog(`embedded mount skip: no local path (stream #${index})`)
    return false
  }
  const raw = await extractEmbeddedTrack(path, index)
  const store = usePlayerStore.getState()
  // The video may have been switched (or a subtitle file mounted by hand)
  // while ffmpeg was running — never clobber that.
  if (store.media?.path !== path) {
    subtitleLog(`embedded mount drop: media switched (stream #${index})`)
    return false
  }
  const cues = parseSubtitleText(raw, 'embedded.srt')
  if (cues.length === 0) {
    subtitleLog(`embedded mount skip: 0 cues (stream #${index})`)
    return false
  }
  const track = store.embeddedTracks.find((item) => item.index === index)
  const label = `内封 · ${track ? trackLabel(track) : `#${index}`}`
  store.setSubtitles(cues, { label, count: cues.length, kind: 'file' })
  store.setActiveEmbeddedTrack(index)
  subtitleLog(`embedded mount: #${index} ${label} cues=${cues.length}`)
  return true
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
    const store = usePlayerStore.getState()
    const message = error instanceof Error ? error.message : String(error)
    subtitleLog(`embedded probe failed: ${message}`)
    if (store.media?.path === videoPath) {
      store.setEmbeddedTracks([])
      store.setEmbeddedError(message)
    }
    return []
  }
}

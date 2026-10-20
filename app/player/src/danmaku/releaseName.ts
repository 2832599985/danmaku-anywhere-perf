import { extractSeasonHint, MediaParser } from '@danmaku-anywhere/media-parser'
import { basenameWithoutExt } from './basename'

/**
 * Release-file-name parsing for the desktop player.
 *
 * The shared `MediaParser` knows explicit episode markers (E11 / Episode 11 /
 * 第11话 / S01E11 / `- 11` / `[11]`). A release name carries two more things it
 * does not care about: the fansub group and the trailing release metadata
 * (`[WebRip 1080p HEVC-10bit AAC ASSx2]`). Both poison a DanDanPlay keyword
 * search, so they are removed here — deterministically, before any network
 * call, which is what keeps auto-match working when the AI endpoint is down or
 * refuses the input.
 */

export interface ReleaseInfo {
  /** File name without directory or extension. */
  base: string
  /** Search title: group tags and release metadata removed, season kept. */
  title: string
  /** Alternative spellings worth one search each (bounded by the caller). */
  titleCandidates: string[]
  /** Local episode number (0 = unknown). */
  episode: number
  /** Episode title text that follows `第N集/话` (null = none). */
  episodeTitle: string | null
  /** Season number from `第2季` / `S2` / `Season 2` (null = unknown). */
  season: number | null
  /** Release year from the file name (null = unknown). */
  year: number | null
  /** True for a movie / 剧场版 release (no episode to resolve). */
  isMovie: boolean
  /** True for a batch pack (`01-12`); a single episode cannot be chosen. */
  isBatch: boolean
  /** Fansub group when one could be identified (display/diagnostics only). */
  group: string | null
}

/** Tokens that never belong to a show title. */
const NOISE_TOKENS = new Set([
  'x264',
  'x265',
  'h264',
  'h265',
  'hevc',
  'avc',
  'av1',
  'vp9',
  'hi10p',
  '10bit',
  '8bit',
  'aac',
  'flac',
  'ac3',
  'eac3',
  'dts',
  'dtshd',
  'truehd',
  'atmos',
  'opus',
  'mp3',
  'web',
  'webdl',
  'webrip',
  'bluray',
  'bdrip',
  'bd',
  'hdtv',
  'dvdrip',
  'tvrip',
  'remux',
  'hdr',
  'hdr10',
  'sdr',
  'dv',
  'dolby',
  'uhd',
  'fhd',
  '480p',
  '576p',
  '720p',
  '1080p',
  '1080i',
  '2160p',
  '4k',
  '8k',
  '2k',
  'mkv',
  'mp4',
  'avi',
  'flv',
  'm2ts',
  'ass',
  'assx2',
  'assx3',
  'srt',
  'chs',
  'cht',
  'gb',
  'big5',
  'jp',
  'jpn',
  'chi',
  'eng',
  'sc',
  'tc',
  '简',
  '繁',
  '简体',
  '繁體',
  '简繁',
  '中日',
  '简日',
  '繁日',
  '双语',
  '内封',
  '外挂',
  '字幕',
  'baha',
  'b-global',
  'cr',
  'amzn',
  'nf',
  'dsnp',
  'hulu',
  'abema',
])

/** True when a single token is release metadata (or carries no name). */
const isNoiseToken = (token: string): boolean => {
  const t = token.replace(/[^0-9a-z一-鿿]+/gi, '').toLowerCase()
  if (!t) return true
  if (/^\d+$/.test(t)) return true
  if (NOISE_TOKENS.has(t)) return true
  if (/^\d{1,2}月新番$/.test(t)) return true
  if (
    /^(?:简|繁|日|简日|繁日|简繁|简繁日|双语|简日双语|繁日双语|简繁双语)$/.test(
      t
    )
  ) {
    return true
  }
  if (/^(?:x26[45]|h26[45]|hevc|avc|av1)(?:10bit|8bit)?$/.test(t)) return true
  if (/^assx?\d*$/.test(t)) return true
  if (/^(?:aac|flac|ac3|eac3|dts|truehd|opus|mp3)x?\d*(?:\.\d)?$/.test(t)) {
    return true
  }
  if (/^\d{3,4}x\d{3,4}$/.test(t)) return true
  return false
}

/** True when a bracketed group holds nothing but release metadata. */
const isNoiseGroup = (content: string): boolean => {
  const inner = content.trim()
  if (!inner) return true
  if (/^\d{3,4}\s*[x×]\s*\d{3,4}$/i.test(inner)) return true
  if (/^[★☆]?\s*\d{1,2}\s*月新番$/.test(inner)) return true
  if (/(字幕组|字幕社|压制|发布|raws?|subs?)$/i.test(inner)) return true
  return inner.split(/\s+/).every(isNoiseToken)
}

/** A leading bracket group is the fansub group unless it is the whole title. */
const LEADING_GROUP = /^\s*(?:[\[【(（])([^\]】)）]*)(?:[\]】)）])\s*/

/** A trailing bracket group (title, metadata, or a group suffix). */
const BRACKET_GROUP = /[\[【(（]([^\]】)）]*)[\]】)）]/g

/**
 * Remove the fansub group from the head and unwrap a title that lives inside
 * brackets. `[Airota][Sousou no Frieren]` → `Sousou no Frieren`;
 * `[LoliHouse] Futsutsuka…` → `Futsutsuka…`; `[咒术回战 第二季]` → unchanged
 * content (nothing follows it, so it must be the title).
 */
const stripGroups = (
  input: string
): { title: string; group: string | null } => {
  let s = input.trim()
  let group: string | null = null

  for (;;) {
    const match = LEADING_GROUP.exec(s)
    if (!match) break
    const inner = match[1].trim()
    const rest = s.slice(match[0].length).trim()
    // Nothing after the bracket: this bracket IS the title.
    if (!rest) break
    // The leading bracket is metadata or a group. Either way it is not the
    // title, so drop it and keep going.
    if (!inner) {
      s = rest
      continue
    }
    if (!isNoiseGroup(inner) && !group) group = inner
    s = rest
  }

  // Remove metadata groups; unwrap remaining bracket content so a title inside
  // `【…】` becomes searchable.
  s = s.replace(BRACKET_GROUP, (_match, inner: string) => {
    if (isNoiseGroup(inner)) return ' '
    return ` ${inner} `
  })

  // Dot/underscore separators: `Show.Name.S01E07` → `Show Name S01E07`.
  s = s.replace(/([0-9A-Za-z])[._](?=[0-9A-Za-z])/g, '$1 ')

  // Loose metadata tokens and the separator debris they leave behind.
  s = s
    .split(/\s+/)
    .filter((token) => token.length > 0 && !isNoiseToken(token))
    .join(' ')

  return {
    title: s
      .replace(/[\s\-–—_·.★☆]+$/g, '')
      .replace(/^[\s\-–—_·.★☆]+/g, '')
      .replace(/\s{2,}/g, ' ')
      .trim(),
    group,
  }
}

/** Release year, ignoring numbers that are clearly episodes/resolutions. */
const yearFrom = (base: string): number | null => {
  const match = base.match(/(?:^|[^\d])((?:19|20)\d{2})(?:[^\d]|$)/)
  if (!match) return null
  const year = Number(match[1])
  const now = new Date().getFullYear()
  return year >= 1950 && year <= now + 2 ? year : null
}

const MOVIE = /剧场版|劇場版|the\s*movie|movie\b|映画/i
const BATCH = /(?:^|[^\d])\d{1,3}\s*[-~～]\s*\d{1,3}(?:[^\d]|$)/

/** Canonical search title variants, best first, deduped and bounded. */
const candidatesFor = (title: string, raw: string): string[] => {
  const out: string[] = []
  const seen = new Set<string>()
  const push = (value: string) => {
    const trimmed = value.trim()
    if (!trimmed || seen.has(trimmed)) return
    seen.add(trimmed)
    out.push(trimmed)
  }

  push(title)

  // Season notation: query the base title too. `咒术回战 第二季` → `咒术回战`;
  // `Show S2` → `Show`. The season-aware title stays first.
  const base = title
    .replace(
      /\s*(?:第\s*(?:\d+|[零一二三四五六七八九十百]+)\s*[季期部]|season\s*\d+|\d+(?:st|nd|rd|th)\s*season|part\s*\d+|S\d+)\s*$/i,
      ''
    )
    .trim()
  if (base && base !== title) push(base)

  // Slash/pipe separated alternatives: `Show / 番剧名`.
  for (const part of title.split(/\s*[/|]\s*/)) push(part)

  // A season hint as `S2` sometimes searches better than the Chinese marker.
  const season = extractSeasonHint(title)
  if (season && !/\bS\d+\b/i.test(title) && base) push(`${base} S${season}`)

  push(raw)
  return out.slice(0, 8)
}

/** Text after `第N集/话` — the episode title, when the release carries one. */
const episodeTitleFrom = (base: string): string | null => {
  const match = base.match(
    /第\s*(?:\d+|[零一二三四五六七八九十百]+)\s*[集话話]\s*([^\[\]【】()（）]{1,80})/
  )
  if (!match) return null
  const title = match[1]
    .split(/\s+/)
    .filter((token) => token.length > 0 && !isNoiseToken(token))
    .join(' ')
    .replace(/[\s\-–—_·.]+$/g, '')
    .trim()
  return title.length >= 2 ? title : null
}

/** Parse a release file path/name into everything the matcher needs. */
export const parseReleaseName = (filePath: string): ReleaseInfo => {
  const base = basenameWithoutExt(filePath)
  const parsed = new MediaParser().parse({
    title: { value: base, regex: [] },
  })
  const { title, group } = stripGroups(parsed.searchTitle)
  const fallback = stripGroups(base).title
  const resolvedTitle = title || fallback
  const episode =
    parsed.episode && Number.isFinite(parsed.episode) ? parsed.episode : 0

  return {
    base,
    title: resolvedTitle,
    titleCandidates: candidatesFor(resolvedTitle || base, base),
    episode,
    episodeTitle: episodeTitleFrom(base),
    season: extractSeasonHint(resolvedTitle) ?? extractSeasonHint(base),
    year: yearFrom(base),
    isMovie: MOVIE.test(base),
    isBatch: BATCH.test(base),
    group,
  }
}

/**
 * A compact, AI-friendly line: the cleaned title plus the episode marker.
 * Fansub groups and release tags are what make the proxy's HTML-oriented model
 * garble CJK titles (and what triggered a 500 on `[LoliHouse]` inputs).
 */
export const aiInputForFilename = (filePath: string): string => {
  const release = parseReleaseName(filePath)
  const head = release.title || release.base
  return release.episode > 0 ? `${head} - ${release.episode}` : head
}

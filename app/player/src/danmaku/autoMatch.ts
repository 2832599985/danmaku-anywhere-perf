import {
  extractSeasonHint,
  findBestMatchingSeason,
  findEpisodeByNumber,
  MediaParser,
} from '@danmaku-anywhere/media-parser'
import type { AiTitleInfo } from './ai'
import type { DdpEpisode, DdpSeason } from './ddp'

/**
 * Filename → DanDanPlay season + episode, using the SAME resolution helpers as
 * the browser extension (`@danmaku-anywhere/media-parser`).
 *
 * The previous implementation guessed: it read the LAST number in a title as
 * the episode (`第11话 [1080p]` → 1080) and then silently fell back to the
 * first episode, which is why episode 11 kept mounting episode 1. Nothing here
 * guesses anymore — when the season or the episode cannot be resolved, the
 * caller gets an `ambiguous` outcome and opens the episode picker.
 */

/** Where a candidate keyword came from (for logging/diagnostics). */
export interface SearchAttempt {
  keyword: string
  seasonCount: number
}

export type AutoMatchOutcome =
  | {
      status: 'matched'
      keyword: string
      season: DdpSeason
      episode: DdpEpisode
    }
  | {
      status: 'ambiguous'
      /** Best keyword we could build — prefills the picker's search box. */
      keyword: string
      /** Season list for the picker (already searched, so it opens populated). */
      seasons: DdpSeason[]
      /** The episode number we believe we want, for highlighting (0 = unknown). */
      targetEpisode: number
      /** Why we did not auto-mount (user-facing line for the picker). */
      reason: string
    }
  | {
      status: 'notFound'
      keyword: string
      reason: string
    }

export const REASON_NO_SEASON = '未能确定是哪一季'
export const REASON_NO_EPISODE = '未能确定是第几集'
export const REASON_NO_SEARCH = '没有搜到匹配的番剧'

/** Strip the file extension and any directory part. */
export const basenameWithoutExt = (filePath: string): string =>
  filePath
    .replace(/^.*[\\/]/, '')
    .replace(/\.[^./\\]+$/, '')
    .trim()

/**
 * Release metadata that never belongs in a search query: codecs, sources,
 * resolutions, audio formats, subtitle languages, sub-group suffixes.
 */
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
])

/** True when a single token is release metadata (or carries no name). */
const isNoiseToken = (token: string): boolean => {
  const t = token.replace(/[^0-9a-z一-鿿]+/gi, '').toLowerCase()
  if (!t) return true // pure punctuation/symbols
  if (/^\d+$/.test(t)) return true // bare numbers: episode, year, "1080"
  return NOISE_TOKENS.has(t)
}

/** True when a bracketed group holds nothing but release metadata. */
const isNoiseGroup = (content: string): boolean => {
  const inner = content.trim()
  if (!inner) return true
  // "1920X1080" / "1280x720"
  if (/^\d{3,4}\s*[x×]\s*\d{3,4}$/i.test(inner)) return true
  // "★10月新番"
  if (/^[★☆]?\s*\d{1,2}\s*月新番$/.test(inner)) return true
  // sub-group / encoder signatures
  if (/(字幕组|字幕社|压制|发布|raws?|subs?)$/i.test(inner)) return true
  return inner.split(/\s+/).every(isNoiseToken)
}

/**
 * Turn a release filename into a searchable show title: drop release metadata
 * (inside brackets or as loose tokens) and the episode marker, unwrap the
 * brackets that DO hold the title, and tidy the leftover separators.
 *
 *     "葬送的芙莉莲 - 07 [WebRip 1080p]"      → "葬送的芙莉莲"
 *     "【幻樱字幕组】★10月新番【咒术回战 第二季】【第11话】" → "咒术回战 第二季"
 *
 * This is the fallback that saves the match when the AI garbles the title
 * (it occasionally mis-transcribes CJK) or is unreachable.
 */
export const cleanFilenameTitle = (filename: string): string => {
  // Unwrap brackets: noise groups vanish, meaningful ones lose the brackets so
  // the title inside them becomes searchable.
  let s = basenameWithoutExt(filename).replace(
    /[[(（【]([^\])）】]*)[\])）】]/g,
    (_match, inner: string) => (isNoiseGroup(inner) ? ' ' : ` ${inner} `)
  )

  // Trailing / leading episode markers: " - 07", "第11话", "EP07", "07v2".
  s = s
    .replace(/\s*[-–—_]+\s*\d{1,4}(?:v\d)?\s*$/i, '')
    .replace(/第\s*\d{1,4}\s*[话話集期]\s*$/i, '')
    .replace(/\bE(?:P)?\.?\s*\d{1,4}\s*$/i, '')
    .replace(/^\s*\d{1,4}(?:v\d)?\s*[-–—_]+\s*/i, '')

  // Loose (unbracketed) release metadata: "1080p", "WEB-DL", "★10月新番".
  s = s
    .split(/\s+/)
    .filter(
      (token) =>
        token.length > 0 &&
        !/^[★☆]?\s*\d{1,2}\s*月新番$/.test(token) &&
        !isNoiseToken(token)
    )
    .join(' ')

  return s
    .replace(/[\s\-–—_·.★☆]+$/g, '')
    .replace(/^[\s\-–—_·.★☆]+/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

/**
 * Episode number from the filename itself, via the shared regexes
 * (E11 / Episode 11 / 第11话 / 第11集 / S01E11 + Chinese numerals).
 *
 * Preferred over the AI's answer when it matches: an explicit marker in the
 * name cannot be hallucinated, while the model has to infer.
 */
export const episodeFromFilename = (filename: string): number => {
  const parsed = new MediaParser().parse({
    title: { value: basenameWithoutExt(filename), regex: [] },
  })
  return parsed.episode && Number.isFinite(parsed.episode) ? parsed.episode : 0
}

/** Search keyword candidates, best first, deduped. */
export const keywordCandidates = (
  filename: string,
  ai: AiTitleInfo | null
): string[] => {
  const base = basenameWithoutExt(filename)
  const cleaned = cleanFilenameTitle(filename)
  const parsed = new MediaParser().parse({
    title: { value: base, regex: [] },
  }).searchTitle
  const raw = [
    ai?.title ?? '',
    ...(ai?.altTitles ?? []),
    // The cleaned filename outranks the raw one: it is what still works when
    // the AI garbles the title or is offline.
    cleaned === base ? '' : cleaned,
    parsed === base || parsed === cleaned ? '' : parsed,
    base,
  ]
  const seen = new Set<string>()
  const out: string[] = []
  for (const candidate of raw) {
    const trimmed = candidate.trim()
    if (!trimmed || seen.has(trimmed)) continue
    seen.add(trimmed)
    out.push(trimmed)
    // Bounded: every candidate costs a network round-trip.
    if (out.length === 5) break
  }
  return out
}

/** Target episode number: filename marker first, AI answer as the fallback. */
export const targetEpisode = (
  filename: string,
  ai: AiTitleInfo | null
): number => {
  const fromName = episodeFromFilename(filename)
  if (fromName > 0) return fromName
  return ai && ai.episode > 0 ? ai.episode : 0
}

/**
 * Decide which season the keyword means, mirroring the extension's
 * `SearchMatchingStrategy`:
 *   - exactly one search result → that one
 *   - otherwise the best title match (exact, then shortest contains, biased by
 *     a season hint such as "第二季"/"S2"/"Season 2")
 *   - no match → null (the caller asks the user instead of guessing)
 */
export const chooseSeason = (
  seasons: DdpSeason[],
  keyword: string,
  sample: string
): DdpSeason | null => {
  if (seasons.length === 0) return null
  if (seasons.length === 1) return seasons[0]
  const hint = extractSeasonHint(keyword) ?? extractSeasonHint(sample)
  return findBestMatchingSeason(seasons, keyword, hint)
}

export interface AutoMatchDeps {
  /** Injected so the resolution logic stays unit-testable. */
  search: (keyword: string) => Promise<DdpSeason[]>
  episodes: (season: DdpSeason) => Promise<DdpEpisode[]>
}

/**
 * Resolve `filename` to one season + episode, or explain what is ambiguous.
 * Never throws: transport failures surface as `notFound` with a reason.
 */
export const autoMatch = async (
  filename: string,
  ai: AiTitleInfo | null,
  deps: AutoMatchDeps
): Promise<AutoMatchOutcome> => {
  const candidates = keywordCandidates(filename, ai)
  if (candidates.length === 0) {
    return { status: 'notFound', keyword: '', reason: REASON_NO_SEARCH }
  }

  const sample = basenameWithoutExt(filename)
  const target = targetEpisode(filename, ai)
  let seasons: DdpSeason[] = []
  let firstError: string | null = null
  // The keyword that actually produced results (what the picker should open
  // on). Falls back to the best candidate when nothing matched at all.
  let keyword = candidates[0]

  // Try each candidate until one returns something; the first hit wins so the
  // picker is prefilled with a keyword that actually has results.
  for (const candidate of candidates) {
    let found: DdpSeason[] = []
    try {
      found = await deps.search(candidate)
    } catch (e) {
      firstError = e instanceof Error ? e.message : String(e)
      found = []
    }
    if (found.length > 0) {
      seasons = found
      keyword = candidate
      break
    }
  }

  if (seasons.length === 0) {
    return {
      status: 'notFound',
      keyword,
      reason: firstError ?? REASON_NO_SEARCH,
    }
  }

  const season = chooseSeason(seasons, keyword, sample)
  if (!season) {
    return {
      status: 'ambiguous',
      keyword,
      seasons,
      targetEpisode: target,
      reason: REASON_NO_SEASON,
    }
  }

  if (target <= 0) {
    return {
      status: 'ambiguous',
      keyword,
      seasons,
      targetEpisode: 0,
      reason: REASON_NO_EPISODE,
    }
  }

  let list: DdpEpisode[]
  try {
    list = await deps.episodes(season)
  } catch (e) {
    return {
      status: 'ambiguous',
      keyword,
      seasons,
      targetEpisode: target,
      reason: e instanceof Error ? e.message : REASON_NO_EPISODE,
    }
  }

  const episode = findEpisodeByNumber(list, target)
  if (!episode) {
    // Deliberately NOT falling back to episodes[0] — that is the bug this
    // whole module exists to kill.
    return {
      status: 'ambiguous',
      keyword,
      seasons,
      targetEpisode: target,
      reason: REASON_NO_EPISODE,
    }
  }

  return { status: 'matched', keyword, season, episode }
}

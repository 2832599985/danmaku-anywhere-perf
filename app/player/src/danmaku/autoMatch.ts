import {
  extractSeasonHint,
  findBestMatchingSeason,
  findEpisodeByNumber,
  normalizeTitle,
} from '@danmaku-anywhere/media-parser'
import type { AiTitleInfo } from './ai'
import { basenameWithoutExt } from './basename'
import { parseReleaseName, type ReleaseInfo } from './releaseName'
import type { SourceEpisode, SourceId, SourceSeason } from './sources'

export { basenameWithoutExt }

/**
 * Filename → DanDanPlay season + episode.
 *
 * The pipeline is deliberately layered so ONE failure cannot erase the whole
 * result:
 *   1. deterministic release parsing (group/metadata/episode) — always runs;
 *   2. the optional AI title (enhances, never gates);
 *   3. DanDanPlay season search over every candidate title;
 *   4. season scoring (title, season hint, year, type) + episode resolution
 *      (exact, then absolute-numbering offset);
 *   5. a direct title+episode search as the last automatic attempt.
 *
 * When nothing is decisive the caller gets `ambiguous` and opens the picker —
 * the same "never guess" rule as before, but now a missing AI answer, a 500
 * from the AI proxy, or an absolute-numbered sequel no longer means silence.
 */

export interface SearchAttempt {
  keyword: string
  seasonCount: number
}

/** One season considered by the matcher (diagnostics + picker ordering). */
export interface ScoredSeason {
  season: SourceSeason
  score: number
  titleScore: number
  /** 0-based rank in the search that surfaced it (best over all keywords). */
  rank: number
  /** Rank in the best STRONG keyword search (AI/cleaned title), null if the
   *  season only came from the raw filename fallback. */
  strongRank: number | null
  /** Which keyword surfaced it. */
  keyword: string
  /** Resolved episode in this season, when one exists. */
  episode: SourceEpisode | null
  /** `exact` or `offset` (DanDanPlay numbers sequels by absolute episode). */
  episodeMode: 'exact' | 'offset' | null
  /** The release's episode title matches this episode's title. */
  episodeTitleMatch: boolean
  reasons: string[]
}

export interface AutoMatchAttempts {
  keywords: string[]
  aiTitle: string | null
  seasons: {
    source: SourceId
    title: string
    id: string
    score: number
    titleScore: number
    rank: number
    year: number
    episode: number | string | null
    episodeMode: 'exact' | 'offset' | null
    reasons: string[]
  }[]
  reason?: string
}

export type AutoMatchOutcome =
  | {
      status: 'matched'
      keyword: string
      season: SourceSeason
      episode: SourceEpisode
      /** How the episode number was mapped onto the site's numbering. */
      episodeMode: 'exact' | 'offset'
      /** `title` = lexical title match; `fuzzy` = search result + episode;
       *  `default-season` = no season in the file name, base season chosen. */
      matchMode: 'title' | 'fuzzy' | 'default-season'
      /** Other sources that confidently resolved the SAME episode (merge mode). */
      extraMatches: { season: SourceSeason; episode: SourceEpisode }[]
      attempts: AutoMatchAttempts
    }
  | {
      status: 'ambiguous'
      keyword: string
      seasons: SourceSeason[]
      targetEpisode: number
      reason: string
      attempts: AutoMatchAttempts
    }
  | {
      status: 'notFound'
      keyword: string
      reason: string
      attempts: AutoMatchAttempts
    }

export const REASON_NO_SEASON = '未能确定是哪一季'
export const REASON_NO_EPISODE = '未能确定是第几集'
export const REASON_NO_SEARCH = '没有搜到匹配的番剧'
export const REASON_BATCH = '合集文件无法确定单集'

/** Strip the file extension and any directory part. */
export const cleanFilenameTitle = (filename: string): string =>
  parseReleaseName(filename).title

/** Episode number from the filename, via the shared release parser. */
export const episodeFromFilename = (filename: string): number =>
  parseReleaseName(filename).episode

/** Search keyword candidates, best first, deduped and bounded. */
export const keywordCandidates = (
  filename: string,
  ai: AiTitleInfo | null
): string[] => {
  const release = parseReleaseName(filename)
  const raw = [
    ai?.title ?? '',
    ...(ai?.altTitles ?? []),
    ...release.titleCandidates,
  ]
  const seen = new Set<string>()
  const out: string[] = []
  for (const candidate of raw) {
    const trimmed = candidate.trim()
    if (!trimmed || seen.has(trimmed)) continue
    seen.add(trimmed)
    out.push(trimmed)
    // Bounded: every candidate costs a network round-trip.
    if (out.length === 6) break
  }
  return out
}

/** Target episode number: filename marker first, AI answer as the fallback. */
export const targetEpisode = (
  filename: string,
  ai: AiTitleInfo | null
): number => {
  const release = parseReleaseName(filename)
  if (release.episode > 0) return release.episode
  if (ai && ai.episode > 0) return ai.episode
  // A movie has exactly one episode in DanDanPlay; asking which one would be
  // noise. This is not a guess about a series.
  return release.isMovie ? 1 : 0
}

/** Parse an episode number that may be `"11"`, `"11.0"` or `"SP1"`. */
const numericEpisode = (value: number | string): number | null => {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isInteger(n) && n > 0 ? n : null
}

/**
 * Resolve a local episode number against a season's episode list.
 *
 * DanDanPlay numbers many sequels ABSOLUTELY (`咒术回战 第二季` = 25–47,
 * `转生史莱姆 第三季` = 49–72), while release files say `第11话`. Exact match
 * first; then shift by the season's first episode number (`first + local - 1`)
 * and require that shifted episode to exist. Never falls back to the first
 * episode.
 */
export const resolveEpisodeTarget = (
  episodes: SourceEpisode[],
  target: number
): { episode: SourceEpisode; mode: 'exact' | 'offset' } | null => {
  if (target <= 0) return null

  const exact = findEpisodeByNumber(episodes, target)
  if (exact) return { episode: exact, mode: 'exact' }

  const numeric = episodes
    .map((episode) => ({ episode, n: numericEpisode(episode.episodeNumber) }))
    .filter(
      (entry): entry is { episode: SourceEpisode; n: number } =>
        entry.n !== null
    )
    .sort((a, b) => a.n - b.n)
  if (numeric.length === 0) return null

  const first = numeric[0].n
  if (first <= 1) return null
  const shifted = target + first - 1
  const hit = numeric.find((entry) => entry.n === shifted)
  return hit ? { episode: hit.episode, mode: 'offset' } : null
}

/**
 * Decide which season the keyword means, mirroring the extension's
 * `SearchMatchingStrategy`: exactly one result, otherwise the best title match
 * (exact, then shortest contains, biased by a season hint). No match → null.
 * Used by the manual picker to expand the likely season.
 */
export const chooseSeason = (
  seasons: SourceSeason[],
  keyword: string,
  sample: string
): SourceSeason | null => {
  if (seasons.length === 0) return null
  if (seasons.length === 1) return seasons[0]
  const hint = extractSeasonHint(keyword) ?? extractSeasonHint(sample)
  return findBestMatchingSeason(seasons, keyword, hint)
}

/** Latin word tokens, lowercased (CJK titles are compared whole). */
const latinTokens = (value: string): string[] =>
  value
    .toLowerCase()
    .normalize('NFKC')
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 1)

/** Letters/digits only, for episode-title comparison. */
const normalizeText = (value: string): string =>
  value
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}]/gu, '')

/** Character-bigram set (works for CJK and Latin alike). */
const bigrams = (value: string): Set<string> => {
  const out = new Set<string>()
  for (let i = 0; i < value.length - 1; i += 1) out.add(value.slice(i, i + 2))
  return out
}

/**
 * Does the release's episode title match the site's episode title? DanDanPlay
 * prefixes its titles with `第N话 `, which is stripped first. This is the one
 * signal that can distinguish two seasons that both contain episode 12.
 */
const episodeTitleMatches = (
  releaseTitle: string,
  episodeTitle: string
): boolean => {
  const a = normalizeText(
    episodeTitle.replace(
      /^第\s*(?:\d+|[零一二三四五六七八九十百]+)\s*[集话話]\s*/u,
      ''
    )
  )
  const b = normalizeText(releaseTitle)
  if (a.length < 2 || b.length < 2) return false
  if (a.includes(b) || b.includes(a)) return true
  const A = bigrams(a)
  const B = bigrams(b)
  if (B.size < 2) return false
  let hit = 0
  for (const gram of B) if (A.has(gram)) hit += 1
  return hit / B.size >= 0.6
}

/** Edition/season suffixes that make a prefix/suffix match trustworthy. */
const EDITION_SUFFIX =
  /^(?:第\s*(?:\d+|[一二三四五六七八九十百]+)\s*[季部]|S\d+|season\s*\d+|part\s*\d+|剧场版|劇場版|movie|film|the\s*movie|ova|oad|特别篇|特別篇|续篇|續篇|最终季|最終季|完结篇|完結篇)/i

/** Score a prefix/suffix match from the extra text it leaves behind. */
const extraScore = (extra: string): number => {
  const trimmed = extra.trim()
  if (!trimmed) return 100
  if (trimmed.length <= 3) return 85
  return EDITION_SUFFIX.test(trimmed) ? 85 : 55
}

/**
 * Lexical title similarity, 0–100. Exact/prefix/contains for localized titles;
 * token overlap for Latin titles (`Sousou no Frieren` vs `Frieren`). A prefix
 * match that leaves an ARC/NOVEL name behind (`ONE PIECE` → `ONE PIECE novel
 * HEROINES`) is deliberately weak: only season/edition suffixes keep 85.
 * A romaji query against a Chinese title scores 0 on purpose — DanDanPlay's
 * search is what bridges languages, and the caller handles that separately.
 */
const titleScore = (seasonTitle: string, keyword: string): number => {
  const a = normalizeTitle(seasonTitle)
  const b = normalizeTitle(keyword)
  if (!b) return 0
  if (a === b) return 100
  if (a.startsWith(b)) return extraScore(a.slice(b.length))
  if (a.endsWith(b)) return extraScore(a.slice(0, a.length - b.length))
  const at = a.indexOf(b)
  if (at >= 0) {
    return Math.min(
      extraScore(a.slice(at + b.length)),
      extraScore(a.slice(0, at))
    )
  }

  const ka = latinTokens(seasonTitle)
  const kb = latinTokens(keyword)
  if (ka.length === 0 || kb.length < 2) return 0
  const overlap = kb.filter((token) => ka.includes(token)).length / kb.length
  return overlap >= 0.6 ? Math.round(overlap * 50) : 0
}

/** Season number encoded in a title (`第二季`, `S2`, `Season 2`). */
const seasonNumberOf = (title: string): number | null =>
  extractSeasonHint(title)

const MOVIE_TYPES = new Set(['movie'])

interface RankedSeason extends ScoredSeason {
  isFuture: boolean
}

/**
 * Score one search result against the release. The score is evidence, not a
 * verdict: the caller still requires a margin before auto-mounting.
 */
const scoreOne = (
  season: SourceSeason,
  keywords: ReadonlySet<string>,
  ranks: ReadonlyMap<string, number>,
  strong: ReadonlySet<string>,
  release: ReleaseInfo,
  now: Date
): RankedSeason => {
  const reasons: string[] = []
  let keyword = ''
  let lexical = 0
  for (const candidate of keywords) {
    const score = titleScore(season.title, candidate)
    if (score > lexical) {
      lexical = score
      keyword = candidate
    }
  }
  if (!keyword) keyword = [...keywords][0] ?? ''
  let rank = Number.POSITIVE_INFINITY
  for (const value of ranks.values()) rank = Math.min(rank, value)
  if (!Number.isFinite(rank)) rank = 0
  let strongRank: number | null = null
  for (const candidate of strong) {
    const value = ranks.get(candidate)
    if (value === undefined) continue
    if (strongRank === null || value < strongRank) strongRank = value
  }
  let score = lexical
  if (lexical >= 70) reasons.push(`标题匹配 ${lexical}`)

  // Search-engine relevance only matters when the titles share no script
  // (`Futsutsuka na…` → `恶女不才…`). It is a weak signal and never outranks a
  // lexical match.
  let rankBonus = 0
  if (lexical === 0 && rank <= 2) {
    rankBonus = rank === 0 ? 8 : rank === 1 ? 4 : 2
    score += rankBonus
    reasons.push(`搜索第 ${rank + 1} 位`)
  }

  const seasonNo = seasonNumberOf(season.title)
  if (release.season !== null) {
    if (seasonNo === release.season) {
      score += 40
      reasons.push(`季匹配 S${release.season}`)
    } else if (seasonNo !== null && seasonNo !== release.season) {
      score -= 100
      reasons.push(`季不符 S${seasonNo}≠S${release.season}`)
    } else if (release.season === 1) {
      score += 10
    } else {
      score -= 30
      reasons.push('候选未标季')
    }
  } else if (seasonNo !== null) {
    // `第1季` is just an explicit spelling of the base season.
    if (seasonNo !== 1) score -= 10
  } else {
    score += 10
  }

  const year = season.year
  const isFuture = Number.isFinite(year) && year > now.getFullYear()
  if (release.year !== null && Number.isFinite(year)) {
    if (year === release.year) {
      score += 20
      reasons.push(`年份 ${year}`)
    } else if (Math.abs(year - release.year) > 1) {
      score -= 30
      reasons.push(`年份不符 ${year}≠${release.year}`)
    }
  } else if (isFuture) {
    // DDP carries placeholder entries for announced seasons (a 2027 duplicate
    // of a show airing now). A file cannot be from a season that has not aired.
    score -= 40
    reasons.push(`未开播 ${year}`)
  }

  const isMovie = MOVIE_TYPES.has(season.type)
  if (release.isMovie) {
    score += isMovie ? 30 : -25
    if (isMovie) reasons.push('剧场版')
  } else {
    score += isMovie ? -25 : 10
  }

  return {
    season,
    score,
    titleScore: lexical,
    rank,
    strongRank,
    keyword,
    episode: null,
    episodeMode: null,
    episodeTitleMatch: false,
    reasons,
    isFuture,
  }
}

export interface AutoMatchDeps {
  /** Injected so the resolution logic stays unit-testable. `index` is the
   *  keyword's position (external sources only search the first few). */
  search: (keyword: string, index: number) => Promise<SourceSeason[]>
  episodes: (season: SourceSeason) => Promise<SourceEpisode[]>
  /** Optional DDP `/v2/search/episodes` (title + episode) last resort. */
  searchEpisodes?: (keyword: string, episode: number) => Promise<SourceSeason[]>
  /** Merge comments from every confident source for the matched episode. */
  mergeSources?: boolean
  /** Injectable clock (tests use a fixed date). */
  now?: () => Date
}

const attemptsFor = (
  keywords: string[],
  ai: AiTitleInfo | null,
  ranked: RankedSeason[],
  reason?: string
): AutoMatchAttempts => ({
  keywords,
  aiTitle: ai?.title ?? null,
  seasons: ranked.slice(0, 8).map((entry) => ({
    source: entry.season.source,
    title: entry.season.title,
    id: entry.season.id,
    score: entry.score,
    titleScore: entry.titleScore,
    rank: entry.rank,
    year: entry.season.year,
    episode: entry.episode?.episodeNumber ?? null,
    episodeMode: entry.episodeMode,
    reasons: entry.reasons,
  })),
  reason,
})

/** Merge search results, keeping the best (lowest) rank per source+id. */
const mergeSeasons = (
  groups: { keyword: string; seasons: SourceSeason[] }[]
): {
  season: SourceSeason
  keywords: Set<string>
  ranks: Map<string, number>
  rank: number
}[] => {
  const byId = new Map<
    string,
    {
      season: SourceSeason
      keywords: Set<string>
      ranks: Map<string, number>
      rank: number
    }
  >()
  for (const { keyword, seasons } of groups) {
    if (!Array.isArray(seasons)) continue
    seasons.forEach((season, rank) => {
      const key = `${season.source}:${season.id}`
      const existing = byId.get(key)
      if (!existing) {
        byId.set(key, {
          season,
          keywords: new Set([keyword]),
          ranks: new Map([[keyword, rank]]),
          rank,
        })
        return
      }
      existing.keywords.add(keyword)
      existing.ranks.set(keyword, rank)
      if (rank < existing.rank) existing.rank = rank
    })
  }
  return [...byId.values()]
}

/**
 * Keywords whose search result may be trusted for a FUZZY decision (romaji →
 * localized title). The raw file name is deliberately excluded: it still
 * produces fuzzy hits (a random scraped title, a release tag) and those must
 * never win a fuzzy match.
 */
const strongKeywordsFor = (
  ai: AiTitleInfo | null,
  release: ReleaseInfo
): Set<string> => {
  const out = new Set<string>()
  if (ai?.title) out.add(ai.title.trim())
  for (const title of ai?.altTitles ?? []) out.add(title.trim())
  for (const title of release.titleCandidates) {
    if (title !== release.base) out.add(title.trim())
  }
  if (out.size === 0) {
    for (const title of release.titleCandidates) out.add(title.trim())
  }
  return out
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
  const release = parseReleaseName(filename)
  const keywords = keywordCandidates(filename, ai)
  const now = (deps.now ?? (() => new Date()))()
  const target = targetEpisode(filename, ai)

  if (release.isBatch) {
    const attempts = attemptsFor(keywords, ai, [], REASON_BATCH)
    return {
      status: 'ambiguous',
      keyword: keywords[0] ?? '',
      seasons: [],
      targetEpisode: 0,
      reason: REASON_BATCH,
      attempts,
    }
  }

  if (keywords.length === 0) {
    return {
      status: 'notFound',
      keyword: '',
      reason: REASON_NO_SEARCH,
      attempts: attemptsFor(keywords, ai, [], REASON_NO_SEARCH),
    }
  }

  // Every candidate is searched in parallel: the first keyword that returns
  // something is no longer "the answer" — the ranking below decides.
  const searches = await Promise.allSettled(
    keywords.map(async (keyword, index) => ({
      keyword,
      seasons: await deps.search(keyword, index),
    }))
  )
  const groups: { keyword: string; seasons: SourceSeason[] }[] = []
  let firstError: string | null = null
  for (const result of searches) {
    if (result.status === 'fulfilled') {
      groups.push(result.value)
    } else {
      firstError =
        result.reason instanceof Error
          ? result.reason.message
          : String(result.reason)
    }
  }

  let merged = mergeSeasons(groups)

  // Last automatic resort: DDP's episode search already filters by the target
  // episode. It also survives queries the season search ranks poorly.
  if (merged.length === 0 && deps.searchEpisodes && target > 0) {
    for (const keyword of keywords.slice(0, 3)) {
      try {
        const found = (await deps.searchEpisodes(keyword, target)) ?? []
        if (found.length > 0) {
          merged = mergeSeasons([{ keyword, seasons: found }])
          break
        }
      } catch (e) {
        firstError = e instanceof Error ? e.message : (firstError ?? String(e))
      }
    }
  }

  if (merged.length === 0) {
    return {
      status: 'notFound',
      keyword: keywords[0] ?? '',
      reason: firstError ?? REASON_NO_SEARCH,
      attempts: attemptsFor(keywords, ai, [], firstError ?? REASON_NO_SEARCH),
    }
  }

  const strong = strongKeywordsFor(ai, release)
  let ranked = merged
    .map(({ season, keywords: found, ranks }) =>
      scoreOne(season, found, ranks, strong, release, now)
    )
    .sort((a, b) => b.score - a.score)

  // Fetch episode lists for the plausible candidates: the top of the ranking
  // plus the top strong-keyword results (a fuzzy match needs the season
  // DanDanPlay's own search put first, even when weak-keyword hits scored
  // higher lexically). This is what makes absolute numbering decidable.
  const probe = ranked.slice(0, 6)
  for (const entry of ranked) {
    if (probe.length >= 10) break
    if (entry.strongRank !== null && entry.strongRank <= 2) {
      if (!probe.includes(entry)) probe.push(entry)
    }
  }
  const lists = await Promise.allSettled(
    probe.map(async (entry) => ({
      entry,
      episodes: await deps.episodes(entry.season),
    }))
  )
  for (const result of lists) {
    if (result.status !== 'fulfilled') continue
    const { entry, episodes } = result.value
    if (target > 0) {
      const resolved = resolveEpisodeTarget(episodes, target)
      if (resolved) {
        entry.episode = resolved.episode
        entry.episodeMode = resolved.mode
        entry.score += resolved.mode === 'offset' ? 10 : 20
        entry.reasons.push(
          resolved.mode === 'offset'
            ? `累计集数偏移 → 第${resolved.episode.episodeNumber}话`
            : `第${target}集`
        )
        if (
          release.episodeTitle &&
          episodeTitleMatches(release.episodeTitle, resolved.episode.title)
        ) {
          entry.episodeTitleMatch = true
          entry.score += 20
          entry.reasons.push('集标题匹配')
        }
      } else {
        entry.score -= 30
        entry.reasons.push('该季没有这一集')
      }
    }
  }
  ranked = ranked.sort((a, b) => b.score - a.score)

  // Only candidates that can actually be mounted take part in the decision:
  // the target episode must exist, and a movie release must not mount a TV
  // season (or vice versa).
  const mountable = ranked.filter((entry) => {
    if (target <= 0 || entry.episode === null) return false
    if (release.isMovie) return entry.season.type === 'movie'
    return entry.season.type !== 'movie'
  })

  const best = mountable[0]
  const second = mountable[1]
  const strongPool = mountable.filter((entry) => entry.strongRank !== null)

  // The release carries an episode title and exactly one season has that
  // title. This is the only signal that can tell two seasons apart when both
  // contain the same episode number, so it outranks everything else.
  const titled = mountable.filter((entry) => entry.episodeTitleMatch)
  if (titled.length === 1) {
    return matched(
      titled[0],
      'title',
      keywords,
      ai,
      ranked,
      deps.mergeSources ?? false
    )
  }

  // A. Lexical title match with a clear margin.
  if (
    best &&
    best.titleScore >= 60 &&
    (!second || best.score - second.score >= 25)
  ) {
    return matched(
      best,
      'title',
      keywords,
      ai,
      ranked,
      deps.mergeSources ?? false
    )
  }

  // B. Best title match resolves the episode while its closest rival does not.
  if (
    best &&
    best.titleScore >= 60 &&
    (!second || best.score >= second.score)
  ) {
    return matched(
      best,
      'title',
      keywords,
      ai,
      ranked,
      deps.mergeSources ?? false
    )
  }

  // C/D only trust results from a STRONG keyword (AI title / cleaned title).
  // The raw filename search produces unrelated fuzzy hits — the live audit
  // found `妖怪传 猫目小僧` at rank 0 for a `[Nekomoe] Kusuriya…` file — and
  // those must never be auto-mounted.
  const lead = strongPool[0]
  if (lead && lead.titleScore === 0) {
    const eligible = strongPool.filter(
      (entry) =>
        entry.strongRank !== null && entry.strongRank <= 2 && !entry.isFuture
    )

    // C. Exactly one non-future strong result has the episode.
    if (eligible.length === 1) {
      return matched(
        eligible[0],
        'fuzzy',
        keywords,
        ai,
        ranked,
        deps.mergeSources ?? false
      )
    }

    // D. The file name carries no season, and several seasons have the
    // episode (a romaji release of a multi-season show). Default to the base
    // season — the top strong hit whose title has no season marker — and say
    // so in the OSD. The picker remains one click away if that is wrong.
    if (release.season === null) {
      const base = eligible.find(
        (entry) =>
          entry.strongRank === 0 && seasonNumberOf(entry.season.title) === null
      )
      if (base) {
        return matched(
          base,
          'default-season',
          keywords,
          ai,
          ranked,
          deps.mergeSources ?? false
        )
      }
    }
  }

  const anyEpisode = ranked.some((entry) => entry.episode !== null)
  const reason =
    target > 0 && !anyEpisode ? REASON_NO_EPISODE : REASON_NO_SEASON
  return {
    status: 'ambiguous',
    keyword: best?.keyword ?? ranked[0]?.keyword ?? keywords[0] ?? '',
    seasons: ranked.map((entry) => entry.season),
    targetEpisode: target,
    reason,
    attempts: attemptsFor(keywords, ai, ranked, reason),
  }
}

/**
 * Other sources that resolved the SAME episode. Only confident, same-show,
 * same-season candidates are merged; a `Show` vs `Show 第二季` mismatch is
 * rejected even though the title score is high.
 */
const collectExtras = (
  ranked: RankedSeason[],
  entry: RankedSeason
): { season: SourceSeason; episode: SourceEpisode }[] => {
  const base = entry.season.title
  const baseTitle = normalizeTitle(base)
  const baseSeason = seasonNumberOf(base)
  const bySource = new Map<SourceId, RankedSeason>()
  for (const candidate of ranked) {
    if (candidate === entry || !candidate.episode) continue
    if (candidate.season.source === entry.season.source) continue
    const title = candidate.season.title
    const normalized = normalizeTitle(title)
    const sameTitle = normalized === baseTitle
    const candidateSeason = seasonNumberOf(title)
    // `第1季` and "no marker" mean the same season; two explicit different
    // seasons (or an unmarked base vs `第二季`) must never be merged.
    const sameSeason =
      candidateSeason === baseSeason ||
      (baseSeason === null && candidateSeason === 1) ||
      (baseSeason === 1 && candidateSeason === null)
    const compatible =
      sameTitle || (sameSeason && titleScore(title, base) >= 85)
    if (!compatible) continue
    const confident =
      candidate.titleScore >= 85 ||
      (candidate.strongRank !== null && candidate.strongRank <= 1)
    if (!confident) continue
    if (!bySource.has(candidate.season.source)) {
      bySource.set(candidate.season.source, candidate)
    }
  }
  return [...bySource.values()].map((candidate) => ({
    season: candidate.season,
    episode: candidate.episode as SourceEpisode,
  }))
}

const matched = (
  entry: RankedSeason,
  matchMode: 'title' | 'fuzzy' | 'default-season',
  keywords: string[],
  ai: AiTitleInfo | null,
  ranked: RankedSeason[],
  mergeSources: boolean
): AutoMatchOutcome => {
  if (!entry.episode) {
    // Defensive: callers only call this after `resolvable`.
    return {
      status: 'ambiguous',
      keyword: entry.keyword,
      seasons: ranked.map((item) => item.season),
      targetEpisode: 0,
      reason: REASON_NO_EPISODE,
      attempts: attemptsFor(keywords, ai, ranked, REASON_NO_EPISODE),
    }
  }
  return {
    status: 'matched',
    keyword: entry.keyword,
    season: entry.season,
    episode: entry.episode,
    episodeMode: entry.episodeMode ?? 'exact',
    matchMode,
    extraMatches: mergeSources ? collectExtras(ranked, entry) : [],
    attempts: attemptsFor(keywords, ai, ranked),
  }
}

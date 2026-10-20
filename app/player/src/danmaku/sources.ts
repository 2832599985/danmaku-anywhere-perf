import type { CommentEntity } from '@danmaku-anywhere/danmaku-converter'
import { stripHtml } from '@danmaku-anywhere/danmaku-converter'
import * as bilibili from '@danmaku-anywhere/danmaku-provider/bilibili'
import * as tencent from '@danmaku-anywhere/danmaku-provider/tencent'
import { MediaParser } from '@danmaku-anywhere/media-parser'
import type { DanmakuSettings } from '@/store/settings'
import {
  type DdpEpisode,
  type DdpSeason,
  fetchEpisodeComments,
  fetchSeasonEpisodes,
  searchEpisodesByNumber,
  searchSeasons,
} from './ddp'

/**
 * One shape for every danmaku source. DDP is a plain HTTP API; Bilibili and
 * Tencent go through the hidden-WebView bridge (`src-tauri/src/source_bridge.rs`)
 * because their risk control rejects the Tauri http plugin's requests.
 *
 * The matcher only needs a title/type/year/episode count and a resolved
 * episode number, so all three sources are normalized here.
 */
export type SourceId = 'ddp' | 'bilibili' | 'tencent'

export interface SourceSeason {
  source: SourceId
  /** Source-specific season id (DDP bangumiId, Bilibili season_id, Tencent cid). */
  id: string
  title: string
  /** `tvseries` / `movie` (the matcher only distinguishes movies). */
  type: string
  /** Human-readable type shown in the picker (番剧 / 电影 / …). */
  typeDescription: string
  year: number
  episodeCount: number
  imageUrl: string
}

export interface SourceEpisode {
  source: SourceId
  /** Source-specific episode id used to fetch comments (DDP episodeId, Bilibili cid, Tencent vid). */
  id: string
  seasonId: string
  episodeNumber: number | string
  title: string
}

export interface SourceAdapter {
  search(keyword: string): Promise<SourceSeason[]>
  episodes(season: SourceSeason): Promise<SourceEpisode[]>
  comments(episode: SourceEpisode): Promise<CommentEntity[]>
}

export const SOURCE_LABELS: Record<SourceId, string> = {
  ddp: 'DanDanPlay',
  bilibili: '哔哩哔哩',
  tencent: '腾讯视频',
}

const ALL_SOURCES: SourceId[] = ['ddp', 'bilibili', 'tencent']

/** Sources the user enabled; remote ones only when the bridge exists. */
export const enabledSources = (
  settings: DanmakuSettings,
  includeRemote: boolean
): SourceId[] => {
  const active = ALL_SOURCES.filter((source) => {
    if (!settings.sources[source]) return false
    if (source !== 'ddp' && !includeRemote) return false
    return true
  })
  return active.length > 0 ? active : ['ddp']
}

const episodeNumberFrom = (value: unknown): number | string => {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  const text = String(value ?? '').trim()
  if (/^\d+(?:\.0+)?$/.test(text)) {
    const number = Number(text)
    if (Number.isFinite(number) && number > 0) return number
  }
  const parsed = new MediaParser().parse({
    title: { value: text, regex: [] },
  }).episode
  return parsed && Number.isFinite(parsed) ? parsed : text || 0
}

const ddpSeason = (season: DdpSeason): SourceSeason => ({
  source: 'ddp',
  id: season.bangumiId,
  title: season.title,
  type: season.type,
  typeDescription: season.typeDescription,
  year: season.year,
  episodeCount: season.episodeCount,
  imageUrl: season.imageUrl,
})

const ddpEpisode = (episode: DdpEpisode, seasonId: string): SourceEpisode => ({
  source: 'ddp',
  id: String(episode.episodeId),
  seasonId,
  episodeNumber: episode.episodeNumber,
  title: episode.title,
})

const bilibiliSeason = (item: bilibili.BilibiliMedia): SourceSeason => ({
  source: 'bilibili',
  id: String(item.season_id),
  title: stripHtml(item.title),
  type: /电影|剧场|movie/i.test(item.season_type_name) ? 'movie' : 'tvseries',
  typeDescription: item.season_type_name,
  year:
    item.pubtime > 0 ? new Date(item.pubtime * 1000).getFullYear() : Number.NaN,
  episodeCount: item.ep_size,
  imageUrl: item.cover,
})

const bilibiliEpisode = (
  episode: bilibili.BilibiliBangumiInfo['episodes'][number],
  seasonId: string
): SourceEpisode => ({
  source: 'bilibili',
  id: String(episode.cid),
  seasonId,
  episodeNumber: episodeNumberFrom(episode.title),
  title: stripHtml(episode.long_title || episode.title),
})

const tencentSeason = (item: tencent.TencentVideoSeason): SourceSeason => ({
  source: 'tencent',
  id: item.doc.id,
  title: stripHtml(item.videoInfo.title),
  type: item.videoInfo.videoType === 1 ? 'movie' : 'tvseries',
  typeDescription: item.videoInfo.typeName,
  year: item.videoInfo.year > 0 ? item.videoInfo.year : Number.NaN,
  episodeCount: item.videoInfo.episodeSites[0]?.totalEpisode ?? 0,
  imageUrl: item.videoInfo.imgUrl,
})

const tencentEpisode = (
  item: tencent.TencentEpisodeListItem,
  seasonId: string
): SourceEpisode => ({
  source: 'tencent',
  id: item.vid,
  seasonId,
  episodeNumber: episodeNumberFrom(item.title),
  title: stripHtml(item.play_title || item.title),
})

/** Run `fn` over `items` with a small concurrency cap (Tencent segments). */
const mapLimit = async <T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> => {
  const out: R[] = new Array(items.length)
  let next = 0
  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      for (;;) {
        const index = next
        next += 1
        if (index >= items.length) return
        out[index] = await fn(items[index])
      }
    }
  )
  await Promise.all(workers)
  return out
}

/**
 * Tencent serves comments as ~30 s JSON segments. The provider's own
 * `getDanmaku` fetches them sequentially with a 100 ms throttle — 40+ segments
 * would take far too long — so fetch four at a time here. A failed segment is
 * skipped (partial comments beat no comments).
 */
const tencentComments = async (
  episode: SourceEpisode
): Promise<CommentEntity[]> => {
  const base = await tencent.getDanmakuSegments(episode.id)
  if (!base.success) throw base.error
  const segments = Object.values(base.data.segment_index)
  const lists = await mapLimit(segments, 4, async (segment) => {
    try {
      const res = await fetch(
        `https://dm.video.qq.com/barrage/segment/${episode.id}/${segment.segment_name}`
      )
      if (!res.ok) return [] as CommentEntity[]
      return tencent.zTencentComment.parse(await res.json()).barrage_list
    } catch {
      return [] as CommentEntity[]
    }
  })
  return lists.flat()
}

const ADAPTERS: Record<SourceId, SourceAdapter> = {
  ddp: {
    search: async (keyword) => {
      const seasons = await searchSeasons(keyword)
      return seasons.map(ddpSeason)
    },
    episodes: async (season) => {
      const episodes = await fetchSeasonEpisodes({ bangumiId: season.id })
      return episodes.map((episode) => ddpEpisode(episode, season.id))
    },
    comments: async (episode) => fetchEpisodeComments(Number(episode.id)),
  },
  bilibili: {
    search: async (keyword) => {
      const result = await bilibili.searchMedia({ keyword })
      if (!result.success) throw result.error
      return result.data.map(bilibiliSeason)
    },
    episodes: async (season) => {
      const result = await bilibili.getBangumiInfo({
        seasonId: Number(season.id),
      })
      if (!result.success) throw result.error
      return result.data.episodes.map((episode) =>
        bilibiliEpisode(episode, season.id)
      )
    },
    comments: async (episode) => {
      const result = await bilibili.getDanmakuXml(Number(episode.id))
      if (!result.success) throw result.error
      return result.data
    },
  },
  tencent: {
    search: async (keyword) => {
      const result = await tencent.searchMedia({ query: keyword })
      if (!result.success) throw result.error
      return result.data.map(tencentSeason)
    },
    episodes: async (season) => {
      const out: SourceEpisode[] = []
      const generator = tencent.listEpisodes({ cid: season.id, vid: '' })
      for await (const page of generator) {
        if (!page.success) throw page.error
        for (const item of page.data) {
          out.push(tencentEpisode(item, season.id))
        }
      }
      return out
    },
    comments: tencentComments,
  },
}

export const adapterFor = (source: SourceId): SourceAdapter => ADAPTERS[source]

/**
 * Search every enabled source for one keyword. External sources (Bilibili /
 * Tencent) only run for the first three keywords: their responses are large
 * (Tencent's search is ~300 KB) and the AI/cleaned title are the ones that work.
 */
export const searchAll = async (
  keyword: string,
  sources: SourceId[],
  index: number
): Promise<SourceSeason[]> => {
  const active = sources.filter((source) => source === 'ddp' || index < 3)
  if (active.length === 0) return []
  const results = await Promise.allSettled(
    active.map((source) => adapterFor(source).search(keyword))
  )
  const seasons: SourceSeason[] = []
  let firstError: unknown = null
  for (const result of results) {
    if (result.status === 'fulfilled') {
      seasons.push(...result.value)
    } else if (firstError === null) {
      firstError = result.reason
    }
  }
  if (seasons.length === 0 && firstError !== null) throw firstError
  return seasons
}

/** DDP-only last resort: search by title + episode number. */
export const searchEpisodesAcross = async (
  keyword: string,
  episode: number
): Promise<SourceSeason[]> => {
  const seasons = await searchEpisodesByNumber(keyword, episode)
  return seasons.map(ddpSeason)
}

/** Cross-source duplicate removal: the same comment has the same time+text. */
export const dedupeByPM = (comments: CommentEntity[]): CommentEntity[] => {
  const seen = new Set<string>()
  const out: CommentEntity[] = []
  for (const comment of comments) {
    const key = `${comment.p}\u0000${comment.m}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(comment)
  }
  return out
}

/** Rebuild the minimal season shape a learned rule stores. */
export const seasonFromRule = (rule: {
  source: SourceId
  bangumiId: string
  title: string
  episodeCount: number
}): SourceSeason => ({
  source: rule.source,
  id: rule.bangumiId,
  title: rule.title,
  type: 'tvseries',
  typeDescription: '',
  year: Number.NaN,
  episodeCount: rule.episodeCount,
  imageUrl: '',
})

import type { CommentEntity } from '@danmaku-anywhere/danmaku-converter'
import { configureApiStore } from '@danmaku-anywhere/danmaku-provider'
import {
  commentGetComment,
  getBangumiAnime,
  searchSearchAnime,
} from '@danmaku-anywhere/danmaku-provider/ddp'

/**
 * DanDanPlay online danmaku. Calls route through the same proxy the extension
 * uses (`API_ROOT = https://api.danmaku.weeblify.app`), which handles
 * DanDanPlay's app-secret signing. In the Tauri build, window.fetch is swapped
 * to the http plugin before this runs, so the provider bypasses CORS
 * unmodified; in the browser it relies on the proxy's CORS headers.
 *
 * The two-step shape mirrors the extension (`DanDanPlayService`):
 *   1. `/v2/search/anime`  → seasons (no episode list)
 *   2. `/v2/bangumi/{id}`  → that season's episodes WITH a real
 *      `episodeNumber` (the search endpoints only carry titles)
 * Step 2 is what makes episode matching reliable — see
 * `@danmaku-anywhere/media-parser.findEpisodeByNumber`.
 */

const DA_ID_KEY = 'danmaku-player-da-id'

let configured = false

/** Configure the provider store once (stable daId + version). Exported so the
 *  AI auto-match path shares the same config without re-implementing it. */
export const ensureConfigured = () => {
  if (configured) return
  let daId = ''
  try {
    daId = localStorage.getItem(DA_ID_KEY) ?? ''
    if (!daId) {
      daId = crypto.randomUUID()
      localStorage.setItem(DA_ID_KEY, daId)
    }
  } catch {
    daId = crypto.randomUUID()
  }
  configureApiStore({ daId, daVersion: '1.0.0' })
  configured = true
}

/**
 * A DanDanPlay season (anime) as returned by the search endpoint. Field names
 * match the shared media-parser / danmaku-converter convention (`title`) so the
 * season and episode matchers can be used without adapters.
 */
export interface DdpSeason {
  animeId: number
  /** Season id used by the bangumi detail endpoint. */
  bangumiId: string
  title: string
  type: string
  typeDescription: string
  imageUrl: string
  /** Release year, derived from `startDate` (NaN when absent). */
  year: number
  episodeCount: number
}

/** One episode of a season, as returned by the bangumi detail endpoint. */
export interface DdpEpisode {
  episodeId: number
  /** "11", or "SP1" for specials — compare as strings. */
  episodeNumber: number | string
  title: string
}

/** Search DanDanPlay for seasons matching `keyword`. */
export const searchSeasons = async (keyword: string): Promise<DdpSeason[]> => {
  ensureConfigured()
  const trimmed = keyword.trim()
  if (!trimmed) return []
  const result = await searchSearchAnime(trimmed)
  if (!result.success) throw result.error
  return result.data.map((anime) => ({
    animeId: anime.animeId,
    bangumiId: anime.bangumiId,
    title: anime.animeTitle,
    type: String(anime.type),
    typeDescription: anime.typeDescription,
    imageUrl: anime.imageUrl,
    year: Number.isFinite(new Date(anime.startDate).getFullYear())
      ? new Date(anime.startDate).getFullYear()
      : Number.NaN,
    episodeCount: anime.episodeCount,
  }))
}

/** Fetch a season's episodes (with real episode numbers). */
export const fetchSeasonEpisodes = async (
  season: DdpSeason
): Promise<DdpEpisode[]> => {
  ensureConfigured()
  const result = await getBangumiAnime(season.bangumiId)
  if (!result.success) throw result.error
  return result.data.episodes.map((ep) => ({
    episodeId: ep.episodeId,
    episodeNumber: ep.episodeNumber,
    title: ep.episodeTitle,
  }))
}

/** Fetch the comments for a specific DanDanPlay episode. */
export const fetchEpisodeComments = async (
  episodeId: number
): Promise<CommentEntity[]> => {
  ensureConfigured()
  const result = await commentGetComment(episodeId)
  if (!result.success) throw result.error
  // CommentData ({cid?,p,m}) is structurally a CommentEntity.
  return result.data
}

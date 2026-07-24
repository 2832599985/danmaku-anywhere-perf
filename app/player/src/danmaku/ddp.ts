import type { CommentEntity } from '@danmaku-anywhere/danmaku-converter'
import { configureApiStore } from '@danmaku-anywhere/danmaku-provider'
import {
  commentGetComment,
  searchSearchEpisodes,
} from '@danmaku-anywhere/danmaku-provider/ddp'

/**
 * DanDanPlay online danmaku (secondary source). Calls route through the same
 * proxy the extension uses (`API_ROOT = https://api.danmaku.weeblify.app`), which
 * handles DanDanPlay's app-secret signing. In the Tauri build, window.fetch is
 * swapped to the http plugin before this runs, so the provider bypasses CORS
 * unmodified; in the browser it relies on the proxy's CORS headers.
 */

const DA_ID_KEY = 'danmaku-player-da-id'

let configured = false

const ensureConfigured = () => {
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

export interface DdpEpisode {
  episodeId: number
  episodeTitle: string
}

export interface DdpAnime {
  animeId: number
  animeTitle: string
  type: string
  typeDescription: string
  episodes: DdpEpisode[]
}

/** Search DanDanPlay; returns animes each carrying their episode list. */
export const searchDanmaku = async (keyword: string): Promise<DdpAnime[]> => {
  ensureConfigured()
  const trimmed = keyword.trim()
  if (!trimmed) return []
  const result = await searchSearchEpisodes({ anime: trimmed })
  if (!result.success) throw result.error
  return result.data.map((anime) => ({
    animeId: anime.animeId,
    animeTitle: anime.animeTitle,
    type: String(anime.type),
    typeDescription: anime.typeDescription,
    episodes: anime.episodes,
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

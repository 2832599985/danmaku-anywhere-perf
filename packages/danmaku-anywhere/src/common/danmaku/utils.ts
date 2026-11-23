import type {
  CustomEpisodeLite,
  GenericEpisodeLite,
} from '@danmaku-anywhere/danmaku-converter'
import type { DanmakuSourceType } from '@/common/danmaku/enums'

class UnsupportedProviderException extends Error {
  constructor(provider: DanmakuSourceType, message?: string) {
    super(`Unsupported provider: ${provider}${message ? `: ${message}` : ''}`)
  }
}

export function assertProviderType<
  T extends { provider: DanmakuSourceType },
  S extends DanmakuSourceType,
>(data: T, provider: S): asserts data is Extract<T, { provider: S }> {
  if (data.provider !== provider) {
    throw new UnsupportedProviderException(
      data.provider,
      `expected ${provider}`
    )
  }
}

export function isProvider<
  T extends { provider: DanmakuSourceType },
  S extends DanmakuSourceType,
>(data: T, provider: S): data is Extract<T, { provider: S }> {
  return data.provider === provider
}

/**
 * Checks if a data object is a "regular" (non-custom) entity.
 *
 * For episodes: distinguishes between regular episodes
 * (in `episode` table, with `season` field) and legacy custom episodes
 * (in `customEpisode` table, without `season` field).
 *
 * For seasons: all seasons in the `season` table now qualify, including MacCMS.
 *
 * Uses structural check since both regular and custom MacCMS episodes
 * share the same provider type.
 */
export function isNotCustom<T extends { provider: DanmakuSourceType }>(
  data: T
): data is Exclude<T, CustomEpisodeLite> {
  // Structural check: if data has a 'season' field, it's a regular episode
  if ('season' in data) return true
  // If it has 'providerConfigId', it's a season from the season table
  if ('providerConfigId' in data) return true
  // Otherwise it's a legacy custom episode
  return false
}

export const episodeToString = (episode: GenericEpisodeLite) => {
  if (isNotCustom(episode)) {
    return `${episode.season.title} - ${episode.title}`
  }
  return episode.title
}

/**
 * Split a custom episode path-like title into a folder path and filename.
 * Leading/trailing slashes are stripped. Empty segments are discarded.
 */
export const splitCustomEpisodePath = (title: string) => {
  const parts = title.split('/').filter(Boolean)
  const fileName = parts.pop() ?? title
  return {
    parts,
    folderPath: parts.join('/'),
    fileName,
  }
}

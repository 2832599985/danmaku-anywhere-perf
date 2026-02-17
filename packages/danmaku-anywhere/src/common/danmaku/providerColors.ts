import {
  type CommentEntity,
  DanmakuSourceType,
  type GenericEpisode,
} from '@danmaku-anywhere/danmaku-converter'

export const providerColors: Record<DanmakuSourceType, string> = {
  [DanmakuSourceType.Bilibili]: '#00A1D6',
  [DanmakuSourceType.DanDanPlay]: '#F09199',
  [DanmakuSourceType.Tencent]: '#1DA1F2',
  [DanmakuSourceType.MacCMS]: '#FF6B35',
  [DanmakuSourceType.Custom]: '#9E9E9E',
}

export interface SourceInfo {
  provider: DanmakuSourceType
  count: number
}

/**
 * Build a map from comment key (`p+m`) to provider type,
 * using the episodes array to determine each comment's source.
 *
 * Uses string-based keys (`p\0m`) for Immer compatibility,
 * since object identity may not be preserved across state updates.
 */
export const buildCommentProviderMap = (
  _comments: CommentEntity[],
  episodes?: GenericEpisode[]
): Map<string, DanmakuSourceType> => {
  const map = new Map<string, DanmakuSourceType>()

  if (!episodes || episodes.length === 0) return map

  for (const episode of episodes) {
    const provider = episode.provider
    for (const comment of episode.comments) {
      const key = `${comment.p}\0${comment.m}`
      // First episode to claim a key wins (preserves original source)
      if (!map.has(key)) {
        map.set(key, provider)
      }
    }
  }

  return map
}

/**
 * Get the provider for a comment using its p+m key.
 */
export const getCommentProvider = (
  comment: CommentEntity,
  providerMap: Map<string, DanmakuSourceType>
): DanmakuSourceType | undefined => {
  return providerMap.get(`${comment.p}\0${comment.m}`)
}

/**
 * Aggregate source counts from episodes.
 */
export const getSourceInfoFromEpisodes = (
  episodes?: GenericEpisode[]
): SourceInfo[] => {
  if (!episodes || episodes.length === 0) return []

  const countMap = new Map<DanmakuSourceType, number>()

  for (const episode of episodes) {
    const prev = countMap.get(episode.provider) ?? 0
    countMap.set(episode.provider, prev + episode.comments.length)
  }

  return Array.from(countMap.entries()).map(([provider, count]) => ({
    provider,
    count,
  }))
}

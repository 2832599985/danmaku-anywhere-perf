import type {
  CustomEpisode,
  EpisodeMeta,
  Season,
  WithSeason,
} from '@danmaku-anywhere/danmaku-converter'
import type { DanmakuSourceType } from '@/common/danmaku/enums'
import type { ProviderConfig } from '@/common/options/providerConfig/schema'
import type { MatchingStrategyType } from './MatchingStrategyType'

export interface StrategyAttempt {
  strategy: MatchingStrategyType
  tried: boolean
  skipped: boolean
  reason?: string
}

export interface SeasonSearchRequest {
  keyword: string
  episode?: string
  providerConfigId: string
}

export interface SeasonGetAllRequest {
  includeEmpty?: boolean
}

export type SeasonQueryFilter = {
  id?: number
  ids?: number[]
  provider?: DanmakuSourceType
  providerConfigId?: string
  indexedId?: string
}

export interface MatchEpisodeInput {
  mapKey: string
  title: string
  episodeNumber?: number
  // if available, use seasonId to disambiguate
  seasonId?: number
  originalTitle?: string
  // preferred provider order for this mount config
  preferredProviders?: DanmakuSourceType[]
  // tab URL for media server detection (injected by RPC layer)
  tabUrl?: string
}

export interface MatchEpisodeMetadata {
  providerConfig?: ProviderConfig
  strategy: MatchingStrategyType
}

export type MatchEpisodeResult =
  | {
      status: 'success'
      data: WithSeason<EpisodeMeta> | CustomEpisode
      metadata: MatchEpisodeMetadata
    }
  | {
      status: 'disambiguation'
      data: Season[]
      metadata: MatchEpisodeMetadata
    }
  | {
      status: 'notFound'
      data: null
      cause: string
      strategyAttempts?: StrategyAttempt[]
    }

export interface GenericVodSearchData {
  baseUrl: string
  keyword: string
}

import type {
  EpisodeLite,
  EpisodeMeta,
  WithSeason,
} from '@danmaku-anywhere/danmaku-converter'
import type { ReactNode } from 'react'

type RenderEpisodeData = {
  episode: WithSeason<EpisodeMeta>
  danmaku: WithSeason<EpisodeLite> | null
  isLoading: boolean
}

export type RenderEpisode = (data: RenderEpisodeData) => ReactNode

import type { CommentEntity } from '@danmaku-anywhere/danmaku-converter'
import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import {
  customEpisodeQueryKeys,
  episodeQueryKeys,
  seasonQueryKeys,
} from '@/common/queries/queryKeys'
import { chromeRpcClient } from '@/common/rpcClient/background/client'
import type { StatsData } from './statsUtils'
import {
  computeAvgLength,
  computeGlobalDensityBins,
  computePeakTime,
  computeTopKeywords,
  computeTypeDistribution,
} from './statsUtils'

interface UseStatsResult {
  isLoading: boolean
  isComputing: boolean
  stats: StatsData | null
}

export function useStats(): UseStatsResult {
  const [stats, setStats] = useState<StatsData | null>(null)
  const [isComputing, setIsComputing] = useState(false)

  const episodesQuery = useQuery({
    queryKey: episodeQueryKeys.filter({ all: true }),
    queryFn: () => chromeRpcClient.episodeFilter({ all: true }),
    select: (res) => res.data,
    staleTime: 1000 * 60 * 5,
  })

  const customEpisodesQuery = useQuery({
    queryKey: customEpisodeQueryKeys.filter({ all: true }),
    queryFn: () => chromeRpcClient.episodeFilterCustom({ all: true }),
    select: (res) => res.data,
    staleTime: 1000 * 60 * 5,
  })

  const seasonsQuery = useQuery({
    queryKey: seasonQueryKeys.all(),
    queryFn: () => chromeRpcClient.seasonGetAll({}),
    select: (res) => res.data,
    staleTime: 1000 * 60 * 5,
  })

  const isLoading =
    episodesQuery.isLoading ||
    customEpisodesQuery.isLoading ||
    seasonsQuery.isLoading

  useEffect(() => {
    if (isLoading) return
    if (!episodesQuery.data && !customEpisodesQuery.data) return

    setIsComputing(true)

    const episodes = episodesQuery.data ?? []
    const customEpisodes = customEpisodesQuery.data ?? []
    const seasons = seasonsQuery.data ?? []

    const allComments: CommentEntity[] = []
    for (const ep of episodes) {
      for (const c of ep.comments) {
        allComments.push(c)
      }
    }
    for (const ep of customEpisodes) {
      for (const c of ep.comments) {
        allComments.push(c)
      }
    }

    const episodeCount = episodes.length + customEpisodes.length
    const seasonCount = seasons.length

    // Compute heavy stats in requestIdleCallback to avoid blocking UI
    const computeAsync = () => {
      const schedule =
        typeof requestIdleCallback === 'function'
          ? requestIdleCallback
          : (cb: () => void) => setTimeout(cb, 0)

      schedule(() => {
        const typeDistribution = computeTypeDistribution(allComments)
        const topKeywords = computeTopKeywords(allComments, 10)
        const densityBins = computeGlobalDensityBins(allComments, 10)
        const avgLength = computeAvgLength(allComments)
        const peakTime = computePeakTime(densityBins)

        setStats({
          totalComments: allComments.length,
          seasonCount,
          episodeCount,
          typeDistribution,
          topKeywords,
          densityBins,
          avgLength,
          peakTime,
        })
        setIsComputing(false)
      })
    }

    computeAsync()
  }, [
    isLoading,
    episodesQuery.data,
    customEpisodesQuery.data,
    seasonsQuery.data,
  ])

  return { isLoading, isComputing, stats }
}

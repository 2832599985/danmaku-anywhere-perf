import { useMutation } from '@tanstack/react-query'
import { isNotCustom } from '@/common/danmaku/utils'
import { chromeRpcClient } from '@/common/rpcClient/background/client'
import { useStore } from '@/content/controller/store/store'

export const usePreloadNextEpisode = () => {
  const { episodes } = useStore.use.danmaku()

  return {
    canLoadNext: () => {
      if (!episodes || episodes.length !== 1) return false
      // Only provider-backed episodes (with a season) can be preloaded
      return isNotCustom(episodes[0])
    },
    preloadNext: useMutation({
      mutationFn: async () => {
        if (!episodes || episodes.length !== 1) {
          return null
        }

        const episode = episodes[0]

        if (!isNotCustom(episode)) {
          return null
        }

        return chromeRpcClient.episodePreloadNext({
          type: 'by-meta',
          meta: episode,
        })
      },
    }),
  }
}

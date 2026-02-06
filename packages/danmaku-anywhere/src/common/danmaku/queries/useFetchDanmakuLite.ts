import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useToast } from '@/common/components/Toast/toastStore'
import type { DanmakuFetchDto } from '@/common/danmaku/dto'
import { episodeQueryKeys, seasonQueryKeys } from '@/common/queries/queryKeys'
import { chromeRpcClient } from '@/common/rpcClient/background/client'
import { getTrackingService } from '@/common/telemetry/getTrackingService'

/**
 * Fetches danmaku from cache or server and saves to cache.
 *
 * Compared to `useFetchDanmaku`, this only returns lite metadata (no `comments`),
 * which avoids freezing/janky UI when large comment arrays are transferred across
 * the extension messaging channel (common in popup pages).
 */
export const useFetchDanmakuLite = () => {
  const queryClient = useQueryClient()
  const toast = useToast.use.toast()

  const mutation = useMutation({
    mutationKey: episodeQueryKeys.all(),
    mutationFn: async (data: DanmakuFetchDto) => {
      getTrackingService().track('fetchDanmaku', data)
      const res = await chromeRpcClient.episodeFetchLite(data)
      return res.data
    },
    onSuccess: (episode, input) => {
      void queryClient.invalidateQueries({
        queryKey: seasonQueryKeys.all(),
        exact: true,
      })

      const byMetaFilter = {
        provider: input.meta.provider,
        indexedId: input.meta.indexedId,
        seasonId: input.meta.seasonId,
      }

      void queryClient.invalidateQueries({
        queryKey: episodeQueryKeys.filter(byMetaFilter),
      })

      void queryClient.invalidateQueries({
        queryKey: episodeQueryKeys.filterLite(byMetaFilter),
      })

      void queryClient.invalidateQueries({
        queryKey: episodeQueryKeys.filter({ id: episode.id }),
      })

      void queryClient.invalidateQueries({
        queryKey: episodeQueryKeys.filterLite({
          seasonId: input.meta.seasonId,
        }),
      })
    },
    onError: async (error) => {
      toast.error(error.message)
    },
  })

  return {
    ...mutation,
    fetch: mutation.mutateAsync,
  }
}

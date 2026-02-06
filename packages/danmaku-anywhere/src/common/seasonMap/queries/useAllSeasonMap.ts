import {
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from '@tanstack/react-query'
import { seasonMapQueryKeys } from '@/common/queries/queryKeys'
import { chromeRpcClient } from '@/common/rpcClient/background/client'
import { SeasonMap } from '@/common/seasonMap/SeasonMap'

export const useAllSeasonMap = () => {
  return useSuspenseQuery({
    queryKey: seasonMapQueryKeys.all(),
    queryFn: async () => {
      const res = await chromeRpcClient.seasonMapGetAll()
      return SeasonMap.reviveAll(res.data)
    },
  })
}

export const useSeasonMapMutations = () => {
  const queryClient = useQueryClient()

  const updateCache = (
    updater: (prev: SeasonMap[] | undefined) => SeasonMap[] | undefined
  ) => {
    queryClient.setQueryData(seasonMapQueryKeys.all(), (prev) => {
      return updater(prev as SeasonMap[] | undefined)
    })
  }

  return {
    add: useMutation({
      mutationKey: seasonMapQueryKeys.all(),
      mutationFn: async (map: SeasonMap) => {
        return chromeRpcClient.seasonMapAdd(map.toSnapshot())
      },
      onMutate: async (map) => {
        await queryClient.cancelQueries({ queryKey: seasonMapQueryKeys.all() })
        const previous = queryClient.getQueryData(seasonMapQueryKeys.all()) as
          | SeasonMap[]
          | undefined

        updateCache((prev) => {
          const list = prev ?? []
          const existing = list.find((m) => m.key === map.key)
          const next = existing ? existing.merge(map) : map

          const without = list.filter((m) => m.key !== map.key)
          return [...without, next]
        })

        return { previous }
      },
      onError: (_err, _input, ctx) => {
        if (!ctx?.previous) {
          return
        }
        queryClient.setQueryData(seasonMapQueryKeys.all(), ctx.previous)
      },
      onSettled: () => {
        void queryClient.invalidateQueries({
          queryKey: seasonMapQueryKeys.all(),
        })
      },
    }),
    delete: useMutation({
      mutationKey: seasonMapQueryKeys.all(),
      mutationFn: async (key: string) => {
        return chromeRpcClient.seasonMapDelete({ key })
      },
      onMutate: async (key) => {
        await queryClient.cancelQueries({ queryKey: seasonMapQueryKeys.all() })
        const previous = queryClient.getQueryData(seasonMapQueryKeys.all()) as
          | SeasonMap[]
          | undefined

        updateCache((prev) => (prev ?? []).filter((m) => m.key !== key))

        return { previous }
      },
      onError: (_err, _input, ctx) => {
        if (!ctx?.previous) {
          return
        }
        queryClient.setQueryData(seasonMapQueryKeys.all(), ctx.previous)
      },
      onSettled: () => {
        void queryClient.invalidateQueries({
          queryKey: seasonMapQueryKeys.all(),
        })
      },
    }),
    removeProvider: useMutation({
      mutationKey: seasonMapQueryKeys.all(),
      mutationFn: async (input: { key: string; providerConfigId: string }) => {
        return chromeRpcClient.seasonMapRemoveProvider(input)
      },
      onMutate: async (input) => {
        await queryClient.cancelQueries({ queryKey: seasonMapQueryKeys.all() })
        const previous = queryClient.getQueryData(seasonMapQueryKeys.all()) as
          | SeasonMap[]
          | undefined

        updateCache((prev) => {
          const list = prev ?? []
          const existing = list.find((m) => m.key === input.key)
          if (!existing) {
            return list
          }

          const next = existing.withoutProvider(input.providerConfigId)
          const without = list.filter((m) => m.key !== input.key)

          return next.isEmpty() ? without : [...without, next]
        })

        return { previous }
      },
      onError: (_err, _input, ctx) => {
        if (!ctx?.previous) {
          return
        }
        queryClient.setQueryData(seasonMapQueryKeys.all(), ctx.previous)
      },
      onSettled: () => {
        void queryClient.invalidateQueries({
          queryKey: seasonMapQueryKeys.all(),
        })
      },
    }),
  }
}

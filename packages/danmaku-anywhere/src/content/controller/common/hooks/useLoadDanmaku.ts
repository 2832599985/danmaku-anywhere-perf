import type {
  CommentEntity,
  GenericEpisode,
} from '@danmaku-anywhere/danmaku-converter'
import { useEventCallback } from '@mui/material'
import { useMutation } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useToast } from '@/common/components/Toast/toastStore'
import type { DanmakuFetchDto, MacCMSFetchData } from '@/common/danmaku/dto'
import { DanmakuSourceType } from '@/common/danmaku/enums'
import { useFetchDanmaku } from '@/common/danmaku/queries/useFetchDanmaku'
import { useFetchGenericDanmaku } from '@/common/danmaku/queries/useFetchGenericDanmaku'
import { episodeToString, isProvider } from '@/common/danmaku/utils'
import { Logger } from '@/common/Logger'
import { useExtensionOptions } from '@/common/options/extensionOptions/useExtensionOptions'
import { playerRpcClient } from '@/common/rpcClient/background/client'
import { PerfTimer } from '@/common/utils/perf'
import { concatArr, dedupeComments, mergeComments } from '@/common/utils/utils'
import { useStore } from '@/content/controller/store/store'

const useMountDanmaku = () => {
  const { toast } = useToast()
  const { data: options } = useExtensionOptions()
  const perfRef = useRef<PerfTimer>()

  if (!perfRef.current) {
    perfRef.current = new PerfTimer(
      Logger.sub('[useLoadDanmaku]'),
      'mount',
      options?.debug ?? false
    )
  }

  useEffect(() => {
    perfRef.current?.setEnabled(options?.debug ?? false)
  }, [options?.debug])

  const { mustGetActiveFrame, updateFrame } = useStore.use.frame()
  const { mount } = useStore.use.danmaku()

  return useMutation({
    mutationFn: async (episodes: GenericEpisode[]) => {
      perfRef.current?.mark('mount_start')
      const rawComments: CommentEntity[] =
        episodes.length === 1
          ? episodes[0].comments
          : episodes.reduce<CommentEntity[]>((acc, episode) => {
              concatArr(acc, episode.comments)
              return acc
            }, [])

      // 去重：优先使用 cid，fallback 到 content+time
      const comments = dedupeComments(rawComments)

      perfRef.current?.mark('mount_comments_ready')
      const res = await playerRpcClient.player['relay:command:mount']({
        frameId: mustGetActiveFrame().frameId,
        data: comments,
      })
      perfRef.current?.mark('mount_rpc_done')
      perfRef.current?.summary('mount')

      if (!res.data) {
        throw new Error('Failed to mount danmaku')
      }
    },
    onSuccess: (_, danmaku) => {
      mount(danmaku)
      updateFrame(mustGetActiveFrame().frameId, { mounted: true })
    },
    onError: (err) => {
      toast.error(err.message)
    },
  })
}

const useMergeMountDanmaku = () => {
  const { toast } = useToast()
  const { data: options } = useExtensionOptions()
  const perfRef = useRef<PerfTimer>()

  if (!perfRef.current) {
    perfRef.current = new PerfTimer(
      Logger.sub('[useMergeDanmaku]'),
      'merge',
      options?.debug ?? false
    )
  }

  useEffect(() => {
    perfRef.current?.setEnabled(options?.debug ?? false)
  }, [options?.debug])

  const { mustGetActiveFrame } = useStore.use.frame()
  const { mergeMount } = useStore.use.danmaku()

  return useMutation({
    mutationFn: async (episodes: GenericEpisode[]) => {
      perfRef.current?.mark('merge_start')
      const rawComments: CommentEntity[] =
        episodes.length === 1
          ? episodes[0].comments
          : episodes.reduce<CommentEntity[]>((acc, episode) => {
              concatArr(acc, episode.comments)
              return acc
            }, [])

      const incoming = dedupeComments(rawComments)

      // Merge with existing comments, deduplicating across sources
      const merged = mergeComments(
        useStore.getState().danmaku.comments,
        incoming
      )

      perfRef.current?.mark('merge_comments_ready')
      const res = await playerRpcClient.player['relay:command:mount']({
        frameId: mustGetActiveFrame().frameId,
        data: merged,
      })
      perfRef.current?.mark('merge_rpc_done')
      perfRef.current?.summary('merge')

      if (!res.data) {
        throw new Error('Failed to merge danmaku')
      }
    },
    onSuccess: (_, danmaku) => {
      mergeMount(danmaku)
    },
    onError: (err) => {
      toast.error(err.message)
    },
  })
}

// Wrapper around useFetchDanmaku and useMountDanmaku
export const useLoadDanmaku = () => {
  const { t } = useTranslation()

  const toast = useToast.use.toast()

  const { episodes } = useStore.use.danmaku()

  const fetchMutation = useFetchDanmaku()
  const fetchGenericMutation = useFetchGenericDanmaku()
  const mountMutation = useMountDanmaku()
  const mergeMountMutation = useMergeMountDanmaku()

  const { isMounted } = useStore.use.danmaku()

  const canRefresh =
    !!episodes &&
    episodes.length === 1 &&
    isProvider(episodes[0], DanmakuSourceType.DanDanPlay)

  const mountDanmaku = useEventCallback((episodes: GenericEpisode[]) => {
    return mountMutation.mutateAsync(episodes, {
      // This is called in addition to the onSuccess of mountMutation
      onSuccess: () => {
        if (episodes.length === 1) {
          const episode = episodes[0]
          toast.success(
            t(
              'danmaku.alert.mounted',
              'Danmaku Mounted: {{name}} ({{count}})',
              {
                name: episodeToString(episode),
                count: episode.commentCount,
              }
            ),
            {
              actionFn: isProvider(episode, DanmakuSourceType.DanDanPlay)
                ? refreshComments
                : undefined,
              actionLabel: t('danmaku.refresh', 'Refresh Danmaku'),
            }
          )
        } else {
          toast.success(
            t(
              'danmaku.alert.mountedMultiple',
              'Mounted {{count}} selected danmaku',
              {
                count: episodes.length,
              }
            )
          )
        }
      },
    })
  })

  const loadMutation = useMutation({
    mutationFn: async (data: DanmakuFetchDto) => {
      const cache = await fetchMutation.mutateAsync(data)
      // IMPORTANT: await mount so the UI stays disabled until the heavy mount RPC finishes.
      // This avoids users accidentally triggering multiple concurrent downloads/mounts, which can cause jank.
      await mountDanmaku([cache])
      return cache
    },
  })

  const loadGenericMutation = useMutation({
    mutationFn: async (data: MacCMSFetchData) => {
      const cache = await fetchGenericMutation.mutateAsync(data)
      await mountDanmaku([cache])
      return cache
    },
  })

  const mergeDanmaku = useEventCallback((episodes: GenericEpisode[]) => {
    return mergeMountMutation.mutateAsync(episodes, {
      onSuccess: () => {
        const totalComments = useStore.getState().danmaku.comments.length
        if (episodes.length === 1) {
          const episode = episodes[0]
          toast.success(
            t(
              'danmaku.alert.merged',
              'Danmaku Merged: {{name}} (total: {{count}})',
              {
                name: episodeToString(episode),
                count: totalComments,
              }
            )
          )
        } else {
          toast.success(
            t(
              'danmaku.alert.mergedMultiple',
              'Merged {{count}} sources (total: {{total}})',
              {
                count: episodes.length,
                total: totalComments,
              }
            )
          )
        }
      },
    })
  })

  const mergeLoadMutation = useMutation({
    mutationFn: async (data: DanmakuFetchDto) => {
      const cache = await fetchMutation.mutateAsync(data)
      await mergeDanmaku([cache])
      return cache
    },
  })

  const refreshComments = useEventCallback(async () => {
    if (!canRefresh) return
    const episode = episodes[0]
    // check again to narrow the type
    if (!isProvider(episode, DanmakuSourceType.DanDanPlay)) return

    toast.info(t('danmaku.alert.refreshingDanmaku', 'Refreshing danmaku'))
    loadMutation.mutate(
      { type: 'by-meta', meta: episode, options: { forceUpdate: true } },
      {
        onSuccess: (result) => {
          toast.success(
            t(
              'danmaku.alert.refreshed',
              'Danmaku Refreshed: {{name}} ({{count}})',
              {
                name: episodeToString(result),
                count: result.commentCount,
              }
            )
          )
        },
      }
    )
  })

  return {
    loadMutation,
    loadGenericMutation,
    mergeLoadMutation,
    refreshComments,
    canRefresh,
    canMerge: isMounted,
    mountDanmaku,
    mergeDanmaku,
  }
}

import {
  DanmakuSourceType,
  type EpisodeMeta,
  type WithSeason,
} from '@danmaku-anywhere/danmaku-converter'
import {
  Button,
  Checkbox,
  LinearProgress,
  Stack,
  Typography,
} from '@mui/material'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Suspense, useMemo, useRef, useState } from 'react'
import { ErrorBoundary } from 'react-error-boundary'
import { useTranslation } from 'react-i18next'
import { BaseEpisodeListItem } from '@/common/components/EpisodeList/BaseEpisodeListItem'
import { EpisodeSearchList } from '@/common/components/EpisodeList/EpisodeSearchList'
import { MacCmsEpisodeListItem } from '@/common/components/EpisodeList/MacCmsEpisodeListItem'
import { ErrorMessage } from '@/common/components/ErrorMessage'
import { TabLayout } from '@/common/components/layout/TabLayout'
import { TabToolbar } from '@/common/components/layout/TabToolbar'
import { useToast } from '@/common/components/Toast/toastStore'
import { useFetchDanmakuLite } from '@/common/danmaku/queries/useFetchDanmakuLite'
import { useFetchGenericDanmaku } from '@/common/danmaku/queries/useFetchGenericDanmaku'
import { isNotCustom } from '@/common/danmaku/utils'
import { assertProviderConfigImpl } from '@/common/options/providerConfig/utils'
import { episodeQueryKeys, seasonQueryKeys } from '@/common/queries/queryKeys'
import { chromeRpcClient } from '@/common/rpcClient/background/client'
import { useGoBack } from '@/popup/hooks/useGoBack'
import { useStore } from '@/popup/store'

const buildEpisodeKey = (meta: WithSeason<EpisodeMeta>) => {
  return `${meta.provider}:${meta.seasonId}:${meta.indexedId}`
}

export const SeasonDetailsPage = () => {
  const { t } = useTranslation()
  const toast = useToast.use.toast()
  const queryClient = useQueryClient()

  const { season, provider } = useStore.use.search()

  const goBack = useGoBack()

  if (!season || !provider) return null

  const isCustomSeason = !isNotCustom(season)
  // Use a non-suspense query so the toolbar can render immediately, while still sharing cache
  // with the suspense query inside `EpisodeSearchList`.
  const seasonId = isNotCustom(season) ? season.id : 0
  const episodesQuery = useQuery({
    enabled: !isCustomSeason,
    queryKey: seasonQueryKeys.episodes(seasonId),
    queryFn: () => chromeRpcClient.episodeFetchBySeason({ seasonId }),
    select: (res) => res.data,
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  })

  const { mutateAsync: load, isPending, variables } = useFetchDanmakuLite()
  const genericMutation = useFetchGenericDanmaku()

  const [isSelectMode, setIsSelectMode] = useState(false)
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(() => new Set())
  const [batchProgress, setBatchProgress] = useState<null | {
    total: number
    completed: number
  }>(null)
  const cancelBatchRef = useRef(false)

  const selectedCount = selectedKeys.size
  const isBatchDownloading = batchProgress !== null

  const allEpisodes = episodesQuery.data ?? []

  const selectedEpisodes = useMemo(() => {
    if (isCustomSeason) return []
    if (selectedKeys.size === 0) return []
    return allEpisodes.filter((ep) => selectedKeys.has(buildEpisodeKey(ep)))
  }, [allEpisodes, isCustomSeason, selectedKeys])

  const clearSelection = () => setSelectedKeys(new Set())

  const toggleSelectMode = () => {
    // Exiting select mode clears selection to avoid accidental batch actions.
    setIsSelectMode((prev) => {
      const next = !prev
      if (!next) {
        clearSelection()
      }
      return next
    })
  }

  const toggleSelectedKey = (key: string) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const handleSelectAll = () => {
    if (isCustomSeason) return
    if (allEpisodes.length === 0) return
    setSelectedKeys(new Set(allEpisodes.map(buildEpisodeKey)))
  }

  const handleBatchDownload = async () => {
    if (isCustomSeason) return
    if (selectedEpisodes.length === 0) return
    if (isBatchDownloading) return

    cancelBatchRef.current = false
    setBatchProgress({ total: selectedEpisodes.length, completed: 0 })

    toast.info(
      t('searchPage.batchDownload.start', '开始批量下载：{{count}} 集', {
        count: selectedEpisodes.length,
      })
    )

    try {
      for (let i = 0; i < selectedEpisodes.length; i++) {
        if (cancelBatchRef.current) break

        const meta = selectedEpisodes[i]
        await load({
          type: 'by-meta',
          meta,
          options: {
            forceUpdate: true,
          },
        })

        setBatchProgress((prev) => {
          if (!prev) return prev
          return { ...prev, completed: i + 1 }
        })

        // Yield so the UI can update progress and remain responsive.
        // eslint-disable-next-line no-await-in-loop
        await new Promise((r) => setTimeout(r, 0))
      }
    } catch (e) {
      // The underlying mutation already toasts on errors; keep going is harder with mutation state,
      // so for now we stop the batch if an unexpected error bubbles up here.
      const message = e instanceof Error ? e.message : String(e)
      toast.error(message)
    } finally {
      setBatchProgress(null)
      // Refresh the season/episode caches once at the end so the list reflects newly downloaded items.
      void queryClient.invalidateQueries({
        queryKey: seasonQueryKeys.all(),
        exact: true,
      })
      void queryClient.invalidateQueries({ queryKey: episodeQueryKeys.all() })
      toast.success(t('searchPage.batchDownload.done', '批量下载完成'))
      clearSelection()
      setIsSelectMode(false)
    }
  }

  const handleCancelBatch = () => {
    cancelBatchRef.current = true
  }

  return (
    <TabLayout>
      <TabToolbar title={season.title} showBackButton onGoBack={goBack}>
        {!isCustomSeason && (
          <Stack direction="row" gap={1} alignItems="center">
            {isSelectMode ? (
              <>
                <Button
                  size="small"
                  onClick={handleSelectAll}
                  disabled={isBatchDownloading || allEpisodes.length === 0}
                >
                  {t('common.selectAll', '全选')}
                </Button>
                <Button
                  size="small"
                  onClick={() => clearSelection()}
                  disabled={isBatchDownloading || selectedCount === 0}
                >
                  {t('common.clear', '清空')}
                </Button>
                <Button
                  size="small"
                  color="primary"
                  variant="contained"
                  onClick={handleBatchDownload}
                  disabled={isBatchDownloading || selectedCount === 0}
                >
                  {t('searchPage.batchDownload.download', '下载 ({{count}})', {
                    count: selectedCount,
                  })}
                </Button>
                {isBatchDownloading && (
                  <Button
                    size="small"
                    color="warning"
                    onClick={handleCancelBatch}
                  >
                    {t('common.cancel', '停止')}
                  </Button>
                )}
                <Button
                  size="small"
                  onClick={toggleSelectMode}
                  disabled={isBatchDownloading}
                >
                  {t('common.done', '完成')}
                </Button>
              </>
            ) : (
              <Button
                size="small"
                onClick={toggleSelectMode}
                disabled={isPending}
              >
                {t('searchPage.batchDownload.enable', '批量下载')}
              </Button>
            )}
          </Stack>
        )}
      </TabToolbar>
      {batchProgress && (
        <Stack px={2} py={1} gap={1}>
          <Typography variant="caption" color="text.secondary">
            {t(
              'searchPage.batchDownload.progress',
              '下载进度：{{done}}/{{total}}',
              {
                done: batchProgress.completed,
                total: batchProgress.total,
              }
            )}
          </Typography>
          <LinearProgress
            variant="determinate"
            value={
              batchProgress.total === 0
                ? 0
                : (batchProgress.completed / batchProgress.total) * 100
            }
          />
        </Stack>
      )}
      <ErrorBoundary
        fallbackRender={({ error }) => <ErrorMessage message={error.message} />}
      >
        <Suspense fallback={null}>
          <EpisodeSearchList
            season={season}
            renderEpisode={(data) => {
              const key = buildEpisodeKey(data.episode)
              const isLoadingThisEpisode =
                isPending &&
                variables?.type === 'by-meta' &&
                variables.meta.indexedId === data.episode.indexedId &&
                variables.meta.provider === data.episode.provider &&
                variables.meta.seasonId === data.episode.seasonId

              return (
                <BaseEpisodeListItem
                  isLoading={
                    !isSelectMode && (isLoadingThisEpisode || data.isLoading)
                  }
                  episode={data.danmaku ?? data.episode}
                  onClick={async (meta) => {
                    if (isBatchDownloading) return
                    if (isSelectMode) {
                      toggleSelectedKey(key)
                      return
                    }

                    await load({
                      type: 'by-meta',
                      meta,
                      options: {
                        forceUpdate: true,
                      },
                    })
                  }}
                  disabled={isPending || isBatchDownloading}
                  renderSecondaryAction={() => {
                    if (!isSelectMode) return null
                    return (
                      <Checkbox
                        edge="end"
                        checked={selectedKeys.has(key)}
                        disabled={isBatchDownloading}
                        onClick={(e) => e.stopPropagation()}
                        onChange={() => toggleSelectedKey(key)}
                      />
                    )
                  }}
                />
              )
            }}
            renderCustomEpisode={(data) => {
              assertProviderConfigImpl(provider, DanmakuSourceType.MacCMS)

              return (
                <MacCmsEpisodeListItem
                  onClick={() =>
                    genericMutation.mutate({
                      ...data.episode,
                      providerConfigId: provider.id,
                    })
                  }
                  isLoading={genericMutation.isPending}
                  episode={data.episode}
                  danmaku={genericMutation.data}
                />
              )
            }}
          />
        </Suspense>
      </ErrorBoundary>
    </TabLayout>
  )
}

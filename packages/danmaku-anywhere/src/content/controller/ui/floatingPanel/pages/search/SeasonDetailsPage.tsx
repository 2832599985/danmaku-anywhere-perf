import {
  type CustomSeason,
  DanmakuSourceType,
  type EpisodeMeta,
  type Season,
  type WithSeason,
} from '@danmaku-anywhere/danmaku-converter'
import {
  Button,
  Checkbox,
  LinearProgress,
  Stack,
  Typography,
} from '@mui/material'
import { useQuery } from '@tanstack/react-query'
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
import { isNotCustom } from '@/common/danmaku/utils'
import type { ProviderConfig } from '@/common/options/providerConfig/schema'
import { assertProviderConfigImpl } from '@/common/options/providerConfig/utils'
import { seasonQueryKeys } from '@/common/queries/queryKeys'
import { chromeRpcClient } from '@/common/rpcClient/background/client'
import { useLoadDanmaku } from '@/content/controller/common/hooks/useLoadDanmaku'

type SeasonDetailsPageProps = {
  season: Season | CustomSeason
  onGoBack: () => void
  provider: ProviderConfig
}

const buildEpisodeKey = (meta: WithSeason<EpisodeMeta>) => {
  return `${meta.provider}:${meta.seasonId}:${meta.indexedId}`
}

export const SeasonDetailsPage = ({
  season,
  onGoBack,
  provider,
}: SeasonDetailsPageProps) => {
  const { t } = useTranslation()
  const toast = useToast.use.toast()

  const { loadMutation, loadGenericMutation } = useLoadDanmaku()
  const { mutateAsync: download, isPending: isDownloading } =
    useFetchDanmakuLite()

  const isCustomSeason = !isNotCustom(season)
  const seasonId = isNotCustom(season) ? season.id : 0

  // Share cache with `EpisodeSearchList` (which uses Suspense), but keep this non-suspense so
  // the toolbar can render immediately and we can implement "select all" without reaching into the list.
  const episodesQuery = useQuery({
    enabled: !isCustomSeason,
    queryKey: seasonQueryKeys.episodes(seasonId),
    queryFn: () => chromeRpcClient.episodeFetchBySeason({ seasonId }),
    select: (res) => res.data,
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  })

  const [isSelectMode, setIsSelectMode] = useState(false)
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(() => new Set())
  const [batchProgress, setBatchProgress] = useState<null | {
    total: number
    completed: number
  }>(null)
  const cancelBatchRef = useRef(false)

  const allEpisodes = episodesQuery.data ?? []
  const selectedCount = selectedKeys.size
  const isBatchDownloading = batchProgress !== null

  const selectedEpisodes = useMemo(() => {
    if (isCustomSeason) return []
    if (selectedKeys.size === 0) return []
    return allEpisodes.filter((ep) => selectedKeys.has(buildEpisodeKey(ep)))
  }, [allEpisodes, isCustomSeason, selectedKeys])

  const clearSelection = () => setSelectedKeys(new Set())

  const toggleSelectMode = () => {
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

  const handleCancelBatch = () => {
    cancelBatchRef.current = true
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
        // Download into extension storage without mounting into the player.
        await download({
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

        // Yield so the UI can remain responsive while we run sequential downloads.
        // eslint-disable-next-line no-await-in-loop
        await new Promise((r) => setTimeout(r, 0))
      }

      toast.success(t('searchPage.batchDownload.done', '批量下载完成'))
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      toast.error(message)
    } finally {
      setBatchProgress(null)
      clearSelection()
      setIsSelectMode(false)
    }
  }

  return (
    <TabLayout>
      <TabToolbar showBackButton onGoBack={onGoBack} title={season.title}>
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
                  disabled={
                    isBatchDownloading ||
                    selectedCount === 0 ||
                    loadMutation.isPending ||
                    isDownloading
                  }
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
                disabled={
                  loadMutation.isPending || loadGenericMutation.isPending
                }
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
              const handleFetchDanmaku = async (
                meta: WithSeason<EpisodeMeta>
              ) => {
                await loadMutation.mutateAsync({
                  type: 'by-meta',
                  meta,
                  options: {
                    forceUpdate: true,
                  },
                })
              }

              const isLoadingThisEpisode =
                loadMutation.isPending &&
                loadMutation.variables?.type === 'by-meta' &&
                loadMutation.variables.meta.indexedId ===
                  data.episode.indexedId &&
                loadMutation.variables.meta.provider ===
                  data.episode.provider &&
                loadMutation.variables.meta.seasonId === data.episode.seasonId

              const key = buildEpisodeKey(data.episode)

              return (
                <BaseEpisodeListItem
                  episode={data.danmaku ?? data.episode}
                  isLoading={
                    !isSelectMode && (isLoadingThisEpisode || data.isLoading)
                  }
                  onClick={async (meta) => {
                    if (isBatchDownloading) return
                    if (isSelectMode) {
                      toggleSelectedKey(key)
                      return
                    }
                    await handleFetchDanmaku(meta)
                  }}
                  disabled={
                    loadMutation.isPending ||
                    isBatchDownloading ||
                    isDownloading
                  }
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
                  episode={data.episode}
                  onClick={() =>
                    loadGenericMutation.mutate({
                      ...data.episode,
                      providerConfigId: provider.id,
                    })
                  }
                  isLoading={loadGenericMutation.isPending}
                  disabled={loadGenericMutation.isPending}
                  danmaku={loadGenericMutation.data}
                />
              )
            }}
          />
        </Suspense>
      </ErrorBoundary>
    </TabLayout>
  )
}

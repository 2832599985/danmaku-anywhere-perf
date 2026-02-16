import type {
  EpisodeMeta,
  WithSeason,
} from '@danmaku-anywhere/danmaku-converter'
import { Star, StarBorder } from '@mui/icons-material'
import {
  Button,
  Checkbox,
  IconButton,
  LinearProgress,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Suspense, useMemo, useRef, useState } from 'react'
import { ErrorBoundary } from 'react-error-boundary'
import { useTranslation } from 'react-i18next'
import { BaseEpisodeListItem } from '@/common/components/EpisodeList/BaseEpisodeListItem'
import { EpisodeSearchList } from '@/common/components/EpisodeList/EpisodeSearchList'
import { ErrorMessage } from '@/common/components/ErrorMessage'
import { TabLayout } from '@/common/components/layout/TabLayout'
import { TabToolbar } from '@/common/components/layout/TabToolbar'
import { useToast } from '@/common/components/Toast/toastStore'
import { resolveBatchDownloadOutcome } from '@/common/danmaku/batchDownloadOutcome'
import { useFetchDanmakuLite } from '@/common/danmaku/queries/useFetchDanmakuLite'
import { useFavorites } from '@/common/hooks/useFavorites'
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

  const { season } = useStore.use.search()
  const { isFavorite, toggleFavorite } = useFavorites()

  const goBack = useGoBack()

  const episodesQuery = useQuery({
    enabled: !!season,
    queryKey: seasonQueryKeys.episodes(season?.id ?? 0),
    queryFn: () =>
      chromeRpcClient.episodeFetchBySeason({ seasonId: season?.id ?? 0 }),
    select: (res) => res.data,
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  })

  const { mutateAsync: load, isPending, variables } = useFetchDanmakuLite()

  const [isSelectMode, setIsSelectMode] = useState(false)
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(() => new Set())
  const [batchProgress, setBatchProgress] = useState<null | {
    total: number
    completed: number
  }>(null)
  const cancelBatchRef = useRef(false)

  const allEpisodes = episodesQuery.data ?? []

  const selectedEpisodes = useMemo(() => {
    if (selectedKeys.size === 0) return []
    return allEpisodes.filter((ep) => selectedKeys.has(buildEpisodeKey(ep)))
  }, [allEpisodes, selectedKeys])

  if (!season) return null

  const selectedCount = selectedKeys.size
  const isBatchDownloading = batchProgress !== null

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
    if (allEpisodes.length === 0) return
    setSelectedKeys(new Set(allEpisodes.map(buildEpisodeKey)))
  }

  const handleBatchDownload = async () => {
    if (selectedEpisodes.length === 0) return
    if (isBatchDownloading) return

    cancelBatchRef.current = false
    setBatchProgress({ total: selectedEpisodes.length, completed: 0 })

    toast.info(
      t('searchPage.batchDownload.start', {
        count: selectedEpisodes.length,
      })
    )

    let completed = 0
    let batchError: unknown

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

        completed = i + 1
        setBatchProgress((prev) => {
          if (!prev) return prev
          return { ...prev, completed }
        })

        // Yield so the UI can update progress and remain responsive.
        // eslint-disable-next-line no-await-in-loop
        await new Promise((r) => setTimeout(r, 0))
      }
    } catch (e) {
      batchError = e
    } finally {
      // Refresh the season/episode caches once at the end so the list reflects newly downloaded items.
      void queryClient.invalidateQueries({
        queryKey: seasonQueryKeys.all(),
        exact: true,
      })
      void queryClient.invalidateQueries({ queryKey: episodeQueryKeys.all() })

      const result = resolveBatchDownloadOutcome({
        total: selectedEpisodes.length,
        completed,
        cancelled: cancelBatchRef.current,
        error: batchError,
      })

      if (result.outcome === 'success') {
        toast.success(t('searchPage.batchDownload.done'))
      } else if (result.outcome === 'cancelled') {
        toast.info(
          t('searchPage.batchDownload.cancelled', {
            done: result.completed,
            total: result.total,
          })
        )
      } else {
        const message =
          batchError instanceof Error ? batchError.message : String(batchError)
        toast.error(
          t('searchPage.batchDownload.failed', {
            message,
          })
        )
      }

      setBatchProgress(null)
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
        <Stack direction="row" gap={1} alignItems="center">
          <Tooltip
            title={
              isFavorite(season.id)
                ? t('searchPage.favorites.remove')
                : t('searchPage.favorites.add')
            }
          >
            <IconButton
              size="small"
              onClick={() => toggleFavorite(season)}
              color={isFavorite(season.id) ? 'warning' : 'default'}
            >
              {isFavorite(season.id) ? (
                <Star fontSize="small" />
              ) : (
                <StarBorder fontSize="small" />
              )}
            </IconButton>
          </Tooltip>
          {isSelectMode ? (
            <>
              <Button
                size="small"
                onClick={handleSelectAll}
                disabled={isBatchDownloading || allEpisodes.length === 0}
              >
                {t('common.selectAll')}
              </Button>
              <Button
                size="small"
                onClick={() => clearSelection()}
                disabled={isBatchDownloading || selectedCount === 0}
              >
                {t('common.clear')}
              </Button>
              <Button
                size="small"
                color="primary"
                variant="contained"
                onClick={handleBatchDownload}
                disabled={isBatchDownloading || selectedCount === 0}
              >
                {t('searchPage.batchDownload.download', {
                  count: selectedCount,
                })}
              </Button>
              {isBatchDownloading && (
                <Button
                  size="small"
                  color="warning"
                  onClick={handleCancelBatch}
                >
                  {t('common.cancel')}
                </Button>
              )}
              <Button
                size="small"
                onClick={toggleSelectMode}
                disabled={isBatchDownloading}
              >
                {t('common.done')}
              </Button>
            </>
          ) : (
            <Button
              size="small"
              onClick={toggleSelectMode}
              disabled={isPending}
            >
              {t('searchPage.batchDownload.enable')}
            </Button>
          )}
        </Stack>
      </TabToolbar>
      {batchProgress && (
        <Stack px={2} py={1} gap={1}>
          <Typography variant="caption" color="text.secondary">
            {t('searchPage.batchDownload.progress', {
              done: batchProgress.completed,
              total: batchProgress.total,
            })}
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
          />
        </Suspense>
      </ErrorBoundary>
    </TabLayout>
  )
}

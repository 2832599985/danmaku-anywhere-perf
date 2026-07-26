import type {
  EpisodeMeta,
  WithSeason,
} from '@danmaku-anywhere/danmaku-converter'
import {
  Button,
  Checkbox,
  LinearProgress,
  Stack,
  Typography,
} from '@mui/material'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { ErrorBoundary } from 'react-error-boundary'
import { useTranslation } from 'react-i18next'
import { BookmarkToggleButton } from '@/common/bookmark/components/BookmarkToggleButton'
import { BaseEpisodeListItem } from '@/common/components/EpisodeList/BaseEpisodeListItem'
import { EpisodeSearchList } from '@/common/components/EpisodeList/EpisodeSearchList'
import { ErrorMessage } from '@/common/components/ErrorMessage'
import { TabLayout } from '@/common/components/layout/TabLayout'
import { TabToolbar } from '@/common/components/layout/TabToolbar'
import { useToast } from '@/common/components/Toast/toastStore'
import { resolveBatchDownloadOutcome } from '@/common/danmaku/batchDownloadOutcome'
import { useFetchDanmakuLite } from '@/common/danmaku/queries/useFetchDanmakuLite'
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
  // Batch failures are reported once as a summary, so this instance stays quiet.
  const { mutateAsync: loadForBatch } = useFetchDanmakuLite({
    showErrorToast: false,
  })

  const [isSelectMode, setIsSelectMode] = useState(false)
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(() => new Set())
  const [batchProgress, setBatchProgress] = useState<null | {
    total: number
    completed: number
  }>(null)
  const cancelBatchRef = useRef(false)
  const isUnmountedRef = useRef(false)

  useEffect(() => {
    return () => {
      isUnmountedRef.current = true
    }
  }, [])

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

    let processed = 0
    let succeeded = 0
    const failures: string[] = []

    for (const meta of selectedEpisodes) {
      // The loop outlives the component, so stop as soon as it goes away
      // instead of downloading into a page the user has already left.
      if (cancelBatchRef.current || isUnmountedRef.current) break

      try {
        await loadForBatch({
          type: 'by-meta',
          meta,
          options: {
            forceUpdate: true,
          },
        })
        succeeded++
      } catch (e) {
        // One bad episode must not strand the rest of the batch.
        failures.push(e instanceof Error ? e.message : String(e))
      }

      processed++
      setBatchProgress((prev) => {
        if (!prev) return prev
        return { ...prev, completed: processed }
      })

      // Yield so the UI can update progress and remain responsive.
      await new Promise((r) => setTimeout(r, 0))
    }

    if (isUnmountedRef.current) return

    // Refresh the season/episode caches once at the end so the list reflects newly downloaded items.
    void queryClient.invalidateQueries({
      queryKey: seasonQueryKeys.all(),
      exact: true,
    })
    void queryClient.invalidateQueries({ queryKey: episodeQueryKeys.all() })

    const result = resolveBatchDownloadOutcome({
      total: selectedEpisodes.length,
      completed: processed,
      cancelled: cancelBatchRef.current,
      error: failures.length > 0 ? failures[0] : undefined,
    })

    if (result.outcome === 'success') {
      toast.success(t('searchPage.batchDownload.done'))
    } else if (failures.length > 0) {
      toast.error(
        t('searchPage.batchDownload.partial', {
          done: succeeded,
          total: result.total,
          failed: failures.length,
          message: failures[0],
        })
      )
    } else {
      toast.info(
        t('searchPage.batchDownload.cancelled', {
          done: succeeded,
          total: result.total,
        })
      )
    }

    setBatchProgress(null)
    clearSelection()
    setIsSelectMode(false)
  }

  const handleCancelBatch = () => {
    cancelBatchRef.current = true
  }

  return (
    <TabLayout>
      <TabToolbar title={season.title} showBackButton onGoBack={goBack}>
        <Stack direction="row" gap={1} alignItems="center">
          <BookmarkToggleButton season={season} />
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
        fallbackRender={({ error }) => (
          <ErrorMessage message={(error as Error).message} />
        )}
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

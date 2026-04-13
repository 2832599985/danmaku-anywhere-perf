import type {
  EpisodeMeta,
  Season,
  WithSeason,
} from '@danmaku-anywhere/danmaku-converter'
import { MergeType } from '@mui/icons-material'
import {
  Badge,
  Button,
  Checkbox,
  IconButton,
  LinearProgress,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material'
import { useQuery } from '@tanstack/react-query'
import { Suspense, useMemo, useRef, useState } from 'react'
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
import { seasonQueryKeys } from '@/common/queries/queryKeys'
import { chromeRpcClient } from '@/common/rpcClient/background/client'
import { useLoadDanmaku } from '@/content/controller/common/hooks/useLoadDanmaku'
import { useStore } from '@/content/controller/store/store'

type SeasonDetailsPageProps = {
  season: Season
  onGoBack: () => void
}

const buildEpisodeKey = (meta: WithSeason<EpisodeMeta>) => {
  return `${meta.provider}:${meta.seasonId}:${meta.indexedId}`
}

export const SeasonDetailsPage = ({
  season,
  onGoBack,
}: SeasonDetailsPageProps) => {
  const { t } = useTranslation()
  const toast = useToast.use.toast()

  const { loadMutation, mergeLoadMutation, canMerge } = useLoadDanmaku()
  const { mutateAsync: download, isPending: isDownloading } =
    useFetchDanmakuLite()
  const { sources } = useStore.use.danmaku()

  // Share cache with `EpisodeSearchList` (which uses Suspense), but keep this non-suspense so
  // the toolbar can render immediately and we can implement "select all" without reaching into the list.
  const episodesQuery = useQuery({
    queryKey: seasonQueryKeys.episodes(season.id),
    queryFn: () =>
      chromeRpcClient.episodeFetchBySeason({ seasonId: season.id }),
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
    if (selectedKeys.size === 0) return []
    return allEpisodes.filter((ep) => selectedKeys.has(buildEpisodeKey(ep)))
  }, [allEpisodes, selectedKeys])

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
    if (allEpisodes.length === 0) return
    setSelectedKeys(new Set(allEpisodes.map(buildEpisodeKey)))
  }

  const handleCancelBatch = () => {
    cancelBatchRef.current = true
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
        // Download into extension storage without mounting into the player.
        await download({
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

        // Yield so the UI can remain responsive while we run sequential downloads.
        // eslint-disable-next-line no-await-in-loop
        await new Promise((r) => setTimeout(r, 0))
      }
    } catch (e) {
      batchError = e
    } finally {
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

  return (
    <TabLayout>
      <TabToolbar showBackButton onGoBack={onGoBack} title={season.title}>
        <Stack direction="row" gap={1} alignItems="center">
          <BookmarkToggleButton season={season} />
          {sources.length > 0 && (
            <Tooltip
              title={
                <div>
                  <div>
                    {t('danmaku.merge.sourceCount', {
                      count: sources.length,
                    })}
                  </div>
                  {sources.map((source, index) => (
                    <div key={`${source.label}-${index}`}>
                      {source.label}: {source.commentCount.toLocaleString()}
                    </div>
                  ))}
                </div>
              }
            >
              <Badge
                badgeContent={sources.length}
                color="secondary"
                sx={{ mr: 1 }}
              >
                <MergeType fontSize="small" />
              </Badge>
            </Tooltip>
          )}
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
                disabled={
                  isBatchDownloading ||
                  selectedCount === 0 ||
                  loadMutation.isPending ||
                  isDownloading
                }
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
              disabled={loadMutation.isPending}
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

              const handleMergeDanmaku = async (
                meta: WithSeason<EpisodeMeta>
              ) => {
                await mergeLoadMutation.mutateAsync({
                  type: 'by-meta',
                  meta,
                  options: {
                    forceUpdate: true,
                  },
                })
              }

              const isLoadingThisEpisode =
                (loadMutation.isPending || mergeLoadMutation.isPending) &&
                (loadMutation.variables?.type === 'by-meta' ||
                  mergeLoadMutation.variables?.type === 'by-meta') &&
                (loadMutation.variables?.meta?.indexedId ===
                  data.episode.indexedId ||
                  mergeLoadMutation.variables?.meta?.indexedId ===
                    data.episode.indexedId)

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
                    mergeLoadMutation.isPending ||
                    isBatchDownloading ||
                    isDownloading
                  }
                  renderSecondaryAction={() => {
                    if (isSelectMode) {
                      return (
                        <Checkbox
                          edge="end"
                          checked={selectedKeys.has(key)}
                          disabled={isBatchDownloading}
                          onClick={(e) => e.stopPropagation()}
                          onChange={() => toggleSelectedKey(key)}
                        />
                      )
                    }
                    if (canMerge) {
                      return (
                        <Tooltip title={t('danmaku.merge.mergeWithCurrent')}>
                          <IconButton
                            edge="end"
                            size="small"
                            disabled={
                              loadMutation.isPending ||
                              mergeLoadMutation.isPending ||
                              isDownloading
                            }
                            onClick={async (e) => {
                              e.stopPropagation()
                              await handleMergeDanmaku(data.episode)
                            }}
                          >
                            <MergeType fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      )
                    }
                    return null
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

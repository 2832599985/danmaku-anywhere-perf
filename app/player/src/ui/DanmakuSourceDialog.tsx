import {
  Box,
  CircularProgress,
  Dialog,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { alpha } from '@mui/material/styles'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { chooseSeason } from '@/danmaku/autoMatch'
import type { DdpEpisode, DdpSeason } from '@/danmaku/ddp'
import {
  fetchEpisodeComments,
  fetchSeasonEpisodes,
  searchSeasons,
} from '@/danmaku/ddp'
import { learnRule } from '@/danmaku/filenameRules'
import { usePlayerCommands } from '@/player/commands'
import { useFullscreenPortalContainer } from '@/player/fullscreenPortal'
import { usePlayerStore } from '@/store/playerStore'
import {
  GOLD,
  GREEN,
  hardShadow,
  hatchSx,
  INK,
  LINE_STRONG,
  LINE_WEAK,
  MONO,
  PAPER,
  VERMILION,
} from '@/theme/theme'
import { InkPanelHeader } from '@/ui/ink'
import { errorMessage } from './shared'

const LocalTab = ({ onDone }: { onDone: () => void }) => {
  const commands = usePlayerCommands()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handlePick = async () => {
    setError(null)
    setLoading(true)
    try {
      await commands.loadDanmakuFromFile()
      onDone()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setLoading(false)
    }
  }

  return (
    <Stack spacing={2}>
      <Typography variant="body2" color="text.secondary">
        从本地导入弹幕文件（支持 Bilibili XML 与 JSON）。
      </Typography>

      {/* Drop zone */}
      <Box
        component="button"
        type="button"
        onClick={handlePick}
        disabled={loading}
        sx={{
          appearance: 'none',
          cursor: 'pointer',
          padding: '20px',
          border: `2px dashed ${alpha(PAPER, 0.3)}`,
          background: 'transparent',
          color: alpha(PAPER, 0.6),
          fontSize: 12,
          fontWeight: 700,
          transition: 'border 100ms steps(1), color 100ms steps(1)',
          '&:hover': {
            borderColor: PAPER,
            color: PAPER,
          },
        }}
      >
        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center' }}>
            <CircularProgress size={24} />
          </Box>
        ) : (
          '选择弹幕文件 (.xml / .json) · 或拖入'
        )}
      </Box>

      {error && (
        <Box
          sx={{
            padding: '8px 12px',
            border: `2px solid ${VERMILION}`,
            background: alpha(VERMILION, 0.08),
            color: VERMILION,
            fontSize: 12,
            fontWeight: 700,
          }}
        >
          {error}
        </Box>
      )}
    </Stack>
  )
}

const OnlineTab = ({ onDone }: { onDone: () => void }) => {
  const prefill = usePlayerStore((s) => s.danmakuSearchPrefill)
  const dialogOpen = usePlayerStore((s) => s.danmakuDialogOpen)
  const [keyword, setKeyword] = useState('')
  const [searching, setSearching] = useState(false)
  const [results, setResults] = useState<DdpSeason[]>([])
  const [searched, setSearched] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [episodes, setEpisodes] = useState<Record<string, DdpEpisode[]>>({})
  const [loadingSeason, setLoadingSeason] = useState<string | null>(null)
  const [fetchingId, setFetchingId] = useState<number | null>(null)

  const searchingRef = useRef(false)
  // The prefill we have already acted on — the dialog stays mounted between
  // opens, so this is what stops a re-search storm on every re-render.
  const handledRef = useRef<string | null>(null)
  const episodesRef = useRef(episodes)
  episodesRef.current = episodes

  const loadEpisodes = useCallback(async (season: DdpSeason) => {
    if (episodesRef.current[season.bangumiId]) return
    setLoadingSeason(season.bangumiId)
    try {
      const list = await fetchSeasonEpisodes(season)
      setEpisodes((prev) => ({ ...prev, [season.bangumiId]: list }))
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setLoadingSeason(null)
    }
  }, [])

  const runSearch = useCallback(
    async (raw: string) => {
      const trimmed = raw.trim()
      if (!trimmed || searchingRef.current) return
      searchingRef.current = true
      setSearching(true)
      setError(null)
      try {
        const seasons = await searchSeasons(trimmed)
        setResults(seasons)
        setSearched(true)
        // Expand the season the shared matcher would have chosen, so the
        // episode grid for the likely show is on screen immediately.
        const best = chooseSeason(seasons, trimmed, trimmed)
        setExpanded(best ? best.bangumiId : null)
        if (best) void loadEpisodes(best)
      } catch (e) {
        setError(errorMessage(e))
        setResults([])
        setSearched(true)
      } finally {
        setSearching(false)
        searchingRef.current = false
      }
    },
    [loadEpisodes]
  )

  // The automatic matcher hands us a keyword + the episode it wanted; open
  // pre-searched so the user only has to click the right episode.
  useEffect(() => {
    if (!dialogOpen || !prefill) return
    const key = `${prefill.keyword}|${prefill.targetEpisode ?? 0}`
    if (handledRef.current === key) return
    handledRef.current = key
    setKeyword(prefill.keyword)
    void runSearch(prefill.keyword)
  }, [dialogOpen, prefill, runSearch])

  const handlePickEpisode = async (season: DdpSeason, ep: DdpEpisode) => {
    if (fetchingId !== null) return
    setFetchingId(ep.episodeId)
    setError(null)
    try {
      const comments = await fetchEpisodeComments(ep.episodeId)
      const store = usePlayerStore.getState()
      store.setComments(comments, {
        label: `${season.title} · ${ep.title}`,
        count: comments.length,
      })
      // This is the only place a human picks a season + episode by hand, so it
      // is where the file-name shape becomes known. The next file of the same
      // batch then mounts without asking (see `filenameRules`).
      const path = store.media?.path
      if (path && store.danmakuSettings.learnFilenamePatterns) {
        const rule = learnRule({
          filePath: path,
          episode: Number(ep.episodeNumber),
          season: {
            bangumiId: season.bangumiId,
            title: season.title,
            episodeCount: season.episodeCount,
          },
        })
        if (rule) {
          store.addFilenameRule(rule)
          store.showOsd('已记住此命名格式 · 下次自动匹配', '📐')
        }
      }
      onDone()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setFetchingId(null)
    }
  }

  // Which season the shared matcher considers the best title match.
  const bestSeasonId = useMemo(() => {
    if (results.length === 0) return null
    const probe = keyword.trim() || prefill?.keyword || ''
    return chooseSeason(results, probe, probe)?.bangumiId ?? null
  }, [results, keyword, prefill])

  const target = prefill?.targetEpisode ?? 0

  const episodeLabel = (ep: DdpEpisode): string =>
    typeof ep.episodeNumber === 'number'
      ? `第${ep.episodeNumber}集`
      : ep.title || String(ep.episodeNumber)

  return (
    <Stack spacing={2}>
      {prefill?.note && (
        <Box
          sx={{
            border: `2px solid ${GOLD}`,
            background: alpha(GOLD, 0.08),
            color: GOLD,
            fontSize: 12,
            fontWeight: 700,
            padding: '8px 10px',
          }}
        >
          {prefill.note}
          {target > 0 ? ` · 猜测第 ${target} 集` : ''}
        </Box>
      )}

      {/* Search row — bordered input box + button as siblings (per design). */}
      <Box sx={{ display: 'flex', gap: '8px' }}>
        <Box
          sx={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            border: `2px solid ${PAPER}`,
            background: alpha(PAPER, 0.06),
            padding: '0 12px',
            height: 44,
            gap: '8px',
          }}
        >
          <Typography
            sx={{
              fontFamily: MONO,
              fontSize: 12,
              fontWeight: 700,
              color: VERMILION,
              whiteSpace: 'nowrap',
              flexShrink: 0,
            }}
          >
            SEARCH
          </Typography>

          <TextField
            fullWidth
            placeholder="搜索番剧 / Search anime…"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void runSearch(keyword)
            }}
            variant="standard"
            slotProps={{
              input: {
                disableUnderline: true,
                sx: {
                  fontSize: 14,
                  fontWeight: 700,
                  color: PAPER,
                  '&::placeholder': {
                    color: alpha(PAPER, 0.4),
                    opacity: 1,
                  },
                },
              },
            }}
          />

          {keyword && !searching && (
            <Box
              sx={{
                display: 'inline-block',
                width: 2,
                height: 18,
                background: VERMILION,
                animation: 'ink-blink 1s steps(1) infinite',
                flexShrink: 0,
              }}
            />
          )}
        </Box>

        <Box
          component="button"
          type="button"
          onClick={() => void runSearch(keyword)}
          disabled={searching || !keyword.trim()}
          sx={{
            appearance: 'none',
            cursor: 'pointer',
            padding: '0 26px',
            border: `2px solid ${VERMILION}`,
            background: VERMILION,
            color: PAPER,
            fontSize: 14,
            fontWeight: 900,
            boxShadow: hardShadow(4, PAPER),
            transition: 'background 100ms steps(1), color 100ms steps(1)',
            flexShrink: 0,
            '&:hover:not(:disabled)': {
              background: PAPER,
              color: VERMILION,
            },
            '&:disabled': {
              opacity: 0.4,
            },
          }}
        >
          {searching ? <CircularProgress size={14} color="inherit" /> : '搜索'}
        </Box>
      </Box>

      {error && (
        <Box
          sx={{
            padding: '8px 12px',
            border: `2px solid ${VERMILION}`,
            background: alpha(VERMILION, 0.08),
            color: VERMILION,
            fontSize: 12,
            fontWeight: 700,
          }}
        >
          {error}
        </Box>
      )}

      {searching && (
        <Stack alignItems="center" sx={{ py: 4 }}>
          <CircularProgress size={28} />
        </Stack>
      )}

      {!searching && searched && results.length === 0 && !error && (
        <Typography
          sx={{
            py: 4,
            textAlign: 'center',
            fontSize: 12,
            color: alpha(PAPER, 0.5),
          }}
        >
          未找到相关结果 / No results
        </Typography>
      )}

      {!searching && results.length > 0 && (
        <Stack spacing={1} sx={{ maxHeight: 360, overflowY: 'auto' }}>
          {results.map((season) => {
            const isExpanded = expanded === season.bangumiId
            const isBest = season.bangumiId === bestSeasonId
            const list = episodes[season.bangumiId]
            const loading = loadingSeason === season.bangumiId

            return isExpanded ? (
              // Expanded card
              <Box
                key={season.bangumiId}
                sx={{
                  border: `3px solid ${isBest ? GREEN : PAPER}`,
                  padding: '12px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px',
                  position: 'relative',
                }}
              >
                {isBest && (
                  <Box
                    sx={{
                      position: 'absolute',
                      top: -10,
                      right: 8,
                      padding: '2px 6px',
                      border: `2px solid ${GREEN}`,
                      background: INK,
                      fontFamily: MONO,
                      fontSize: 9,
                      fontWeight: 700,
                      color: GREEN,
                      letterSpacing: '0.08em',
                    }}
                  >
                    BEST MATCH
                  </Box>
                )}

                {/* Cover + title row */}
                <Stack direction="row" gap={1}>
                  <Box
                    sx={{
                      ...hatchSx(),
                      width: 44,
                      height: 58,
                      border: LINE_WEAK,
                      flexShrink: 0,
                    }}
                  />

                  <Stack sx={{ flex: 1, minWidth: 0, gap: 0.5 }}>
                    <Typography
                      sx={{
                        fontSize: 15,
                        fontWeight: 900,
                        color: PAPER,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        display: '-webkit-box',
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: 'vertical',
                      }}
                    >
                      {season.title}
                    </Typography>

                    <Stack direction="row" gap={1} sx={{ flexWrap: 'wrap' }}>
                      <Typography
                        sx={{
                          fontSize: 10,
                          fontWeight: 700,
                          color: alpha(PAPER, 0.6),
                        }}
                      >
                        {season.typeDescription || season.type}
                      </Typography>
                      {Number.isFinite(season.year) && (
                        <Typography
                          sx={{
                            fontFamily: MONO,
                            fontSize: 10,
                            fontWeight: 700,
                            color: alpha(PAPER, 0.5),
                          }}
                        >
                          {season.year}
                        </Typography>
                      )}
                      <Typography
                        sx={{
                          fontFamily: MONO,
                          fontSize: 10,
                          fontWeight: 700,
                          color: alpha(PAPER, 0.5),
                        }}
                      >
                        {season.episodeCount} 集
                      </Typography>
                    </Stack>
                  </Stack>
                </Stack>

                {/* Episodes grid — loaded on demand for this season */}
                {loading && (
                  <Stack alignItems="center" sx={{ py: 2 }}>
                    <CircularProgress size={20} />
                  </Stack>
                )}

                {!loading && list && (
                  <Box
                    sx={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(4, 1fr)',
                      gap: '6px',
                    }}
                  >
                    {list.map((ep) => {
                      const isTarget =
                        target > 0 &&
                        String(ep.episodeNumber) === String(target)
                      const isFetching = fetchingId === ep.episodeId
                      return (
                        <Box
                          key={ep.episodeId}
                          component="button"
                          type="button"
                          onClick={() => void handlePickEpisode(season, ep)}
                          disabled={fetchingId !== null}
                          title={ep.title}
                          sx={{
                            appearance: 'none',
                            cursor: 'pointer',
                            padding: '7px 4px',
                            border: isTarget
                              ? `3px solid ${VERMILION}`
                              : LINE_WEAK,
                            background: isFetching
                              ? VERMILION
                              : isTarget
                                ? alpha(VERMILION, 0.18)
                                : 'transparent',
                            color: isFetching
                              ? PAPER
                              : isTarget
                                ? VERMILION
                                : alpha(PAPER, 0.8),
                            fontSize: 11,
                            fontWeight: 700,
                            transition: 'all 100ms steps(1)',
                            boxShadow: isFetching ? hardShadow(3) : 'none',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            minHeight: 28,
                            '&:hover:not(:disabled)': {
                              border: `3px solid ${PAPER}`,
                              background: PAPER,
                              color: INK,
                            },
                            '&:disabled': {
                              opacity: 0.5,
                            },
                          }}
                        >
                          {isFetching ? (
                            <CircularProgress size={12} color="inherit" />
                          ) : (
                            episodeLabel(ep)
                          )}
                        </Box>
                      )
                    })}
                  </Box>
                )}

                {/* Collapse button */}
                <Box
                  component="button"
                  type="button"
                  onClick={() => setExpanded(null)}
                  sx={{
                    appearance: 'none',
                    cursor: 'pointer',
                    padding: '4px 8px',
                    border: LINE_WEAK,
                    background: 'transparent',
                    color: alpha(PAPER, 0.6),
                    fontSize: 11,
                    fontWeight: 700,
                    transition: 'border 100ms steps(1), color 100ms steps(1)',
                    alignSelf: 'flex-start',
                    marginTop: '4px',
                    '&:hover': {
                      border: LINE_STRONG,
                      color: PAPER,
                    },
                  }}
                >
                  ▴ 收起
                </Box>
              </Box>
            ) : (
              // Collapsed row
              <Box
                key={season.bangumiId}
                component="button"
                type="button"
                onClick={() => {
                  setExpanded(season.bangumiId)
                  void loadEpisodes(season)
                }}
                sx={{
                  appearance: 'none',
                  cursor: 'pointer',
                  padding: '9px 11px',
                  border: isBest ? `3px solid ${GREEN}` : LINE_WEAK,
                  background: 'transparent',
                  color: alpha(PAPER, 0.8),
                  fontSize: 12,
                  fontWeight: 700,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1,
                  transition:
                    'border 100ms steps(1), background 100ms steps(1)',
                  '&:hover': {
                    border: LINE_STRONG,
                    background: alpha(PAPER, 0.06),
                  },
                }}
              >
                <Box
                  sx={{
                    ...hatchSx(),
                    width: 36,
                    height: 48,
                    border: LINE_WEAK,
                    flexShrink: 0,
                  }}
                />

                <Stack sx={{ flex: 1, minWidth: 0, gap: 0.25 }}>
                  <Typography
                    sx={{
                      fontSize: 12,
                      fontWeight: 700,
                      color: PAPER,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {season.title}
                  </Typography>
                  <Typography
                    sx={{
                      fontFamily: MONO,
                      fontSize: 10,
                      fontWeight: 700,
                      color: alpha(PAPER, 0.5),
                    }}
                  >
                    {season.typeDescription || season.type}
                    {' · '}
                    {season.episodeCount} 集
                  </Typography>
                </Stack>

                <Typography
                  sx={{
                    fontSize: 12,
                    color: alpha(PAPER, 0.5),
                    flexShrink: 0,
                  }}
                >
                  ▸
                </Typography>
              </Box>
            )
          })}
        </Stack>
      )}
    </Stack>
  )
}
export const DanmakuSourceDialog = () => {
  const open = usePlayerStore((s) => s.danmakuDialogOpen)
  const setDanmakuDialogOpen = usePlayerStore((s) => s.setDanmakuDialogOpen)
  const prefill = usePlayerStore((s) => s.danmakuSearchPrefill)
  const container = useFullscreenPortalContainer()
  const [tab, setTab] = useState<0 | 1>(1)

  // Opened by the automatic matcher → always land on the online tab, which is
  // where the pre-searched results are.
  useEffect(() => {
    if (open && prefill) setTab(1)
  }, [open, prefill])

  const close = () => setDanmakuDialogOpen(false)

  return (
    <Dialog
      open={open}
      onClose={close}
      slotProps={{ root: { container } }}
      PaperProps={{
        sx: {
          width: 760,
          maxWidth: '90vw',
          maxHeight: '80vh',
        },
      }}
    >
      <Stack sx={{ height: '100%' }}>
        {/* Header */}
        <InkPanelHeader kicker="DANMAKU SOURCE" zh="挂载弹幕" onClose={close} />

        {/* Tab buttons */}
        <Stack direction="row" sx={{ borderBottom: LINE_STRONG }}>
          {[
            { value: 1 as const, label: '在线搜索 · DanDanPlay' },
            { value: 0 as const, label: '本地文件 · XML / JSON / ASS' },
          ].map((btn) => (
            <Box
              key={btn.value}
              component="button"
              type="button"
              onClick={() => setTab(btn.value)}
              sx={{
                appearance: 'none',
                flex: 1,
                cursor: 'pointer',
                padding: '12px 16px',
                border: 'none',
                borderBottom: tab === btn.value ? `3px solid ${PAPER}` : 'none',
                background: tab === btn.value ? PAPER : 'transparent',
                color: tab === btn.value ? INK : alpha(PAPER, 0.6),
                fontSize: 12,
                fontWeight: 700,
                transition: 'all 100ms steps(1)',
                '&:hover': {
                  background: tab === btn.value ? PAPER : alpha(PAPER, 0.06),
                },
              }}
            >
              {btn.label}
            </Box>
          ))}
        </Stack>

        {/* Content */}
        <Box
          sx={{
            flex: 1,
            overflowY: 'auto',
            padding: '16px',
          }}
        >
          {tab === 0 ? (
            <LocalTab onDone={close} />
          ) : (
            <OnlineTab onDone={close} />
          )}
        </Box>

        {/* Footer */}
        <Stack
          direction="row"
          alignItems="center"
          sx={{
            borderTop: LINE_STRONG,
            padding: '12px 16px',
            gap: 1,
          }}
        >
          <Typography
            sx={{
              fontSize: 11,
              fontWeight: 700,
              color: alpha(PAPER, 0.5),
              flex: 1,
            }}
          >
            同名 .xml / .json 会在打开视频时自动挂载
          </Typography>

          <Box
            component="button"
            type="button"
            onClick={close}
            sx={{
              appearance: 'none',
              cursor: 'pointer',
              padding: '7px 16px',
              border: LINE_WEAK,
              background: 'transparent',
              color: alpha(PAPER, 0.8),
              fontSize: 12,
              fontWeight: 700,
              transition: 'border 100ms steps(1), color 100ms steps(1)',
              '&:hover': {
                border: LINE_STRONG,
                color: PAPER,
              },
            }}
          >
            取消
          </Box>
        </Stack>
      </Stack>
    </Dialog>
  )
}

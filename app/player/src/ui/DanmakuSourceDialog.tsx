import {
  Box,
  CircularProgress,
  Dialog,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { alpha } from '@mui/material/styles'
import { useState } from 'react'
import type { DdpAnime, DdpEpisode } from '@/danmaku/ddp'
import { fetchEpisodeComments, searchDanmaku } from '@/danmaku/ddp'
import { usePlayerCommands } from '@/player/commands'
import { useFullscreenPortalContainer } from '@/player/fullscreenPortal'
import { usePlayerStore } from '@/store/playerStore'
import {
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
  const [keyword, setKeyword] = useState('')
  const [searching, setSearching] = useState(false)
  const [results, setResults] = useState<DdpAnime[]>([])
  const [searched, setSearched] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<number | null>(
    results.length === 1 ? results[0]?.animeId : null
  )
  const [fetchingId, setFetchingId] = useState<number | null>(null)

  const handleSearch = async () => {
    const trimmed = keyword.trim()
    if (!trimmed || searching) return
    setSearching(true)
    setError(null)
    try {
      const animes = await searchDanmaku(trimmed)
      setResults(animes)
      setSearched(true)
      setExpanded(animes.length === 1 ? animes[0].animeId : null)
    } catch (e) {
      setError(errorMessage(e))
      setResults([])
      setSearched(true)
    } finally {
      setSearching(false)
    }
  }

  const handlePickEpisode = async (anime: DdpAnime, ep: DdpEpisode) => {
    if (fetchingId !== null) return
    setFetchingId(ep.episodeId)
    setError(null)
    try {
      const comments = await fetchEpisodeComments(ep.episodeId)
      usePlayerStore.getState().setComments(comments, {
        label: `${anime.animeTitle} ${ep.episodeTitle}`,
        count: comments.length,
      })
      onDone()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setFetchingId(null)
    }
  }

  return (
    <Stack spacing={2}>
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
              if (e.key === 'Enter') void handleSearch()
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
          onClick={() => void handleSearch()}
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
          {results.map((anime, idx) => {
            const isExpanded = expanded === anime.animeId
            const isBest = idx === 0

            return isExpanded ? (
              // Expanded card
              <Box
                key={anime.animeId}
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
                      {anime.animeTitle}
                    </Typography>

                    <Stack direction="row" gap={1} sx={{ flexWrap: 'wrap' }}>
                      <Typography
                        sx={{
                          fontSize: 10,
                          fontWeight: 700,
                          color: alpha(PAPER, 0.6),
                        }}
                      >
                        {anime.typeDescription || anime.type}
                      </Typography>
                      <Typography
                        sx={{
                          fontFamily: MONO,
                          fontSize: 10,
                          fontWeight: 700,
                          color: alpha(PAPER, 0.5),
                        }}
                      >
                        animeId {anime.animeId}
                      </Typography>
                    </Stack>
                  </Stack>
                </Stack>

                {/* Episodes grid */}
                <Box
                  sx={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(4, 1fr)',
                    gap: '6px',
                  }}
                >
                  {anime.episodes.map((ep) => (
                    <Box
                      key={ep.episodeId}
                      component="button"
                      type="button"
                      onClick={() => void handlePickEpisode(anime, ep)}
                      disabled={fetchingId !== null}
                      title={ep.episodeTitle}
                      sx={{
                        appearance: 'none',
                        cursor: 'pointer',
                        padding: '7px 4px',
                        border: LINE_WEAK,
                        background:
                          fetchingId === ep.episodeId
                            ? VERMILION
                            : 'transparent',
                        color:
                          fetchingId === ep.episodeId
                            ? PAPER
                            : alpha(PAPER, 0.8),
                        fontSize: 11,
                        fontWeight: 700,
                        transition: 'all 100ms steps(1)',
                        boxShadow:
                          fetchingId === ep.episodeId ? hardShadow(3) : 'none',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        minHeight: 28,
                        '&:hover:not(:disabled)': {
                          border: LINE_STRONG,
                          background: PAPER,
                          color: INK,
                        },
                        '&:disabled': {
                          opacity: 0.5,
                        },
                      }}
                    >
                      {fetchingId === ep.episodeId ? (
                        <CircularProgress size={12} color="inherit" />
                      ) : (
                        ep.episodeTitle
                      )}
                    </Box>
                  ))}
                </Box>

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
                key={anime.animeId}
                component="button"
                type="button"
                onClick={() => setExpanded(anime.animeId)}
                sx={{
                  appearance: 'none',
                  cursor: 'pointer',
                  padding: '9px 11px',
                  border: LINE_WEAK,
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
                    {anime.animeTitle}
                  </Typography>
                  <Typography
                    sx={{
                      fontFamily: MONO,
                      fontSize: 10,
                      fontWeight: 700,
                      color: alpha(PAPER, 0.5),
                    }}
                  >
                    {anime.typeDescription || anime.type}
                    {' · '}
                    ID {anime.animeId}
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
  const container = useFullscreenPortalContainer()
  const [tab, setTab] = useState<0 | 1>(1)

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

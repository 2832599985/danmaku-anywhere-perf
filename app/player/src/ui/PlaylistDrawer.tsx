import { Box, Drawer, Stack, Typography } from '@mui/material'
import { alpha } from '@mui/material/styles'
import { useEffect, useRef, useState } from 'react'
import { usePlayerCommands } from '@/player/commands'
import { useFullscreenPortalContainer } from '@/player/fullscreenPortal'
import type { PlaylistItem, ResumeEntry } from '@/store/playerStore'
import { usePlayerStore } from '@/store/playerStore'
import {
  INK,
  inkHold,
  inkHoldOn,
  LINE_SUBTLE,
  MONO,
  PAPER,
  VERMILION,
} from '@/theme/theme'
import { InkBlinkDot, InkPanelHeader, InkStamp, InkSwitch } from '@/ui/ink'
import { CloseIcon, PlusIcon } from './icons'
import { formatTime } from './TimeDisplay'

/** A finished item is one watched to (nearly) the end. */
const WATCHED_RATIO = 0.95

const relativeTime = (timestamp: number): string => {
  if (!timestamp || timestamp <= 0) return ''
  const elapsed = Date.now() - timestamp
  if (!Number.isFinite(elapsed) || elapsed < 0) return ''
  const minutes = Math.floor(elapsed / 60_000)
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时前`
  const days = Math.floor(hours / 24)
  return days < 30 ? `${days} 天前` : `${Math.floor(days / 30)} 个月前`
}

/** Human summary of a resume point, plus how far through it is (0..1). */
const describeProgress = (
  entry: ResumeEntry | undefined
): { text: string; ratio: number } | null => {
  if (!entry) return null
  const ratio = entry.duration > 0 ? entry.time / entry.duration : 0
  if (ratio >= WATCHED_RATIO) {
    return { text: '已看完', ratio: 1 }
  }
  const position = entry.duration
    ? `${formatTime(entry.time)} / ${formatTime(entry.duration)}`
    : formatTime(entry.time)
  return { text: position, ratio }
}

const itemKey = (item: PlaylistItem): string => item.path ?? item.url

export const PlaylistDrawer = () => {
  const commands = usePlayerCommands()
  const container = useFullscreenPortalContainer()
  const playlist = usePlayerStore((s) => s.playlist)
  const playlistOpen = usePlayerStore((s) => s.playlistOpen)
  const media = usePlayerStore((s) => s.media)
  const progress = usePlayerStore((s) => s.progress)
  const activeKey = media ? (media.path ?? media.url) : null
  const autoAdvance = usePlayerStore((s) => s.playbackSettings.autoAdvance)
  const setPlaylistOpen = usePlayerStore((s) => s.setPlaylistOpen)
  const removePlaylistIndex = usePlayerStore((s) => s.removePlaylistIndex)
  const clearPlaylist = usePlayerStore((s) => s.clearPlaylist)
  const updatePlaybackSettings = usePlayerStore((s) => s.updatePlaybackSettings)

  const [confirmClear, setConfirmClear] = useState(false)
  const activeRowRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!confirmClear) return
    const timer = window.setTimeout(() => setConfirmClear(false), 3000)
    return () => window.clearTimeout(timer)
  }, [confirmClear])

  useEffect(() => {
    if (!playlistOpen) {
      setConfirmClear(false)
      return
    }
    const raf = window.requestAnimationFrame(() => {
      activeRowRef.current?.scrollIntoView({ block: 'nearest' })
    })
    return () => window.cancelAnimationFrame(raf)
  }, [playlistOpen])

  const handleRemoveItem = (
    e: React.MouseEvent<HTMLElement>,
    index: number
  ) => {
    e.stopPropagation()
    removePlaylistIndex(index)
  }

  const handleClearClick = () => {
    if (!confirmClear) {
      setConfirmClear(true)
      return
    }
    setConfirmClear(false)
    clearPlaylist()
  }

  return (
    <Drawer
      anchor="right"
      open={playlistOpen}
      onClose={() => setPlaylistOpen(false)}
      slotProps={{
        root: { container },
        paper: { sx: { width: 452 } },
      }}
    >
      <Stack sx={{ height: '100%' }}>
        {/* Header */}
        <InkPanelHeader
          kicker={`PLAYLIST · ${playlist.length}`}
          zh="播放列表"
          onClose={() => setPlaylistOpen(false)}
        />

        {/* Toolbar row */}
        <Stack
          direction="row"
          alignItems="center"
          spacing={1}
          sx={{
            px: 2,
            py: 1.5,
            borderBottom: LINE_SUBTLE,
          }}
        >
          <Box
            component="button"
            type="button"
            onClick={() => void commands.addVideosToPlaylist()}
            sx={{
              appearance: 'none',
              cursor: 'pointer',
              padding: '7px 12px',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              fontFamily: 'inherit',
              fontSize: 12,
              fontWeight: 700,
              ...inkHold(2),
              background: 'transparent',
              color: alpha(PAPER, 0.8),
              transition: 'border-color 0ms, color 0ms, box-shadow 0ms',
              '&:hover': { ...inkHoldOn(PAPER), color: PAPER },
              '&:focus-visible': {
                outline: `2px solid ${VERMILION}`,
                outlineOffset: '2px',
              },
            }}
          >
            <PlusIcon size={12} />
            添加
          </Box>

          <Box
            component="button"
            type="button"
            onClick={handleClearClick}
            disabled={playlist.length === 0}
            sx={{
              appearance: 'none',
              cursor: 'pointer',
              padding: '7px 12px',
              fontFamily: 'inherit',
              fontSize: 12,
              fontWeight: 700,
              ...inkHold(2),
              ...(confirmClear ? inkHoldOn(VERMILION) : {}),
              background: confirmClear ? VERMILION : 'transparent',
              color: confirmClear ? PAPER : alpha(PAPER, 0.8),
              transition: 'border-color 0ms, color 0ms, box-shadow 0ms',
              opacity: playlist.length === 0 ? 0.4 : 1,
              pointerEvents: playlist.length === 0 ? 'none' : 'auto',
              '&:hover': {
                ...inkHoldOn(VERMILION),
                color: confirmClear ? PAPER : VERMILION,
              },
              '&:focus-visible': {
                outline: `2px solid ${VERMILION}`,
                outlineOffset: '2px',
              },
            }}
          >
            {confirmClear ? '确认清空?' : '清空'}
          </Box>

          <Box sx={{ flex: 1 }} />

          <Stack direction="row" alignItems="center" spacing={0.75}>
            <Typography
              sx={{
                fontSize: 11,
                fontWeight: 700,
                color: PAPER,
              }}
            >
              自动连播
            </Typography>
            <InkSwitch
              checked={autoAdvance}
              label="自动连播"
              onChange={(checked: boolean) =>
                updatePlaybackSettings({ autoAdvance: checked })
              }
            />
          </Stack>
        </Stack>

        {/* Playlist content */}
        <Box
          sx={{
            flex: 1,
            overflowY: 'auto',
            padding: '16px 16px 12px',
          }}
        >
          {playlist.length === 0 ? (
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                height: '100%',
                px: 2,
              }}
            >
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{ textAlign: 'center' }}
              >
                列表为空 · 打开或拖入多个视频
              </Typography>
            </Box>
          ) : (
            <Stack spacing={1.25}>
              {playlist.map((item, index) => {
                const isActive = itemKey(item) === activeKey
                const resume = describeProgress(
                  item.path ? progress[item.path] : undefined
                )
                return (
                  <Box
                    key={`${index}:${item.url}`}
                    ref={isActive ? activeRowRef : undefined}
                    role="button"
                    tabIndex={0}
                    aria-current={isActive ? 'true' : undefined}
                    onClick={() => commands.playlistPlayAt(index)}
                    onKeyDown={(e: React.KeyboardEvent) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        commands.playlistPlayAt(index)
                      }
                    }}
                    sx={{
                      appearance: 'none',
                      cursor: 'pointer',
                      background: isActive
                        ? `linear-gradient(135deg, ${alpha(VERMILION, 0.12)}, transparent)`
                        : 'transparent',
                      // Constant 2px footprint: the stroke only changes colour,
                      // so nothing reflows when a row becomes active.
                      border: `2px solid ${isActive ? VERMILION : 'transparent'}`,
                      boxShadow: isActive
                        ? `inset 4px 0 0 ${VERMILION}`
                        : `inset 0 0 0 1px ${alpha(PAPER, 0.22)}`,
                      padding: isActive ? '16px 11px 9px' : '9px 11px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '7px',
                      transition:
                        'border-color 0ms, background 0ms, box-shadow 0ms',
                      position: 'relative',
                      '&:hover': {
                        borderColor: isActive ? VERMILION : PAPER,
                        background: isActive
                          ? `linear-gradient(135deg, ${alpha(VERMILION, 0.16)}, transparent)`
                          : alpha(PAPER, 0.06),
                      },
                      '&:focus-visible': {
                        outline: `2px solid ${VERMILION}`,
                        outlineOffset: '2px',
                      },
                    }}
                  >
                    {/* Now playing stamp */}
                    {isActive && (
                      <InkStamp
                        rotate={-3}
                        sx={{
                          position: 'absolute',
                          top: -9,
                          left: 10,
                          fontSize: 9,
                        }}
                      >
                        NOW PLAYING
                      </InkStamp>
                    )}

                    {/* Row 1: index, name, time */}
                    <Stack direction="row" alignItems="center" gap={1}>
                      <Typography
                        sx={{
                          fontFamily: MONO,
                          fontSize: 11,
                          fontWeight: 700,
                          color: alpha(PAPER, 0.5),
                          minWidth: 20,
                          textAlign: 'right',
                        }}
                      >
                        {String(index + 1).padStart(2, '0')}
                      </Typography>

                      <Typography
                        title={item.name}
                        sx={{
                          flex: 1,
                          minWidth: 0,
                          fontSize: 12,
                          fontWeight: 700,
                          color: PAPER,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {item.name}
                      </Typography>

                      <Typography
                        sx={{
                          fontFamily: MONO,
                          fontSize: 10,
                          fontWeight: 700,
                          color: alpha(PAPER, 0.55),
                          whiteSpace: 'nowrap',
                          flexShrink: 0,
                        }}
                      >
                        {relativeTime(
                          item.path ? (progress[item.path]?.updatedAt ?? 0) : 0
                        )}
                      </Typography>

                      {isActive && <InkBlinkDot size={6} />}
                    </Stack>

                    {/* Row 2: progress bar + time */}
                    <Stack
                      direction="row"
                      alignItems="center"
                      gap={1}
                      sx={{ minHeight: 12 }}
                    >
                      <Box
                        data-playlist-progress
                        sx={{
                          flex: 1,
                          height: 5,
                          border: LINE_SUBTLE,
                          background: INK,
                          position: 'relative',
                          overflow: 'hidden',
                        }}
                      >
                        {resume && (
                          <Box
                            sx={{
                              position: 'absolute',
                              left: 0,
                              top: 0,
                              bottom: 0,
                              width: `${Math.min(resume.ratio * 100, 100)}%`,
                              background: isActive ? VERMILION : PAPER,
                            }}
                          />
                        )}
                      </Box>

                      <Typography
                        sx={{
                          fontFamily: MONO,
                          fontSize: 10,
                          fontWeight: 700,
                          color: alpha(PAPER, 0.55),
                          whiteSpace: 'nowrap',
                          minWidth: 50,
                          textAlign: 'right',
                        }}
                      >
                        {resume?.text}
                      </Typography>

                      {/* Remove button */}
                      <Box
                        component="button"
                        type="button"
                        aria-label={`从列表移除 ${item.name}`}
                        onClick={(e) => {
                          e.stopPropagation()
                          handleRemoveItem(e, index)
                        }}
                        sx={{
                          appearance: 'none',
                          cursor: 'pointer',
                          width: 20,
                          height: 20,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          border: 'none',
                          background: 'transparent',
                          color: alpha(PAPER, 0.4),
                          fontSize: 14,
                          fontWeight: 700,
                          transition: 'color 0ms',
                          flexShrink: 0,
                          '&:hover': {
                            color: VERMILION,
                          },
                          '&:focus-visible': {
                            outline: `2px solid ${VERMILION}`,
                            outlineOffset: '1px',
                          },
                        }}
                      >
                        <CloseIcon size={11} />
                      </Box>
                    </Stack>
                  </Box>
                )
              })}
            </Stack>
          )}
        </Box>
      </Stack>
    </Drawer>
  )
}

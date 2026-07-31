import { Box, Drawer, Stack, Typography } from '@mui/material'
import { alpha } from '@mui/material/styles'
import { usePlayerCommands } from '@/player/commands'
import { useFullscreenPortalContainer } from '@/player/fullscreenPortal'
import type { PlaylistItem, ResumeEntry } from '@/store/playerStore'
import { usePlayerStore } from '@/store/playerStore'
import {
  INK,
  LINE_STRONG,
  LINE_WEAK,
  MONO,
  PAPER,
  VERMILION,
} from '@/theme/theme'
import { InkBlinkDot, InkPanelHeader, InkStamp, InkSwitch } from '@/ui/ink'
import { formatTime } from './TimeDisplay'

/** A finished item is one watched to (nearly) the end. */
const WATCHED_RATIO = 0.95

const relativeTime = (timestamp: number): string => {
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

  const handleRemoveItem = (
    e: React.MouseEvent<HTMLButtonElement>,
    index: number
  ) => {
    e.stopPropagation()
    removePlaylistIndex(index)
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
            borderBottom: `2px solid ${alpha(PAPER, 0.2)}`,
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
              fontFamily: 'inherit',
              fontSize: 12,
              fontWeight: 700,
              border: LINE_WEAK,
              background: 'transparent',
              color: alpha(PAPER, 0.8),
              transition: 'border 100ms steps(1), color 100ms steps(1)',
              '&:hover': {
                border: LINE_STRONG,
                color: PAPER,
              },
            }}
          >
            ＋ 添加
          </Box>

          <Box
            component="button"
            type="button"
            onClick={() => clearPlaylist()}
            disabled={playlist.length === 0}
            sx={{
              appearance: 'none',
              cursor: 'pointer',
              padding: '7px 12px',
              fontFamily: 'inherit',
              fontSize: 12,
              fontWeight: 700,
              border: LINE_WEAK,
              background: 'transparent',
              color: alpha(PAPER, 0.8),
              transition: 'border 100ms steps(1), color 100ms steps(1)',
              opacity: playlist.length === 0 ? 0.4 : 1,
              pointerEvents: playlist.length === 0 ? 'none' : 'auto',
              '&:hover': {
                border: `2px solid ${VERMILION}`,
                color: VERMILION,
              },
            }}
          >
            清空
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
              onChange={(checked: boolean) =>
                updatePlaybackSettings({ autoAdvance: checked })
              }
            />
          </Stack>
        </Stack>

        {/* Playlist content */}
        <Box sx={{ flex: 1, overflowY: 'auto', paddingTop: '16px' }}>
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
            <Stack spacing={0}>
              {playlist.map((item, index) => {
                const isActive = itemKey(item) === activeKey
                const resume = describeProgress(
                  item.path ? progress[item.path] : undefined
                )
                return (
                  <Box
                    key={`${index}:${item.url}`}
                    component="button"
                    type="button"
                    onClick={() => commands.playlistPlayAt(index)}
                    onContextMenu={(e: React.MouseEvent<HTMLButtonElement>) => {
                      e.preventDefault()
                      handleRemoveItem(e, index)
                    }}
                    sx={{
                      appearance: 'none',
                      cursor: 'pointer',
                      background: isActive
                        ? `linear-gradient(135deg, ${alpha(VERMILION, 0.12)}, transparent)`
                        : 'transparent',
                      border: isActive
                        ? `3px solid ${VERMILION}`
                        : `2px solid ${alpha(PAPER, 0.28)}`,
                      padding: '9px 11px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '7px',
                      transition:
                        'border 100ms steps(1), background 100ms steps(1)',
                      position: 'relative',
                      '&:hover': {
                        border: `2px solid ${PAPER}`,
                        background: isActive
                          ? `linear-gradient(135deg, ${alpha(VERMILION, 0.16)}, transparent)`
                          : alpha(PAPER, 0.06),
                      },
                    }}
                  >
                    {/* Now playing stamp */}
                    {isActive && (
                      <InkStamp
                        rotate={-3}
                        sx={{
                          position: 'absolute',
                          top: -12,
                          left: 10,
                          fontSize: 10,
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
                        sx={{
                          flex: 1,
                          minWidth: 0,
                          fontSize: 12,
                          fontWeight: 700,
                          color: PAPER,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          title: item.name,
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
                          border: `2px solid ${alpha(PAPER, 0.16)}`,
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
                          transition: 'color 100ms steps(1)',
                          flexShrink: 0,
                          '&:hover': {
                            color: VERMILION,
                          },
                        }}
                      >
                        ✕
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

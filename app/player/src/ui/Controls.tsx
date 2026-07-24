import {
  FullscreenExitRounded,
  FullscreenRounded,
  PauseRounded,
  PlayArrowRounded,
  SkipNextRounded,
  SkipPreviousRounded,
  SpeedRounded,
  SubtitlesOffRounded,
  SubtitlesRounded,
  TuneRounded,
} from '@mui/icons-material'
import {
  Badge,
  Box,
  IconButton,
  Menu,
  MenuItem,
  Stack,
  Tooltip,
} from '@mui/material'
import { useState } from 'react'
import { usePlayerCommands } from '@/player/commands'
import { usePlayerStore } from '@/store/playerStore'
import { glassSx, RADIUS } from '@/theme/theme'
import { ProgressBar } from './ProgressBar'
import { TimeDisplay } from './TimeDisplay'
import { VolumeControl } from './VolumeControl'

const PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 2] as const

interface ControlsProps {
  /** When false, the bar fades and slides out (parent owns the hide timer). */
  visible: boolean
}

export const Controls = ({ visible }: ControlsProps) => {
  const commands = usePlayerCommands()
  const playing = usePlayerStore((s) => s.playback.playing)
  const fullscreen = usePlayerStore((s) => s.playback.fullscreen)
  const playbackRate = usePlayerStore((s) => s.playback.playbackRate)
  const danmakuVisible = usePlayerStore((s) => s.danmakuSettings.visible)
  const danmakuSource = usePlayerStore((s) => s.danmakuSource)
  const playlist = usePlayerStore((s) => s.playlist)
  const playlistIndex = usePlayerStore((s) => s.playlistIndex)
  const setSettingsOpen = usePlayerStore((s) => s.setSettingsOpen)

  const [rateAnchor, setRateAnchor] = useState<HTMLElement | null>(null)

  const PlayIcon = playing ? PauseRounded : PlayArrowRounded

  const canPlaylistPrev = playlistIndex > 0
  const canPlaylistNext =
    playlistIndex >= 0 && playlistIndex < playlist.length - 1

  return (
    <Box
      sx={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        px: 1.5,
        pb: 1,
        pt: 4,
        zIndex: 20,
        background:
          'linear-gradient(to top, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0.28) 55%, transparent 100%)',
        opacity: visible ? 1 : 0,
        transform: visible ? 'translateY(0)' : 'translateY(12px)',
        transition: 'opacity 220ms ease, transform 220ms ease',
        pointerEvents: visible ? 'auto' : 'none',
      }}
    >
      <Box
        sx={{
          ...glassSx(0.55),
          borderRadius: `${RADIUS.l}px`,
          px: 1.25,
          py: 0.5,
          display: 'flex',
          flexDirection: 'column',
          gap: 0.25,
        }}
      >
        <Stack direction="row" alignItems="center" spacing={0.75}>
          <Tooltip title={playing ? '暂停 / Pause' : '播放 / Play'}>
            <IconButton
              onClick={() => commands.togglePlay()}
              sx={{ color: '#fff' }}
            >
              <PlayIcon />
            </IconButton>
          </Tooltip>

          <Tooltip title="上一个 / Previous">
            <span>
              <IconButton
                onClick={() => commands.playlistPrev()}
                disabled={!canPlaylistPrev}
                size="small"
                sx={{ color: '#fff' }}
              >
                <SkipPreviousRounded fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>

          <Tooltip title="下一个 / Next">
            <span>
              <IconButton
                onClick={() => commands.playlistNext()}
                disabled={!canPlaylistNext}
                size="small"
                sx={{ color: '#fff' }}
              >
                <SkipNextRounded fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>

          <TimeDisplay />

          <ProgressBar />

          <VolumeControl />

          <Tooltip title="播放速度 / Speed">
            <IconButton
              size="small"
              onClick={(e) => setRateAnchor(e.currentTarget)}
              sx={{
                minWidth: 44,
                borderRadius: '999px',
                gap: 0.25,
                fontSize: 13,
                fontWeight: 700,
                fontVariantNumeric: 'tabular-nums',
                color: playbackRate !== 1 ? 'primary.light' : '#fff',
              }}
            >
              <SpeedRounded fontSize="small" />
              {playbackRate}×
            </IconButton>
          </Tooltip>
          <Menu
            anchorEl={rateAnchor}
            open={Boolean(rateAnchor)}
            onClose={() => setRateAnchor(null)}
            anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
            transformOrigin={{ vertical: 'bottom', horizontal: 'center' }}
          >
            {PLAYBACK_RATES.map((rate) => (
              <MenuItem
                key={rate}
                dense
                selected={rate === playbackRate}
                onClick={() => {
                  commands.setPlaybackRate(rate)
                  setRateAnchor(null)
                }}
                sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}
              >
                {rate}×{rate === 1 ? ' 正常' : ''}
              </MenuItem>
            ))}
          </Menu>

          <Tooltip
            title={
              danmakuVisible
                ? '关闭弹幕 / Danmaku off'
                : '开启弹幕 / Danmaku on'
            }
          >
            <IconButton
              size="small"
              onClick={() => commands.toggleDanmaku()}
              sx={{ color: danmakuVisible ? 'primary.light' : '#fff' }}
            >
              <Badge
                variant="dot"
                color="secondary"
                invisible={!danmakuSource}
                overlap="circular"
              >
                {danmakuVisible ? (
                  <SubtitlesRounded fontSize="small" />
                ) : (
                  <SubtitlesOffRounded fontSize="small" />
                )}
              </Badge>
            </IconButton>
          </Tooltip>

          <Tooltip title="设置 / Settings">
            <IconButton
              size="small"
              onClick={() => setSettingsOpen(true)}
              sx={{ color: '#fff' }}
            >
              <TuneRounded fontSize="small" />
            </IconButton>
          </Tooltip>

          <Tooltip
            title={
              fullscreen ? '退出全屏 / Exit fullscreen' : '全屏 / Fullscreen'
            }
          >
            <IconButton
              size="small"
              onClick={() => commands.toggleFullscreen()}
              sx={{ color: '#fff' }}
            >
              {fullscreen ? (
                <FullscreenExitRounded fontSize="small" />
              ) : (
                <FullscreenRounded fontSize="small" />
              )}
            </IconButton>
          </Tooltip>
        </Stack>
      </Box>
    </Box>
  )
}

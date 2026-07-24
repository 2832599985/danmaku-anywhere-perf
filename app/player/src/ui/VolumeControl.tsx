import {
  VolumeDownRounded,
  VolumeOffRounded,
  VolumeUpRounded,
} from '@mui/icons-material'
import { Box, IconButton, Slider, Tooltip } from '@mui/material'
import { useState } from 'react'
import { usePlayerCommands } from '@/player/commands'
import { usePlayerStore } from '@/store/playerStore'

/** Mute toggle + expand-on-hover horizontal volume slider (0..1). */
export const VolumeControl = () => {
  const commands = usePlayerCommands()
  const volume = usePlayerStore((s) => s.playback.volume)
  const muted = usePlayerStore((s) => s.playback.muted)
  const [hovering, setHovering] = useState(false)

  const effective = muted ? 0 : volume
  const Icon =
    effective <= 0
      ? VolumeOffRounded
      : effective < 0.5
        ? VolumeDownRounded
        : VolumeUpRounded

  return (
    <Box
      sx={{ display: 'flex', alignItems: 'center' }}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
    >
      <Tooltip title={muted ? '取消静音 / Unmute' : '静音 / Mute'}>
        <IconButton size="small" onClick={() => commands.toggleMute()}>
          <Icon fontSize="small" />
        </IconButton>
      </Tooltip>
      <Box
        sx={{
          width: hovering ? 84 : 0,
          opacity: hovering ? 1 : 0,
          overflow: 'hidden',
          transition: 'width 180ms ease, opacity 180ms ease',
          display: 'flex',
          alignItems: 'center',
          px: hovering ? 1 : 0,
        }}
      >
        <Slider
          size="small"
          value={effective}
          min={0}
          max={1}
          step={0.01}
          aria-label="音量 / Volume"
          onChange={(_, v) => commands.setVolume(Array.isArray(v) ? v[0] : v)}
        />
      </Box>
    </Box>
  )
}

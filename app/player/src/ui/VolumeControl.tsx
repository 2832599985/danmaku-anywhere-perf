import { alpha, Box, Typography } from '@mui/material'
import { useRef } from 'react'
import { usePlayerCommands } from '@/player/commands'
import { usePlayerStore } from '@/store/playerStore'
import { INK, MONO, PAPER } from '@/theme/theme'

/**
 * ♪ mute square + a 96×8 rectangular level bar + a mono readout.
 * The bar is pointer-driven directly (no MUI Slider) to match the ink design.
 */
export const VolumeControl = () => {
  const commands = usePlayerCommands()
  const volume = usePlayerStore((s) => s.playback.volume)
  const muted = usePlayerStore((s) => s.playback.muted)
  const barRef = useRef<HTMLDivElement>(null)

  const level = muted ? 0 : volume
  const percent = Math.round(level * 100)

  const commit = (clientX: number) => {
    const el = barRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    if (rect.width <= 0) return
    const r = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
    commands.setVolume(r)
  }

  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        marginLeft: '14px',
        flexShrink: 0,
      }}
    >
      <Box
        component="button"
        type="button"
        aria-label={muted ? '取消静音 / Unmute' : '静音 / Mute'}
        onClick={() => commands.toggleMute()}
        sx={{
          appearance: 'none',
          width: 38,
          height: 38,
          border: `2px solid ${alpha(PAPER, 0.6)}`,
          background: 'transparent',
          color: muted ? alpha(PAPER, 0.35) : PAPER,
          fontSize: 14,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          padding: 0,
          lineHeight: 1,
          transition: 'background-color 100ms steps(1), color 100ms steps(1)',
          '&:hover': { background: PAPER, color: INK },
        }}
      >
        ♪
      </Box>

      <Box
        ref={barRef}
        role="slider"
        aria-label="音量 / Volume"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        tabIndex={0}
        onPointerDown={(e: React.PointerEvent<HTMLDivElement>) => {
          e.currentTarget.setPointerCapture(e.pointerId)
          commit(e.clientX)
        }}
        onPointerMove={(e: React.PointerEvent<HTMLDivElement>) => {
          if (e.buttons & 1) commit(e.clientX)
        }}
        onKeyDown={(e: React.KeyboardEvent) => {
          if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
            e.preventDefault()
            commands.setVolume(Math.max(0, level - 0.05))
          } else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
            e.preventDefault()
            commands.setVolume(Math.min(1, level + 0.05))
          }
        }}
        sx={{
          position: 'relative',
          width: 96,
          height: 8,
          border: `2px solid ${PAPER}`,
          background: INK,
          cursor: 'pointer',
          touchAction: 'none',
          flexShrink: 0,
          '&:focus-visible': { outline: `2px solid ${PAPER}` },
        }}
      >
        <Box
          sx={{
            position: 'absolute',
            left: 0,
            top: 0,
            bottom: 0,
            width: `${level * 100}%`,
            background: PAPER,
          }}
        />
      </Box>

      <Typography
        component="span"
        sx={{
          fontFamily: MONO,
          fontSize: 12,
          color: alpha(PAPER, 0.6),
          fontVariantNumeric: 'tabular-nums',
          minWidth: 22,
          flexShrink: 0,
        }}
      >
        {percent}
      </Typography>
    </Box>
  )
}

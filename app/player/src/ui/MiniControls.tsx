import { Box } from '@mui/material'
import { alpha } from '@mui/material/styles'
import { useRef, useState } from 'react'
import { usePlayerCommands } from '@/player/commands'
import { usePlayerStore } from '@/store/playerStore'
import {
  INK,
  LINE_STRONG,
  MONO,
  MOTION_PANEL,
  PAPER,
  VERMILION,
} from '@/theme/theme'
import { ExitFullscreenIcon, PauseIcon, PlayIcon } from './icons'
import { formatTime } from './TimeDisplay'

const buttonSx = {
  width: 30,
  height: 30,
  display: 'grid',
  placeItems: 'center',
  background: INK,
  color: PAPER,
  border: LINE_STRONG,
  cursor: 'pointer',
  padding: 0,
  transition: 'background-color 0ms, color 0ms, border-color 0ms',
  '&:hover': { background: VERMILION, borderColor: VERMILION },
  '&:focus-visible': {
    outline: `2px solid ${VERMILION}`,
    outlineOffset: '1px',
  },
} as const

/**
 * The whole chrome of the mini player (小窗): a scrim, a seekable progress
 * line and two buttons, shown on hover. Everything else in the window is a
 * drag handle for the window itself (`data-tauri-drag-region` on the stage
 * while mini).
 */
export const MiniControls = ({ visible }: { visible: boolean }) => {
  const commands = usePlayerCommands()
  const playing = usePlayerStore((s) => s.playback.playing)
  const currentTime = usePlayerStore((s) => s.playback.currentTime)
  const duration = usePlayerStore((s) => s.playback.duration)
  const ratio = duration > 0 ? Math.min(currentTime / duration, 1) : 0
  const barRef = useRef<HTMLDivElement>(null)
  const draggingRef = useRef(false)
  // Pointer position over the strip, for the hover readout (null = away).
  const [hoverRatio, setHoverRatio] = useState<number | null>(null)

  const ratioFromClientX = (clientX: number): number => {
    const el = barRef.current
    if (!el) return 0
    const rect = el.getBoundingClientRect()
    if (rect.width <= 0) return 0
    return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
  }

  const commit = (clientX: number) => {
    if (!barRef.current || duration <= 0) return
    commands.seekTo(ratioFromClientX(clientX) * duration)
  }

  return (
    <Box
      data-mini-controls
      sx={{
        position: 'absolute',
        inset: 0,
        zIndex: 5,
        pointerEvents: 'none',
        opacity: visible ? 1 : 0,
        transition: `opacity ${MOTION_PANEL}`,
        '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
      }}
    >
      {/* Top scrim keeps the tiny status label legible over bright frames. */}
      <Box
        sx={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: 44,
          background:
            'linear-gradient(to bottom, rgba(10,10,12,0.82), transparent)',
          pointerEvents: 'none',
        }}
      />

      <Box
        sx={{
          position: 'absolute',
          top: 8,
          right: 8,
          display: 'flex',
          gap: '6px',
          pointerEvents: visible ? 'auto' : 'none',
        }}
      >
        <Box
          component="button"
          type="button"
          aria-label={playing ? '暂停 / Pause' : '播放 / Play'}
          onClick={() => commands.togglePlay()}
          // The stage beneath is a drag region; a press here must stay a click.
          onMouseDown={(e: React.MouseEvent) => e.stopPropagation()}
          onPointerDown={(e: React.PointerEvent) => e.stopPropagation()}
          onDoubleClick={(e: React.MouseEvent) => e.stopPropagation()}
          sx={buttonSx}
        >
          {playing ? <PauseIcon size={13} /> : <PlayIcon size={13} />}
        </Box>
        <Box
          component="button"
          type="button"
          aria-label="退出小窗 / Exit mini player"
          onClick={() => void commands.toggleMiniPlayer()}
          onMouseDown={(e: React.MouseEvent) => e.stopPropagation()}
          onPointerDown={(e: React.PointerEvent) => e.stopPropagation()}
          onDoubleClick={(e: React.MouseEvent) => e.stopPropagation()}
          sx={buttonSx}
        >
          <ExitFullscreenIcon size={14} />
        </Box>
      </Box>

      <Box
        ref={barRef}
        data-mini-progress
        role="slider"
        aria-label="播放进度 / Seek"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(ratio * 100)}
        tabIndex={visible ? 0 : -1}
        onMouseDown={(e: React.MouseEvent) => e.stopPropagation()}
        onPointerDown={(e: React.PointerEvent<HTMLDivElement>) => {
          e.stopPropagation()
          e.currentTarget.setPointerCapture(e.pointerId)
          draggingRef.current = true
          commit(e.clientX)
        }}
        onPointerEnter={(e: React.PointerEvent<HTMLDivElement>) => {
          if (duration > 0) setHoverRatio(ratioFromClientX(e.clientX))
        }}
        onPointerMove={(e: React.PointerEvent<HTMLDivElement>) => {
          if (duration > 0) setHoverRatio(ratioFromClientX(e.clientX))
          if (!draggingRef.current) return
          e.stopPropagation()
          commit(e.clientX)
        }}
        onPointerLeave={() => {
          if (!draggingRef.current) setHoverRatio(null)
        }}
        onPointerUp={(e: React.PointerEvent<HTMLDivElement>) => {
          e.stopPropagation()
          if (!draggingRef.current) return
          commit(e.clientX)
          draggingRef.current = false
          try {
            e.currentTarget.releasePointerCapture(e.pointerId)
          } catch {
            // capture may already be released
          }
        }}
        onPointerCancel={() => {
          draggingRef.current = false
        }}
        onDoubleClick={(e: React.MouseEvent) => e.stopPropagation()}
        onKeyDown={(e: React.KeyboardEvent) => {
          if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
          e.preventDefault()
          commands.seekTo(
            Math.max(
              0,
              Math.min(duration, currentTime + (e.key === 'ArrowLeft' ? -5 : 5))
            )
          )
        }}
        sx={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          height: 3,
          background: alpha(PAPER, 0.25),
          cursor: 'pointer',
          touchAction: 'none',
          pointerEvents: visible ? 'auto' : 'none',
          transition: `height ${MOTION_PANEL}`,
          '&:hover': { height: 6 },
          '&::before': {
            content: '""',
            position: 'absolute',
            inset: '-8px 0 0',
          },
          '&:focus-visible': { outline: `2px solid ${VERMILION}` },
          '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
        }}
      >
        <Box
          sx={{
            height: '100%',
            width: `${ratio * 100}%`,
            background: VERMILION,
            transition: 'width 120ms linear',
          }}
        />
      </Box>

      {/* Hover readout: the tiny window has no room for a preview card, so the
          timestamp sits just above the strip and clamps inside it. */}
      {visible && hoverRatio !== null && duration > 0 && (
        <Box
          sx={{
            position: 'absolute',
            bottom: 14,
            left: `clamp(0px, calc(${hoverRatio * 100}% - 37px), calc(100% - 74px))`,
            width: 74,
            textAlign: 'center',
            fontFamily: MONO,
            fontSize: 11,
            fontWeight: 700,
            color: PAPER,
            fontVariantNumeric: 'tabular-nums',
            background: INK,
            border: LINE_STRONG,
            padding: '1px 0',
            pointerEvents: 'none',
          }}
        >
          {formatTime(hoverRatio * duration)}
        </Box>
      )}

      <Box
        sx={{
          position: 'absolute',
          left: 8,
          top: 10,
          fontFamily: MONO,
          fontSize: 10,
          color: alpha(PAPER, 0.78),
          letterSpacing: '0.12em',
          pointerEvents: 'none',
        }}
      >
        小窗 · 双击还原
      </Box>
    </Box>
  )
}

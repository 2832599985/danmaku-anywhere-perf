import { Box } from '@mui/material'
import { useRef, useState } from 'react'
import { usePlayerCommands } from '@/player/commands'
import { usePlayerStore } from '@/store/playerStore'
import { ACCENT_GRADIENT } from '@/theme/theme'
import { formatTime } from './TimeDisplay'

const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n)

/**
 * Seek bar with layered played + buffered tracks, a draggable thumb and a
 * hover time bubble. Live-scrubs (seeks on every pointer move) for a smooth
 * feel, and commits again on release.
 */
export const ProgressBar = () => {
  const commands = usePlayerCommands()
  const currentTime = usePlayerStore((s) => s.playback.currentTime)
  const duration = usePlayerStore((s) => s.playback.duration)
  const bufferedEnd = usePlayerStore((s) => s.playback.bufferedEnd)

  const barRef = useRef<HTMLDivElement>(null)
  const draggingRef = useRef(false)
  const [dragging, setDragging] = useState(false)
  const [scrubRatio, setScrubRatio] = useState<number | null>(null)
  const [hoverRatio, setHoverRatio] = useState<number | null>(null)

  const hasDuration = duration > 0

  const ratioFromClientX = (clientX: number): number => {
    const el = barRef.current
    if (!el) return 0
    const rect = el.getBoundingClientRect()
    if (rect.width <= 0) return 0
    return clamp01((clientX - rect.left) / rect.width)
  }

  const playedRatio = clamp01(
    scrubRatio ?? (hasDuration ? currentTime / duration : 0)
  )
  const bufferedRatio = clamp01(hasDuration ? bufferedEnd / duration : 0)

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!hasDuration) return
    e.preventDefault()
    barRef.current?.setPointerCapture(e.pointerId)
    draggingRef.current = true
    setDragging(true)
    const r = ratioFromClientX(e.clientX)
    setScrubRatio(r)
    commands.seekTo(r * duration)
  }

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!hasDuration) return
    const r = ratioFromClientX(e.clientX)
    setHoverRatio(r)
    if (draggingRef.current) {
      setScrubRatio(r)
      commands.seekTo(r * duration)
    }
  }

  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return
    const r = ratioFromClientX(e.clientX)
    commands.seekTo(r * duration)
    draggingRef.current = false
    setDragging(false)
    setScrubRatio(null)
    try {
      barRef.current?.releasePointerCapture(e.pointerId)
    } catch {
      // capture may already be released
    }
  }

  const tipRatio = dragging ? scrubRatio : hoverRatio
  const showTip = hasDuration && tipRatio !== null

  return (
    <Box
      sx={{
        position: 'relative',
        flex: 1,
        minWidth: 80,
        py: 1,
        cursor: hasDuration ? 'pointer' : 'default',
        touchAction: 'none',
      }}
      ref={barRef}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onPointerLeave={() => setHoverRatio(null)}
    >
      {/* rail */}
      <Box
        sx={{
          position: 'relative',
          height: dragging ? 6 : 4,
          borderRadius: '999px',
          backgroundColor: 'rgba(255,255,255,0.16)',
          overflow: 'hidden',
          transition: 'height 120ms ease',
        }}
      >
        {/* buffered */}
        <Box
          sx={{
            position: 'absolute',
            inset: 0,
            transformOrigin: 'left',
            width: `${bufferedRatio * 100}%`,
            backgroundColor: 'rgba(255,255,255,0.28)',
          }}
        />
        {/* hover preview fill */}
        {showTip && !dragging && (
          <Box
            sx={{
              position: 'absolute',
              inset: 0,
              width: `${(tipRatio ?? 0) * 100}%`,
              backgroundColor: 'rgba(255,255,255,0.14)',
            }}
          />
        )}
        {/* played */}
        <Box
          sx={{
            position: 'absolute',
            inset: 0,
            width: `${playedRatio * 100}%`,
            backgroundImage: ACCENT_GRADIENT,
            transition: dragging ? 'none' : 'width 120ms linear',
          }}
        />
      </Box>

      {/* thumb */}
      <Box
        sx={{
          position: 'absolute',
          top: '50%',
          left: `${playedRatio * 100}%`,
          width: 12,
          height: 12,
          borderRadius: '50%',
          backgroundColor: '#fff',
          boxShadow: '0 0 0 4px rgba(167,139,250,0.35)',
          transform: 'translate(-50%, -50%)',
          opacity: dragging || hoverRatio !== null ? 1 : 0,
          transition: 'opacity 120ms ease',
          pointerEvents: 'none',
        }}
      />

      {/* hover / scrub time bubble */}
      {showTip && (
        <Box
          sx={{
            position: 'absolute',
            bottom: '100%',
            left: `${(tipRatio ?? 0) * 100}%`,
            transform: 'translate(-50%, -4px)',
            px: 0.75,
            py: 0.25,
            borderRadius: '6px',
            fontSize: 11.5,
            fontWeight: 700,
            fontVariantNumeric: 'tabular-nums',
            color: '#fff',
            backgroundColor: 'rgba(20,20,32,0.9)',
            backdropFilter: 'blur(8px)',
            border: '1px solid rgba(255,255,255,0.1)',
            pointerEvents: 'none',
            whiteSpace: 'nowrap',
          }}
        >
          {formatTime((tipRatio ?? 0) * duration)}
        </Box>
      )}
    </Box>
  )
}

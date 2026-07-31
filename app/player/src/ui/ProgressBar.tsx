import { alpha, Box, Typography } from '@mui/material'
import { useEffect, useMemo, useRef, useState } from 'react'
import { usePlayerCommands } from '@/player/commands'
import { useOpEdMarks } from '@/player/useOpEdMarks'
import { usePlayerStore } from '@/store/playerStore'
import { GOLD, hatchSx, INK, MONO, PAPER, VERMILION } from '@/theme/theme'
import { formatTime } from './TimeDisplay'

const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n)

const PREVIEW_W = 246
const THUMB_W = 240
const THUMB_H = 132

/**
 * Seek bar: 14px rectangle with paper stroke, buffered + played fills, an 8px
 * vermilion block thumb, gold OP/ED ticks inferred from danmaku density, and a
 * hover preview card that decodes the frame at the hovered timestamp.
 */
export const ProgressBar = () => {
  const commands = usePlayerCommands()
  const currentTime = usePlayerStore((s) => s.playback.currentTime)
  const duration = usePlayerStore((s) => s.playback.duration)
  const bufferedEnd = usePlayerStore((s) => s.playback.bufferedEnd)
  const comments = usePlayerStore((s) => s.comments)
  const media = usePlayerStore((s) => s.media)

  const barRef = useRef<HTMLDivElement>(null)
  const draggingRef = useRef(false)
  const [dragging, setDragging] = useState(false)
  const [scrubRatio, setScrubRatio] = useState<number | null>(null)
  const [hoverRatio, setHoverRatio] = useState<number | null>(null)
  const lastHoverAt = useRef(0)

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
    // Throttle the preview target; the fill/thumb still track every move.
    const now = performance.now()
    if (now - lastHoverAt.current > 200) {
      lastHoverAt.current = now
      setHoverRatio(r)
    }
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
  const tipTime = (tipRatio ?? 0) * duration

  const commentsNearTip = useMemo(() => {
    if (!showTip || comments.length === 0) return 0
    let n = 0
    for (const c of comments) {
      const t = Number.parseFloat(c.p)
      if (Number.isFinite(t) && Math.abs(t - tipTime) <= 5) n += 1
    }
    return n
  }, [showTip, tipTime, comments])

  const marks = useOpEdMarks(comments, duration)

  // Hidden decoder for the hover thumbnail. Created lazily, reused per media.
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const decoderRef = useRef<HTMLVideoElement | null>(null)

  useEffect(
    () => () => {
      decoderRef.current?.remove()
      decoderRef.current = null
    },
    []
  )

  useEffect(() => {
    if (!showTip || !media?.url) return
    let cancelled = false

    if (!decoderRef.current) {
      const v = document.createElement('video')
      v.style.display = 'none'
      v.preload = 'metadata'
      v.muted = true
      v.crossOrigin = 'anonymous'
      document.body.appendChild(v)
      decoderRef.current = v
    }
    const decoder = decoderRef.current
    if (decoder.src !== media.url) decoder.src = media.url

    const draw = () => {
      if (cancelled) return
      const canvas = canvasRef.current
      if (!canvas || !decoder.videoWidth) return
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      const scale = Math.min(
        THUMB_W / decoder.videoWidth,
        THUMB_H / decoder.videoHeight
      )
      const w = Math.floor(decoder.videoWidth * scale)
      const h = Math.floor(decoder.videoHeight * scale)
      ctx.fillStyle = INK
      ctx.fillRect(0, 0, THUMB_W, THUMB_H)
      try {
        ctx.drawImage(decoder, (THUMB_W - w) / 2, (THUMB_H - h) / 2, w, h)
      } catch {
        // tainted/undecodable frame — keep the ink fill
      }
    }

    decoder.addEventListener('seeked', draw)
    try {
      decoder.currentTime = tipTime
    } catch {
      // metadata not ready yet; the next hover tick retries
    }
    return () => {
      cancelled = true
      decoder.removeEventListener('seeked', draw)
    }
  }, [showTip, media?.url, tipTime])

  return (
    <Box
      ref={barRef}
      sx={{
        position: 'relative',
        height: 14,
        border: `2px solid ${PAPER}`,
        background: INK,
        cursor: hasDuration ? 'pointer' : 'default',
        touchAction: 'none',
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onPointerLeave={() => setHoverRatio(null)}
    >
      {/* buffered */}
      <Box
        sx={{
          position: 'absolute',
          left: 0,
          top: 0,
          bottom: 0,
          width: `${bufferedRatio * 100}%`,
          background: alpha(PAPER, 0.22),
        }}
      />
      {/* played */}
      <Box
        sx={{
          position: 'absolute',
          left: 0,
          top: 0,
          bottom: 0,
          width: `${playedRatio * 100}%`,
          background: PAPER,
          transition: dragging ? 'none' : 'width 120ms linear',
        }}
      />

      {marks.opEnd !== null && (
        <Box
          title="推测 OP 结束"
          sx={{
            position: 'absolute',
            left: `${(marks.opEnd / duration) * 100}%`,
            top: -4,
            bottom: -4,
            width: 3,
            background: GOLD,
            pointerEvents: 'none',
          }}
        />
      )}
      {marks.edStart !== null && (
        <Box
          title="推测 ED 开始"
          sx={{
            position: 'absolute',
            left: `${(marks.edStart / duration) * 100}%`,
            top: -4,
            bottom: -4,
            width: 3,
            background: GOLD,
            pointerEvents: 'none',
          }}
        />
      )}

      {/* thumb — always visible, per design */}
      <Box
        sx={{
          position: 'absolute',
          left: `${playedRatio * 100}%`,
          top: -7,
          bottom: -7,
          width: 8,
          background: VERMILION,
          border: `2px solid ${PAPER}`,
          transform: 'translateX(-50%)',
          pointerEvents: 'none',
        }}
      />

      {/* seek preview card */}
      {showTip && (
        <Box
          sx={{
            position: 'absolute',
            bottom: 'calc(100% + 10px)',
            // clamp inside the bar so it never overflows the window
            left: `clamp(0px, calc(${(tipRatio ?? 0) * 100}% - ${PREVIEW_W / 2}px), calc(100% - ${PREVIEW_W}px))`,
            width: PREVIEW_W,
            background: INK,
            border: `3px solid ${PAPER}`,
            boxShadow: `6px 6px 0 ${alpha(VERMILION, 0.9)}`,
            pointerEvents: 'none',
            zIndex: 5,
          }}
        >
          <Box
            sx={{
              position: 'relative',
              height: THUMB_H,
              ...hatchSx('#1b1b22', '#141419', 10),
            }}
          >
            <canvas
              ref={canvasRef}
              width={THUMB_W}
              height={THUMB_H}
              style={{
                display: 'block',
                width: '100%',
                height: THUMB_H,
                position: 'relative',
              }}
            />
          </Box>
          <Box
            sx={{
              borderTop: `2px solid ${PAPER}`,
              padding: '5px 8px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <Typography
              component="span"
              sx={{
                fontFamily: MONO,
                fontSize: 13,
                fontWeight: 700,
                color: PAPER,
              }}
            >
              {formatTime(tipTime)}
            </Typography>
            <Typography
              component="span"
              sx={{ fontSize: 11, fontWeight: 700, color: VERMILION }}
            >
              弹幕 {commentsNearTip} 条
            </Typography>
          </Box>
        </Box>
      )}
    </Box>
  )
}

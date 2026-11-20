import { alpha, Box, Typography } from '@mui/material'
import { useEffect, useMemo, useRef, useState } from 'react'
import { preparedUrlForPath } from '@/platform/prepared'
import { usePlayerCommands } from '@/player/commands'
import { useOpEdMarks } from '@/player/useOpEdMarks'
import { usePlayerStore } from '@/store/playerStore'
import {
  GOLD,
  hardShadow,
  hatchSx,
  INK,
  LINE_FRAME,
  LINE_STRONG,
  MONO,
  PAPER,
  VERMILION,
} from '@/theme/theme'
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
interface ProgressBarProps {
  /** Immediate pointer ratio for the density strip; null when not hovering. */
  onHoverRatio?: (ratio: number | null) => void
}

export const ProgressBar = ({ onHoverRatio }: ProgressBarProps) => {
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
  // The preview card's *visual* position follows the pointer immediately; only
  // the hidden decoder is rate-limited. `frameRatio` is the throttled target.
  const [frameRatio, setFrameRatio] = useState<number | null>(null)
  const frameTimer = useRef<number | null>(null)
  const lastFrameAt = useRef(0)
  const pendingFrame = useRef<number | null>(null)
  // A 240ms follow matches the ~250ms `timeupdate` cadence; real jumps
  // (keyboard seek, drag, resume) must land instantly instead.
  const prevRatio = useRef(0)

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

  const publishHover = (ratio: number | null) => {
    setHoverRatio(ratio)
    onHoverRatio?.(ratio)
  }

  const clearFrameTimer = () => {
    if (frameTimer.current !== null) {
      window.clearTimeout(frameTimer.current)
      frameTimer.current = null
    }
  }

  // Visual tracking is immediate; frame decode/seek is limited to ~160ms. A
  // trailing timer makes sure the last pointer position still gets decoded.
  const queueFrame = (ratio: number) => {
    pendingFrame.current = ratio
    const now = performance.now()
    const wait = 160 - (now - lastFrameAt.current)
    if (wait <= 0) {
      lastFrameAt.current = now
      setFrameRatio(ratio)
      return
    }
    if (frameTimer.current !== null) return
    frameTimer.current = window.setTimeout(() => {
      frameTimer.current = null
      lastFrameAt.current = performance.now()
      if (pendingFrame.current !== null) setFrameRatio(pendingFrame.current)
    }, wait)
  }

  const resetHover = () => {
    clearFrameTimer()
    pendingFrame.current = null
    publishHover(null)
    setFrameRatio(null)
  }

  useEffect(() => clearFrameTimer, [])

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!hasDuration) return
    e.preventDefault()
    barRef.current?.setPointerCapture(e.pointerId)
    draggingRef.current = true
    setDragging(true)
    const r = ratioFromClientX(e.clientX)
    setScrubRatio(r)
    publishHover(r)
    queueFrame(r)
    commands.seekTo(r * duration)
  }

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!hasDuration) return
    const r = ratioFromClientX(e.clientX)
    publishHover(r)
    queueFrame(r)
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
    publishHover(r)
    queueFrame(r)
    try {
      barRef.current?.releasePointerCapture(e.pointerId)
    } catch {
      // capture may already be released
    }
  }

  const smooth = !dragging
  const smallStep =
    !hasDuration || Math.abs(playedRatio - prevRatio.current) * duration < 1.5
  const fillTransition = smooth && smallStep ? 'transform 240ms linear' : 'none'
  const thumbTransition = smooth && smallStep ? 'left 240ms linear' : 'none'
  useEffect(() => {
    prevRatio.current = playedRatio
  })

  const tipRatio = dragging ? scrubRatio : hoverRatio
  const showTip = hasDuration && tipRatio !== null
  const tipTime = (tipRatio ?? 0) * duration
  // Only this throttled timestamp drives the hidden video seek.
  const frameTime = frameRatio !== null ? frameRatio * duration : null

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
    if (!showTip || !media || frameTime === null) return
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
    // FLV/TS/AVI are remuxed before playback: decode the same file the player
    // actually plays, not the original the webview cannot demux.
    const source = (media.path && preparedUrlForPath(media.path)) || media.url
    if (decoder.src !== source) decoder.src = source

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
      decoder.currentTime = frameTime
    } catch {
      // metadata not ready yet; the next hover tick retries
    }
    return () => {
      cancelled = true
      decoder.removeEventListener('seeked', draw)
    }
  }, [showTip, media?.url, media?.path, frameTime])

  return (
    <Box
      ref={barRef}
      sx={{
        position: 'relative',
        height: 14,
        border: LINE_STRONG,
        background: INK,
        cursor: hasDuration ? 'pointer' : 'default',
        touchAction: 'none',
        // 8px of extra hit area above and below the 14px track.
        '&::before': {
          content: '""',
          position: 'absolute',
          inset: '-8px 0',
        },
        '&:focus-visible': {
          outline: `2px solid ${VERMILION}`,
          outlineOffset: '2px',
        },
      }}
      role="slider"
      tabIndex={hasDuration ? 0 : -1}
      aria-label="播放进度 / Seek"
      aria-valuemin={0}
      aria-valuemax={Math.round(duration)}
      aria-valuenow={Math.round(currentTime)}
      onPointerDown={handlePointerDown}
      onPointerEnter={(e) => {
        if (!hasDuration) return
        const r = ratioFromClientX(e.clientX)
        publishHover(r)
        queueFrame(r)
      }}
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onPointerLeave={() => {
        if (!draggingRef.current) resetHover()
      }}
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
          width: '100%',
          background: PAPER,
          transform: `scaleX(${playedRatio})`,
          transformOrigin: 'left center',
          transition: fillTransition,
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
          border: LINE_STRONG,
          transform: 'translateX(-50%)',
          transition: thumbTransition,
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
            border: LINE_FRAME,
            boxShadow: hardShadow(6),
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
              borderTop: LINE_STRONG,
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
                fontVariantNumeric: 'tabular-nums',
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

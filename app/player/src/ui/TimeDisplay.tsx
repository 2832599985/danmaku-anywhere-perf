import { alpha, Box, Typography } from '@mui/material'
import { usePlayerStore } from '@/store/playerStore'
import { MONO, PAPER } from '@/theme/theme'

/**
 * Format a duration in seconds as `m:ss` (or `h:mm:ss` past an hour).
 * Exported so other components (ProgressBar, Osd) share one implementation.
 */
export const formatTime = (seconds: number): string => {
  const safe = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0
  const h = Math.floor(safe / 3600)
  const m = Math.floor((safe % 3600) / 60)
  const s = safe % 60
  const ss = String(s).padStart(2, '0')
  if (h > 0) {
    const mm = String(m).padStart(2, '0')
    return `${h}:${mm}:${ss}`
  }
  return `${m}:${ss}`
}

/** `current / duration` readout, monospaced tabular figures. */
export const TimeDisplay = () => {
  const currentTime = usePlayerStore((s) => s.playback.currentTime)
  const duration = usePlayerStore((s) => s.playback.duration)

  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'baseline',
        marginLeft: '6px',
        letterSpacing: '0.04em',
        fontVariantNumeric: 'tabular-nums',
        userSelect: 'none',
        whiteSpace: 'nowrap',
        flexShrink: 0,
      }}
    >
      <Typography
        component="span"
        sx={{
          fontSize: 16,
          fontWeight: 700,
          fontFamily: MONO,
          color: PAPER,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {formatTime(currentTime)}
      </Typography>
      <Typography
        component="span"
        sx={{
          fontSize: 16,
          fontWeight: 400,
          fontFamily: MONO,
          color: alpha(PAPER, 0.4),
          fontVariantNumeric: 'tabular-nums',
          whiteSpace: 'pre',
        }}
      >
        {` / ${formatTime(duration)}`}
      </Typography>
    </Box>
  )
}

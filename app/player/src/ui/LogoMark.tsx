import { Box } from '@mui/material'
import { INK, PAPER } from '@/theme/theme'

interface LogoMarkProps {
  /** rendered square size in px. */
  size?: number
  /** unused (kept for backwards compat). */
  glow?: number
}

/**
 * Ink mark: PAPER tile with INK play wedge and two ink streak rects.
 * Zero border radius, no gradients or glow.
 */
export const LogoMark = ({ size = 26 }: LogoMarkProps) => (
  <Box
    component="span"
    aria-hidden
    sx={{
      width: size,
      height: size,
      flexShrink: 0,
      display: 'inline-flex',
      background: PAPER,
    }}
  >
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      role="img"
      aria-label="弹幕播放器"
    >
      {/* play wedge, nudged right so the streaks read as motion trails */}
      <path d="M21 15.2 L36.4 24 L21 32.8 Z" fill={INK} fillOpacity="0.92" />
      {/* danmaku streaks */}
      <rect x="9" y="17.4" width="8.5" height="3.6" fill={INK} opacity="0.8" />
      <rect x="11.5" y="27" width="6" height="3.6" fill={INK} opacity="0.5" />
    </svg>
  </Box>
)

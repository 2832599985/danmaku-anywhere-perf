import { Box } from '@mui/material'

interface LogoMarkProps {
  /** rendered square size in px. */
  size?: number
  /** extra glow strength 0..1 (empty-state hero uses more than the top bar). */
  glow?: number
}

/**
 * The app mark: a violet→fuchsia tile with a play wedge and two danmaku
 * streaks flying ahead of it. Inline SVG so it stays crisp at any size and
 * needs no asset pipeline.
 */
export const LogoMark = ({ size = 26, glow = 0.5 }: LogoMarkProps) => (
  <Box
    component="span"
    aria-hidden
    sx={{
      width: size,
      height: size,
      flexShrink: 0,
      display: 'inline-flex',
      borderRadius: `${Math.round(size * 0.28)}px`,
      boxShadow: `0 ${Math.max(2, size * 0.08)}px ${size * 0.55}px rgba(167,139,250,${glow})`,
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
      <defs>
        <linearGradient id="da-logo-grad" x1="4" y1="4" x2="44" y2="44">
          <stop offset="0" stopColor="#7c3aed" />
          <stop offset="0.5" stopColor="#a855f7" />
          <stop offset="1" stopColor="#d946ef" />
        </linearGradient>
        <linearGradient id="da-logo-gloss" x1="24" y1="0" x2="24" y2="26">
          <stop offset="0" stopColor="#fff" stopOpacity="0.32" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <rect width="48" height="48" rx="13.5" fill="url(#da-logo-grad)" />
      {/* top gloss + hairline keep the tile from reading flat */}
      <rect width="48" height="26" rx="13.5" fill="url(#da-logo-gloss)" />
      <rect
        x="0.5"
        y="0.5"
        width="47"
        height="47"
        rx="13"
        fill="none"
        stroke="#fff"
        strokeOpacity="0.18"
      />
      {/* play wedge, nudged right so the streaks read as motion trails */}
      <path d="M21 15.2 L36.4 24 L21 32.8 Z" fill="#fff" fillOpacity="0.96" />
      {/* danmaku streaks */}
      <rect
        x="9"
        y="17.4"
        width="8.5"
        height="3.6"
        rx="1.8"
        fill="#fff"
        fillOpacity="0.85"
      />
      <rect
        x="11.5"
        y="27"
        width="6"
        height="3.6"
        rx="1.8"
        fill="#fff"
        fillOpacity="0.55"
      />
    </svg>
  </Box>
)

import { Box, Typography } from '@mui/material'
import { alpha } from '@mui/material/styles'
import {
  INK_SCRIM_LIGHT,
  MONO,
  MOTION_STAMP_IN,
  PAPER,
  STAGE_Z,
  VERMILION,
} from '@/theme/theme'

/**
 * Drop target shown while a file drag is over the stage. Purely a hint: it is
 * `pointer-events: none`, so the drop itself still lands on the stage (which
 * owns the real handler in PlayerHost).
 */
export const DropOverlay = ({ visible }: { visible: boolean }) => {
  if (!visible) return null
  return (
    <Box
      data-drop-overlay
      sx={{
        position: 'absolute',
        inset: 14,
        zIndex: STAGE_Z.OSD,
        pointerEvents: 'none',
        border: `3px dashed ${VERMILION}`,
        background: INK_SCRIM_LIGHT,
        // Faint halftone grain so the scrim reads as paper, not glass.
        backgroundImage: `radial-gradient(${alpha(PAPER, 0.06)} 1px, transparent 1px)`,
        backgroundSize: '16px 16px',
        display: 'grid',
        placeItems: 'center',
        animation: `ink-panel-in ${MOTION_STAMP_IN}`,
        '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
      }}
    >
      <Box sx={{ textAlign: 'center', padding: '0 24px' }}>
        <Typography
          sx={{
            fontFamily: MONO,
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: '0.32em',
            color: VERMILION,
            marginBottom: '6px',
          }}
        >
          DROP TO OPEN
        </Typography>
        <Typography
          sx={{
            fontSize: 30,
            fontWeight: 900,
            color: PAPER,
            letterSpacing: '0.08em',
            lineHeight: 1.2,
          }}
        >
          松手载入
        </Typography>
        <Typography
          sx={{
            marginTop: '10px',
            fontFamily: MONO,
            fontSize: 11,
            fontWeight: 700,
            color: alpha(PAPER, 0.55),
          }}
        >
          视频 · 弹幕 XML / JSON · 字幕 SRT / ASS / VTT
        </Typography>
      </Box>
    </Box>
  )
}

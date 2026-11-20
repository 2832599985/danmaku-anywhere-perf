import type { CSSObject } from '@mui/material/styles'
import { alpha, createTheme } from '@mui/material/styles'

/**
 * 黑白漫画（单色墨线）+ 朱红点缀 — the manga ink theme.
 * Zero border radius, 2–3px paper strokes, hard vermilion shadows, halftone
 * dot backgrounds. Replaces the old violet glassmorphism wholesale.
 * Design source: 弹幕播放器 UI 设计稿 (DESIGN-HANDOFF.md).
 */

/** 墨黑 — window/panel ground. */
export const INK = '#0a0a0c'
/** 舞台底 — slightly lighter stage ground (settings page, idle screen). */
export const INK_STAGE = '#0d0d10'
/** 纸白 — text, strokes, selected fills. */
export const PAPER = '#f4f1e8'
/** 朱红 — THE accent (selection, activity, danger). */
export const VERMILION = '#ff2f4d'
/** HDR / OP-ED markers. */
export const GOLD = '#ffd23f'
/** status ACTIVE / match success. */
export const GREEN = '#3ddc84'

/**
 * 3-tier ink line hierarchy.
 * FRAME  — major drawers, dialogs, the preview card and the primary CTA.
 * STRONG — primary interactive controls, progress/sliders, OSD, active states.
 * SUBTLE — passive containers and unselected/secondary rules.
 */
export const LINE_FRAME = `3px solid ${PAPER}`
export const LINE_STRONG = `2px solid ${PAPER}`
export const LINE_SUBTLE = `1px solid ${alpha(PAPER, 0.22)}`
/** Legacy alias for controls that intentionally keep a 2px muted edge. */
export const LINE_WEAK = `2px solid ${alpha(PAPER, 0.3)}`

/** Hard comic shadow for key controls; panels go 8–14px. */
export const HARD_SHADOW = `4px 4px 0 ${VERMILION}`
export const hardShadow = (px: number, color: string = VERMILION): string =>
  `${px}px ${px}px 0 ${color}`

/** One crisp curve shared by chrome, panels and page switches. */
export const CRISP_EASE = 'cubic-bezier(0.16, 1, 0.3, 1)'

/**
 * Hard-shadow stamp press used by every physical button. Hover lifts the block
 * by 1px and grows its shadow by 1px; pressing stamps it into the shadow (the
 * shadow collapses proportionally). Colour cuts are instant.
 */
export const inkStampPressSx = (
  px = 4,
  color: string = VERMILION,
  hover: CSSObject = {}
): CSSObject => {
  const depth = Math.max(1, Math.round(px * 0.75))
  const pressed = Math.max(1, px - depth)
  return {
    boxShadow: hardShadow(px, color),
    transition: `transform ${MOTION_PRESS}, box-shadow ${MOTION_PRESS}, background-color 0ms, color 0ms, border-color 0ms`,
    '&:hover': {
      transform: 'translate(-1px, -1px)',
      boxShadow: hardShadow(px + 1, color),
      ...hover,
    },
    '&:active': {
      transform: `translate(${depth}px, ${depth}px)`,
      boxShadow: hardShadow(pressed, color),
      transition: `transform ${MOTION_PRESS}, box-shadow ${MOTION_PRESS}`,
    },
    '@media (prefers-reduced-motion: reduce)': {
      transition: 'opacity 120ms linear',
      '&:hover': {
        transform: 'none',
        boxShadow: hardShadow(px, color),
        ...hover,
      },
      '&:active': {
        transform: 'none',
        boxShadow: hardShadow(px, color),
      },
    },
  }
}

/**
 * Motion system — "comic cut + stamp press".
 * PANEL is the shared show/hide curve for every persistent chrome surface.
 * PRESS is the 65ms tactile travel of a hard-shadow control.
 */
export const MOTION_PANEL = `180ms ${CRISP_EASE}`
export const MOTION_PRESS = '65ms cubic-bezier(0.2, 0, 0, 1)'
export const MOTION_STAMP_IN = `90ms ${CRISP_EASE}`
export const MOTION_STAMP_OUT = `180ms ${CRISP_EASE}`
/** Mounted-danmaku confirmation banner. */
export const MOTION_BANNER = `160ms ${CRISP_EASE}`
/** Settings sub-page cross-cut. */
export const MOTION_SUBPAGE = `110ms ${CRISP_EASE}`
/** Quick-panel popover rise. */
export const MOTION_POPOVER = `140ms ${CRISP_EASE}`

/** Colour cuts are instantaneous; only physical/layout motion is eased. */
export const INSTANT_CUT =
  'background-color 0ms, color 0ms, border-color 0ms, box-shadow 0ms'

/**
 * Physical press: hover lifts by 1px and grows the hard shadow by 1px;
 * press travels 3px and collapses the shadow toward 1px. The colour cut stays
 * instantaneous so the ink never appears to "fade in" under the cursor.
 */
export const pressSx = (
  shadowPx = 4,
  color: string = VERMILION
): CSSObject => ({
  transition: `${INSTANT_CUT}, transform ${MOTION_PRESS}, box-shadow ${MOTION_PRESS}`,
  '&:hover': {
    transform: 'translate(-1px, -1px)',
    boxShadow: hardShadow(shadowPx + 1, color),
  },
  '&:active': {
    transform: `translate(${Math.max(1, Math.round(shadowPx * 0.75))}px, ${Math.max(1, Math.round(shadowPx * 0.75))}px)`,
    boxShadow: hardShadow(
      Math.max(1, shadowPx - Math.max(1, Math.round(shadowPx * 0.75))),
      color
    ),
  },
  '@media (prefers-reduced-motion: reduce)': {
    transition: 'none',
    '&:hover': { transform: 'none' },
    '&:active': { transform: 'none' },
  },
})

/** Mono stack for ALL numbers, statuses and english micro-labels. */
export const MONO = '"JetBrains Mono", ui-monospace, monospace'
/** Decorative kana serif (「再生中」 etc.). */
export const SERIF_JP = '"Zen Antique", serif'
/** Body / heading stack. */
export const SANS =
  '"Noto Sans SC", "Microsoft YaHei", "PingFang SC", system-ui, sans-serif'

/**
 * Halftone dot ground — the signature paper-grain texture. `alphaVal` tunes
 * dot brightness, `size` the grid pitch.
 */
export const halftoneSx = (alphaVal = 0.07, size = 14): CSSObject => ({
  backgroundColor: INK,
  backgroundImage: `radial-gradient(${alpha(PAPER, alphaVal)} 1px, transparent 1px)`,
  backgroundSize: `${size}px ${size}px`,
})

/** Diagonal hatch used as placeholder art (thumbnails, video stand-ins). */
export const hatchSx = (a = '#1b1b22', b = '#141419', w = 12): CSSObject => ({
  background: `repeating-linear-gradient(48deg, ${a} 0 ${w}px, ${b} ${w}px ${w * 2}px)`,
})

/** Mono micro-label: 9–10px, wide tracking, dimmed. */
export const microLabelSx = (color = alpha(PAPER, 0.4)): CSSObject => ({
  fontFamily: MONO,
  fontSize: 9,
  letterSpacing: '0.22em',
  color,
  fontWeight: 700,
})

/** Overlay bar gradient — the ONLY translucent surface left in the app. */
export const OVERLAY_GRADIENT =
  'linear-gradient(to top, rgba(10,10,12,0.97) 0%, rgba(10,10,12,0.9) 62%, transparent 100%)'

export const theme = createTheme({
  palette: {
    mode: 'dark',
    primary: {
      main: VERMILION,
      light: '#ff6478',
      dark: '#d91635',
      contrastText: PAPER,
    },
    secondary: {
      main: PAPER,
      light: '#ffffff',
      dark: '#d6d2c4',
      contrastText: INK,
    },
    background: {
      default: INK,
      paper: INK,
    },
    text: {
      primary: alpha(PAPER, 0.92),
      secondary: alpha(PAPER, 0.6),
      disabled: alpha(PAPER, 0.35),
    },
    divider: alpha(PAPER, 0.14),
    success: { main: GREEN },
    warning: { main: GOLD },
    error: { main: VERMILION },
    info: { main: PAPER },
  },
  shape: {
    // 漫画风靠直角。No rounding anywhere.
    borderRadius: 0,
  },
  typography: {
    fontFamily: SANS,
    button: { textTransform: 'none', fontWeight: 700 },
    caption: { letterSpacing: '0.01em' },
  },
  components: {
    MuiButton: {
      defaultProps: { disableElevation: true, disableRipple: true },
      styleOverrides: {
        root: {
          borderRadius: 0,
          fontWeight: 700,
          transition: `${INSTANT_CUT}, transform ${MOTION_PRESS}, box-shadow ${MOTION_PRESS}`,
        },
        outlined: {
          border: LINE_WEAK,
          color: alpha(PAPER, 0.8),
          '&:hover': {
            borderColor: PAPER,
            backgroundColor: PAPER,
            color: INK,
          },
        },
        contained: {
          ...pressSx(4),
          border: LINE_STRONG,
          backgroundColor: PAPER,
          color: INK,
          boxShadow: HARD_SHADOW,
          '&:hover': {
            backgroundColor: VERMILION,
            color: PAPER,
            transform: 'translate(-1px, -1px)',
            boxShadow: hardShadow(5),
          },
          '&:active': {
            transform: 'translate(3px, 3px)',
            boxShadow: hardShadow(1),
          },
          '@media (prefers-reduced-motion: reduce)': {
            transition: 'none',
            '&:hover': { transform: 'none' },
            '&:active': { transform: 'none' },
          },
        },
      },
    },
    MuiIconButton: {
      defaultProps: { disableRipple: true },
      styleOverrides: {
        root: {
          borderRadius: 0,
          color: alpha(PAPER, 0.88),
          transition: INSTANT_CUT,
          '&:hover': {
            backgroundColor: PAPER,
            color: INK,
          },
        },
      },
    },
    MuiTooltip: {
      styleOverrides: {
        tooltip: {
          backgroundColor: INK,
          border: LINE_STRONG,
          borderRadius: 0,
          color: PAPER,
          fontSize: 12,
          fontWeight: 700,
          padding: '4px 8px',
        },
      },
    },
    MuiSlider: {
      styleOverrides: {
        root: { color: PAPER, borderRadius: 0 },
        thumb: {
          width: 8,
          height: 22,
          borderRadius: 0,
          backgroundColor: VERMILION,
          border: LINE_STRONG,
          boxShadow: 'none',
          '&:hover, &.Mui-focusVisible, &.Mui-active': {
            boxShadow: 'none',
          },
        },
        track: {
          border: 'none',
          borderRadius: 0,
          backgroundColor: PAPER,
        },
        rail: {
          opacity: 1,
          borderRadius: 0,
          backgroundColor: alpha(PAPER, 0.16),
        },
        valueLabel: {
          backgroundColor: INK,
          border: LINE_STRONG,
          borderRadius: 0,
          fontFamily: MONO,
          fontWeight: 700,
        },
      },
    },
    // Modal root inherits cursor from the stage (which hides it during
    // playback). Without this, the cursor disappears inside every overlay.
    MuiModal: {
      styleOverrides: {
        root: { cursor: 'default' },
      },
    },
    MuiDrawer: {
      styleOverrides: {
        paper: {
          backgroundColor: INK,
          backgroundImage: 'none',
          borderLeft: LINE_FRAME,
        },
      },
    },
    MuiDialog: {
      styleOverrides: {
        paper: {
          backgroundColor: INK,
          backgroundImage: 'none',
          border: LINE_FRAME,
          borderRadius: 0,
          boxShadow: `12px 12px 0 ${alpha(VERMILION, 0.9)}`,
        },
      },
    },
    MuiMenu: {
      styleOverrides: {
        paper: {
          backgroundColor: INK,
          backgroundImage: 'none',
          border: LINE_STRONG,
          borderRadius: 0,
          boxShadow: HARD_SHADOW,
        },
      },
    },
    MuiMenuItem: {
      defaultProps: { disableRipple: true },
      styleOverrides: {
        root: {
          fontWeight: 700,
          '&:hover': { backgroundColor: PAPER, color: INK },
          '&.Mui-selected': {
            backgroundColor: VERMILION,
            color: PAPER,
            '&:hover': { backgroundColor: VERMILION, color: PAPER },
          },
        },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: { fontWeight: 700, borderRadius: 0 },
      },
    },
    MuiDivider: {
      styleOverrides: {
        root: { borderColor: alpha(PAPER, 0.2) },
      },
    },
    MuiAlert: {
      styleOverrides: {
        root: { borderRadius: 0 },
        outlined: { border: LINE_SUBTLE },
      },
    },
    MuiTextField: {
      defaultProps: { autoComplete: 'off' },
    },
    MuiOutlinedInput: {
      styleOverrides: {
        root: {
          borderRadius: 0,
          '& .MuiOutlinedInput-notchedOutline': {
            border: LINE_WEAK,
          },
          '&:hover .MuiOutlinedInput-notchedOutline': {
            border: LINE_STRONG,
          },
          '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
            border: `2px solid ${VERMILION}`,
          },
        },
      },
    },
  },
})

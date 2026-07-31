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

export const LINE_STRONG = `2px solid ${PAPER}`
export const LINE_WEAK = `2px solid ${alpha(PAPER, 0.3)}`

/** Hard comic shadow for key controls; panels go 8–14px. */
export const HARD_SHADOW = `4px 4px 0 ${VERMILION}`
export const hardShadow = (px: number, color: string = VERMILION): string =>
  `${px}px ${px}px 0 ${color}`

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
          transition: 'background-color 100ms steps(1), color 100ms steps(1)',
        },
        outlined: {
          border: LINE_WEAK,
          color: alpha(PAPER, 0.8),
          '&:hover': {
            border: LINE_STRONG,
            backgroundColor: PAPER,
            color: INK,
          },
        },
        contained: {
          border: LINE_STRONG,
          backgroundColor: PAPER,
          color: INK,
          boxShadow: HARD_SHADOW,
          '&:hover': {
            backgroundColor: VERMILION,
            color: PAPER,
            boxShadow: HARD_SHADOW,
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
          transition: 'background-color 100ms steps(1), color 100ms steps(1)',
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
    MuiDrawer: {
      styleOverrides: {
        paper: {
          backgroundColor: INK,
          backgroundImage: 'none',
          borderLeft: `3px solid ${PAPER}`,
        },
      },
    },
    MuiDialog: {
      styleOverrides: {
        paper: {
          backgroundColor: INK,
          backgroundImage: 'none',
          border: `3px solid ${PAPER}`,
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
        outlined: { border: LINE_WEAK },
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

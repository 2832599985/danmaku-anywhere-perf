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
/** Hover/active edges that never move layout (see `inkHold`). */
export const LINE_DASHED = `2px dashed ${alpha(PAPER, 0.28)}`
export const LINE_RULE_DASHED = `1px dashed ${alpha(PAPER, 0.18)}`

/**
 * Translucent ink grounds. LIGHT floats over the picture (status, banner,
 * skip button); HEAVY is for readouts and blocking states (HUD, dialogs).
 */
export const INK_SCRIM_LIGHT = alpha(INK, 0.78)
export const INK_SCRIM_HEAVY = alpha(INK, 0.88)

/**
 * Stage stacking order — the single source for every overlay z-index.
 * Only MUI modals (1300) sit above MEDIA_ERROR.
 */
export const STAGE_Z = {
  VIDEO: 0,
  UPSCALE: 1,
  DANMAKU: 2,
  SUBTITLE: 3,
  COMPARE: 4,
  IDLE: 5,
  HUD: 15,
  CHROME: 30,
  TOP_BAR: 40,
  AI_OVERLAY: 42,
  OSD: 45,
  MEDIA_ERROR: 50,
} as const

/** Keyboard focus ring shared by every hand-written control. */
export const INK_FOCUS_SX: CSSObject = {
  '&:focus-visible': {
    outline: `2px solid ${VERMILION}`,
    outlineOffset: '2px',
  },
}

/**
 * Constant-footprint edge: a transparent frame plus a 1px inset hairline.
 * Hover/active only swap colours, so the control (and its grid neighbours)
 * never reflow when the stroke thickens.
 */
export const inkHold = (px: 2 | 3 = 2): CSSObject => ({
  border: `${px}px solid transparent`,
  boxShadow: `inset 0 0 0 1px ${alpha(PAPER, 0.22)}`,
})
/** Turn an `inkHold` edge into its hover/active stroke. */
export const inkHoldOn = (color: string = PAPER): CSSObject => ({
  borderColor: color,
  boxShadow: 'none',
})

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
      transition: 'opacity 120ms linear !important',
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
export const INSTANT_CUT = 'background-color 0ms, color 0ms, border-color 0ms'

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
  transitions: {
    easing: {
      easeInOut: 'cubic-bezier(0.4, 0, 0.2, 1)',
      easeOut: CRISP_EASE,
      easeIn: 'cubic-bezier(0.4, 0, 1, 1)',
      sharp: CRISP_EASE,
    },
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
          border: LINE_SUBTLE,
          color: alpha(PAPER, 0.8),
          '&:hover': {
            borderColor: PAPER,
            backgroundColor: PAPER,
            color: INK,
          },
        },
        contained: {
          ...inkStampPressSx(4, VERMILION, {
            backgroundColor: VERMILION,
            color: PAPER,
            borderColor: VERMILION,
          }),
          border: LINE_STRONG,
          backgroundColor: PAPER,
          color: INK,
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
    // Modal root inherits cursor from the stage (which hides it during
    // playback). Without this, the cursor disappears inside every overlay.
    MuiModal: {
      styleOverrides: {
        root: { cursor: 'default' },
      },
    },
    MuiDrawer: {
      defaultProps: { transitionDuration: { enter: 180, exit: 140 } },
      styleOverrides: {
        paper: {
          backgroundColor: INK,
          backgroundImage: 'none',
          borderLeft: LINE_FRAME,
        },
      },
    },
    MuiDialog: {
      defaultProps: { transitionDuration: { enter: 180, exit: 140 } },
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
      defaultProps: { transitionDuration: { enter: 140, exit: 110 } },
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
        filledError: {
          backgroundColor: INK,
          color: PAPER,
          border: `3px solid ${VERMILION}`,
          boxShadow: hardShadow(6),
          '& .MuiAlert-icon': { color: VERMILION },
        },
        filledWarning: {
          backgroundColor: INK,
          color: PAPER,
          border: `3px solid ${GOLD}`,
          boxShadow: hardShadow(6, GOLD),
          '& .MuiAlert-icon': { color: GOLD },
        },
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
            border: LINE_SUBTLE,
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

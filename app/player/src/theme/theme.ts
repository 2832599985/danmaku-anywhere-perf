import type { CSSObject, SxProps, Theme } from '@mui/material/styles'
import { alpha, createTheme } from '@mui/material/styles'

/**
 * Dark, glassy theme for the danmaku player. Violet -> fuchsia accent, cohesive
 * with the sibling extension's「neon-violet」palette. Dark mode only.
 */

export const ACCENT = {
  primary: '#a78bfa',
  primaryStrong: '#8b5cf6',
  primaryLight: '#c4b5fd',
  secondary: '#e879f9',
  secondaryStrong: '#d946ef',
  secondaryLight: '#f0abfc',
} as const

/** App background — near-black with a faint violet cast. */
export const APP_BG = '#0b0b12'

/** Violet -> fuchsia gradient used for accents, titles and prominent buttons. */
export const ACCENT_GRADIENT = `linear-gradient(135deg, ${ACCENT.primary} 0%, ${ACCENT.secondary} 100%)`

/**
 * Deep multi-stop violet with a near-white specular stop — the "expensive"
 * purple. A flat two-stop pastel reads like plastic; this one has shadow depth
 * at both ends and a metallic highlight in the middle. Pair with a blurred
 * bloom layer for neon depth on dark stages.
 */
export const RICH_GRADIENT =
  'linear-gradient(105deg, #6d28d9 0%, #8b5cf6 20%, #c4b5fd 38%, #f3e8ff 50%, #e879f9 62%, #a855f7 80%, #7c3aed 100%)'

/** Deep saturated fill for hero buttons (dark → bright → fuchsia). */
export const RICH_BUTTON_GRADIENT =
  'linear-gradient(135deg, #7c3aed 0%, #a855f7 48%, #d946ef 100%)'

/** rgb triple for the translucent glass fills so alpha can vary per surface. */
const GLASS_RGB = '20, 20, 32'

/** Radius scale, mirrored from the extension's design tokens. */
export const RADIUS = { s: 10, m: 16, l: 22, pill: 999 } as const

/**
 * Translucent dark surface with backdrop blur — the signature "glass" look.
 * `strength` tunes the fill opacity (bars 0.55, panels/dialogs 0.72).
 */
export const glassSx = (strength = 0.6): CSSObject => ({
  backgroundColor: `rgba(${GLASS_RGB}, ${strength})`,
  backdropFilter: 'blur(12px) saturate(160%)',
  WebkitBackdropFilter: 'blur(12px) saturate(160%)',
  border: '1px solid rgba(255, 255, 255, 0.08)',
})

/** Clip the accent gradient to text. Apply to a Typography/Box. */
export const gradientTextSx: CSSObject = {
  backgroundImage: ACCENT_GRADIENT,
  backgroundClip: 'text',
  WebkitBackgroundClip: 'text',
  color: 'transparent',
  WebkitTextFillColor: 'transparent',
}

/**
 * Shared sx for the ToggleButtonGroup grids in the settings panels. Typed as
 * SxProps (not CSSObject) because it uses spacing shorthands (`py`, `gap`) that
 * are only valid in the theme-aware `sx` context.
 */
export const toggleGridSx = (columns: number): SxProps<Theme> => ({
  display: 'grid',
  gridTemplateColumns: `repeat(${columns}, 1fr)`,
  gap: 0.5,
  '& .MuiToggleButton-root': {
    border: '1px solid rgba(255,255,255,0.10)',
    borderRadius: `${RADIUS.s}px !important`,
    color: 'rgba(255,255,255,0.72)',
    fontSize: 12.5,
    fontWeight: 600,
    py: 0.5,
    lineHeight: 1.2,
    textTransform: 'none',
  },
})

export const theme = createTheme({
  palette: {
    mode: 'dark',
    primary: {
      main: ACCENT.primary,
      light: ACCENT.primaryLight,
      dark: ACCENT.primaryStrong,
      contrastText: '#0b0b12',
    },
    secondary: {
      main: ACCENT.secondary,
      light: ACCENT.secondaryLight,
      dark: ACCENT.secondaryStrong,
      contrastText: '#0b0b12',
    },
    background: {
      default: APP_BG,
      paper: '#14141f',
    },
    text: {
      primary: 'rgba(255, 255, 255, 0.92)',
      secondary: 'rgba(255, 255, 255, 0.60)',
      disabled: 'rgba(255, 255, 255, 0.35)',
    },
    divider: 'rgba(255, 255, 255, 0.08)',
    success: { main: '#34d399' },
    warning: { main: '#fbbf24' },
    error: { main: '#fb7185' },
    info: { main: '#818cf8' },
  },
  shape: {
    borderRadius: RADIUS.m,
  },
  typography: {
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, "Microsoft YaHei", "PingFang SC", "Hiragino Sans GB", "Noto Sans CJK SC", sans-serif',
    button: { textTransform: 'none', fontWeight: 600 },
    caption: { letterSpacing: '0.01em' },
  },
  components: {
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: {
        root: {
          borderRadius: RADIUS.pill,
          fontWeight: 600,
        },
      },
    },
    MuiIconButton: {
      styleOverrides: {
        root: {
          color: 'rgba(255, 255, 255, 0.88)',
          transition: 'background-color 120ms ease, color 120ms ease',
          '&:hover': {
            backgroundColor: 'rgba(255, 255, 255, 0.10)',
          },
        },
      },
    },
    MuiTooltip: {
      styleOverrides: {
        tooltip: {
          ...glassSx(0.82),
          borderRadius: RADIUS.s,
          fontSize: 12,
          fontWeight: 600,
          padding: '4px 8px',
        },
      },
    },
    MuiToggleButton: {
      styleOverrides: {
        root: {
          '&.Mui-selected': {
            color: '#fff',
            backgroundColor: alpha(ACCENT.primaryStrong, 0.32),
            borderColor: alpha(ACCENT.primary, 0.55),
            '&:hover': {
              backgroundColor: alpha(ACCENT.primaryStrong, 0.42),
            },
          },
        },
      },
    },
    MuiSlider: {
      styleOverrides: {
        root: { color: ACCENT.primary },
        thumb: {
          width: 14,
          height: 14,
          boxShadow: `0 0 0 4px ${alpha(ACCENT.primary, 0.16)}`,
          '&:hover, &.Mui-focusVisible': {
            boxShadow: `0 0 0 6px ${alpha(ACCENT.primary, 0.22)}`,
          },
        },
        track: {
          border: 'none',
          backgroundImage: ACCENT_GRADIENT,
        },
        rail: {
          opacity: 1,
          backgroundColor: 'rgba(255, 255, 255, 0.16)',
        },
        valueLabel: {
          ...glassSx(0.85),
          borderRadius: RADIUS.s,
          fontWeight: 600,
        },
      },
    },
    MuiDrawer: {
      styleOverrides: {
        paper: {
          ...glassSx(0.78),
          backgroundImage: 'none',
        },
      },
    },
    MuiDialog: {
      styleOverrides: {
        paper: {
          ...glassSx(0.82),
          backgroundImage: 'none',
          borderRadius: RADIUS.l,
        },
      },
    },
    MuiMenu: {
      styleOverrides: {
        paper: {
          ...glassSx(0.82),
          backgroundImage: 'none',
          borderRadius: RADIUS.m,
        },
      },
    },
    MuiTabs: {
      styleOverrides: {
        indicator: {
          height: 3,
          borderRadius: 3,
          backgroundImage: ACCENT_GRADIENT,
        },
      },
    },
    MuiTab: {
      styleOverrides: {
        root: {
          textTransform: 'none',
          fontWeight: 600,
          minHeight: 44,
        },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: { fontWeight: 600 },
      },
    },
    MuiAccordion: {
      styleOverrides: {
        root: {
          backgroundImage: 'none',
          backgroundColor: 'transparent',
          '&:before': { display: 'none' },
        },
      },
    },
  },
})

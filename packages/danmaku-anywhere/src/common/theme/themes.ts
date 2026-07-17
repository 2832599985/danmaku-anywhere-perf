import { ColorMode } from '@/common/theme/enums'

export type ThemeColorScheme = 'dark' | 'light'

/** Parse an "r, g, b" token into a numeric triple. */
const parseRgb = (rgb: string): [number, number, number] => {
  const [r, g, b] = rgb.split(',').map((n) => Number.parseFloat(n.trim()))
  return [r, g, b]
}

const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)))

/** Lighten each channel toward white by `amount` (0-1). Returns "r, g, b". */
const lighten = (rgb: string, amount: number): string => {
  const [r, g, b] = parseRgb(rgb)
  return `${clamp(r + (255 - r) * amount)}, ${clamp(g + (255 - g) * amount)}, ${clamp(b + (255 - b) * amount)}`
}

/** Darken each channel toward black by `amount` (0-1). Returns "r, g, b". */
const darken = (rgb: string, amount: number): string => {
  const [r, g, b] = parseRgb(rgb)
  return `${clamp(r * (1 - amount))}, ${clamp(g * (1 - amount))}, ${clamp(b * (1 - amount))}`
}

/** Blend `from` toward `to` by `amount` (0-1). Returns "r, g, b". */
const mixToward = (from: string, to: string, amount: number): string => {
  const [r1, g1, b1] = parseRgb(from)
  const [r2, g2, b2] = parseRgb(to)
  return `${clamp(r1 + (r2 - r1) * amount)}, ${clamp(g1 + (g2 - g1) * amount)}, ${clamp(b1 + (b2 - b1) * amount)}`
}

export interface GlassPalette {
  /** Transparent fill for chrome elements (buttons, pills, FAB) */
  base: string
  /** Chrome hover fill */
  hover: string
  /** Heavier fill for text-dense surfaces (panel, menus, dialogs) */
  scrim: string
  /** Near-opaque fill for surfaces that must stay readable over bright video
   * (dialogs, confirmations, tooltips) */
  overlay: string
  /** blur + saturate backdrop filter value */
  blur: string
  /** Flat 1px border fallback (focus rings, resize state) */
  border: string
  /** Top-lit gradient for the 1px rim (::before mask technique) */
  borderGradient: string
  /** Inset specular highlight stack (box-shadow list, inset-only) */
  specular: string
  /** Outer drop shadow stack for depth (box-shadow list) */
  depth: string
  /** Single primary-tinted bloom (one box-shadow item) — content glow for the
   * mounted FAB, highlight peaks, active states */
  glow: string
  /** Theme-colored gradient overlay, layered over base/scrim via multi-bg */
  tint: string
  /** Opaque fallback fill for reduced-transparency / low-power (T3). Keeps a
   * theme lean; identity then rides on the rim + specular, not the blur. */
  solid: string
}

export interface ThemePalette {
  id: string
  name: string
  primary: string
  secondary: string
  darkBg: string
  glass: GlassPalette
  gradient: string
  /** T2「画光」canvas background for opaque windows (popup/dashboard): a
   * multi-layer wash that reads as "the projector's light on the console". */
  canvas: {
    backdrop: string
  }
  /** Semantic status colors, warmed slightly toward each theme so success/error
   * never read as stock Material green/red on a tinted surface. */
  status: {
    success: string
    warning: string
    error: string
    info: string
  }
  density: {
    played: string
    unplayed: string
  }
  regions: {
    op: { fill: string; border: string }
    ed: { fill: string; border: string }
  }
  skipButton: {
    text: string
    closeText: string
  }
}

const createDarkGlass = (
  surfaceRgb: string,
  primaryRgb: string,
  secondaryRgb: string,
  highlightRgb = '255, 255, 255'
): GlassPalette => ({
  base: `rgba(${surfaceRgb}, 0.28)`,
  hover: `rgba(${surfaceRgb}, 0.42)`,
  scrim: `rgba(${surfaceRgb}, 0.54)`,
  overlay: `rgba(${surfaceRgb}, 0.82)`,
  blur: 'blur(28px) saturate(190%)',
  border: `rgba(${highlightRgb}, 0.22)`,
  borderGradient: `linear-gradient(155deg, rgba(${highlightRgb}, 0.72) 0%, rgba(${highlightRgb}, 0.16) 34%, rgba(${primaryRgb}, 0.34) 68%, rgba(${secondaryRgb}, 0.18) 100%)`,
  specular: `inset 0 1px 0 rgba(${highlightRgb}, 0.42), inset 1px 0 0 rgba(${highlightRgb}, 0.12), inset 0 -1px 0 rgba(${highlightRgb}, 0.07), inset 0 0 32px rgba(${primaryRgb}, 0.12)`,
  depth: `0 14px 44px rgba(0, 0, 0, 0.38), 0 3px 12px rgba(0, 0, 0, 0.24), 0 0 28px rgba(${primaryRgb}, 0.10)`,
  glow: `0 0 34px rgba(${primaryRgb}, 0.45)`,
  tint: `radial-gradient(circle at 18% 0%, rgba(${highlightRgb}, 0.24), transparent 34%), linear-gradient(135deg, rgba(${primaryRgb}, 0.18), rgba(${secondaryRgb}, 0.08) 58%, rgba(${highlightRgb}, 0.02))`,
  solid: `rgb(${mixToward(surfaceRgb, primaryRgb, 0.1)})`,
})

const createLightGlass = (
  primaryRgb: string,
  secondaryRgb: string
): GlassPalette => ({
  base: 'rgba(255, 255, 255, 0.32)',
  hover: 'rgba(255, 255, 255, 0.48)',
  scrim: 'rgba(248, 250, 252, 0.64)',
  overlay: 'rgba(248, 250, 252, 0.90)',
  blur: 'blur(30px) saturate(185%) brightness(1.06)',
  border: 'rgba(255, 255, 255, 0.72)',
  borderGradient: `linear-gradient(155deg, rgba(255, 255, 255, 0.98) 0%, rgba(255, 255, 255, 0.54) 34%, rgba(${primaryRgb}, 0.30) 70%, rgba(${secondaryRgb}, 0.20) 100%)`,
  specular: `inset 0 1px 0 rgba(255, 255, 255, 0.92), inset 1px 0 0 rgba(255, 255, 255, 0.48), inset 0 -1px 0 rgba(15, 23, 42, 0.08), inset 0 0 30px rgba(${primaryRgb}, 0.08)`,
  depth: `0 14px 42px rgba(15, 23, 42, 0.18), 0 3px 12px rgba(15, 23, 42, 0.10), 0 0 26px rgba(${primaryRgb}, 0.10)`,
  glow: `0 0 30px rgba(${primaryRgb}, 0.34)`,
  tint: `radial-gradient(circle at 18% 0%, rgba(255, 255, 255, 0.76), transparent 36%), linear-gradient(135deg, rgba(${primaryRgb}, 0.14), rgba(${secondaryRgb}, 0.07) 58%, rgba(255, 255, 255, 0.12))`,
  solid: `rgb(${mixToward('244, 246, 251', primaryRgb, 0.05)})`,
})

/**
 * The T2「画光」canvas: two theme-colored light pools (primary from top-left,
 * secondary from bottom-right) over a deepened vertical wash of the theme's
 * dark background. A glass card blurring THIS reads as glass, even though the
 * popup window itself can't be transparent.
 */
const createDarkCanvas = (
  bgRgb: string,
  primaryRgb: string,
  secondaryRgb: string
): string =>
  `radial-gradient(120% 90% at 18% -10%, rgba(${primaryRgb}, 0.26), transparent 55%), ` +
  `radial-gradient(90% 70% at 100% 110%, rgba(${secondaryRgb}, 0.16), transparent 60%), ` +
  `linear-gradient(180deg, rgb(${lighten(bgRgb, 0.06)}) 0%, rgb(${bgRgb}) 58%, rgb(${darken(bgRgb, 0.02)}) 100%)`

const createLightCanvas = (primaryRgb: string, secondaryRgb: string): string =>
  `radial-gradient(120% 90% at 16% -12%, rgba(${primaryRgb}, 0.16), transparent 52%), ` +
  `radial-gradient(90% 70% at 102% 108%, rgba(${secondaryRgb}, 0.12), transparent 58%), ` +
  'linear-gradient(180deg, #f7f9ff 0%, #eef1f9 60%, #e7ebf6 100%)'

const neonViolet: ThemePalette = {
  id: 'neon-violet',
  name: 'theme.neonViolet',
  primary: '#8b5cf6',
  secondary: '#d946ef',
  darkBg: '#0f172a',
  glass: createDarkGlass('15, 23, 42', '139, 92, 246', '217, 70, 239'),
  gradient: 'linear-gradient(135deg, #8b5cf6, #d946ef)',
  canvas: {
    backdrop: createDarkCanvas('15, 23, 42', '139, 92, 246', '217, 70, 239'),
  },
  status: {
    success: '#34d399',
    warning: '#fbbf24',
    error: '#fb7185',
    info: '#818cf8',
  },
  density: {
    played: 'rgba(255,255,255,0.6)',
    unplayed: 'rgba(255,255,255,0.25)',
  },
  regions: {
    op: { fill: 'rgba(96, 165, 250, 0.35)', border: 'rgba(96, 165, 250, 0.7)' },
    ed: {
      fill: 'rgba(251, 113, 133, 0.35)',
      border: 'rgba(251, 113, 133, 0.7)',
    },
  },
  skipButton: {
    text: '#ffffff',
    closeText: '#c7c7c7',
  },
}

const emberGlow: ThemePalette = {
  id: 'ember-glow',
  name: 'theme.emberGlow',
  primary: '#f59e0b',
  secondary: '#ef4444',
  darkBg: '#1a0f08',
  glass: createDarkGlass(
    '26, 15, 8',
    '245, 158, 11',
    '239, 68, 68',
    '255, 236, 200'
  ),
  gradient: 'linear-gradient(135deg, #f59e0b, #ef4444)',
  canvas: {
    backdrop: createDarkCanvas('26, 15, 8', '245, 158, 11', '239, 68, 68'),
  },
  status: {
    success: '#4ade80',
    warning: '#fbbf24',
    error: '#f87171',
    info: '#fb923c',
  },
  density: {
    played: 'rgba(251, 191, 36, 0.5)',
    unplayed: 'rgba(251, 191, 36, 0.2)',
  },
  regions: {
    op: { fill: 'rgba(251, 191, 36, 0.35)', border: 'rgba(251, 191, 36, 0.7)' },
    ed: { fill: 'rgba(147, 51, 234, 0.35)', border: 'rgba(147, 51, 234, 0.7)' },
  },
  skipButton: {
    text: '#ffffff',
    closeText: '#c7c7c7',
  },
}

const oceanDepth: ThemePalette = {
  id: 'ocean-depth',
  name: 'theme.oceanDepth',
  primary: '#0ea5e9',
  secondary: '#06b6d4',
  darkBg: '#0a1628',
  glass: createDarkGlass(
    '10, 22, 40',
    '14, 165, 233',
    '6, 182, 212',
    '224, 242, 254'
  ),
  gradient: 'linear-gradient(135deg, #0ea5e9, #06b6d4)',
  canvas: {
    backdrop: createDarkCanvas('10, 22, 40', '14, 165, 233', '6, 182, 212'),
  },
  status: {
    success: '#2dd4bf',
    warning: '#fbbf24',
    error: '#f87171',
    info: '#38bdf8',
  },
  density: {
    played: 'rgba(56, 189, 248, 0.5)',
    unplayed: 'rgba(56, 189, 248, 0.2)',
  },
  regions: {
    op: { fill: 'rgba(56, 189, 248, 0.35)', border: 'rgba(56, 189, 248, 0.7)' },
    ed: {
      fill: 'rgba(244, 114, 182, 0.35)',
      border: 'rgba(244, 114, 182, 0.7)',
    },
  },
  skipButton: {
    text: '#ffffff',
    closeText: '#c7c7c7',
  },
}

const sakuraNoir: ThemePalette = {
  id: 'sakura-noir',
  name: 'theme.sakuraNoir',
  primary: '#ec4899',
  secondary: '#a855f7',
  darkBg: '#150a18',
  glass: createDarkGlass(
    '21, 10, 24',
    '236, 72, 153',
    '168, 85, 247',
    '253, 242, 248'
  ),
  gradient: 'linear-gradient(135deg, #ec4899, #a855f7)',
  canvas: {
    backdrop: createDarkCanvas('21, 10, 24', '236, 72, 153', '168, 85, 247'),
  },
  status: {
    success: '#34d399',
    warning: '#fbbf24',
    error: '#fb7185',
    info: '#c084fc',
  },
  density: {
    played: 'rgba(236, 72, 153, 0.5)',
    unplayed: 'rgba(236, 72, 153, 0.2)',
  },
  regions: {
    op: { fill: 'rgba(236, 72, 153, 0.35)', border: 'rgba(236, 72, 153, 0.7)' },
    ed: { fill: 'rgba(96, 165, 250, 0.35)', border: 'rgba(96, 165, 250, 0.7)' },
  },
  skipButton: {
    text: '#ffffff',
    closeText: '#c7c7c7',
  },
}

export const themes: Record<string, ThemePalette> = {
  'neon-violet': neonViolet,
  'ember-glow': emberGlow,
  'ocean-depth': oceanDepth,
  'sakura-noir': sakuraNoir,
}

const lightGlassPalettes: Record<string, GlassPalette> = {
  'neon-violet': createLightGlass('139, 92, 246', '217, 70, 239'),
  'ember-glow': createLightGlass('245, 158, 11', '239, 68, 68'),
  'ocean-depth': createLightGlass('14, 165, 233', '6, 182, 212'),
  'sakura-noir': createLightGlass('236, 72, 153', '168, 85, 247'),
}

const lightCanvases: Record<string, string> = {
  'neon-violet': createLightCanvas('139, 92, 246', '217, 70, 239'),
  'ember-glow': createLightCanvas('245, 158, 11', '239, 68, 68'),
  'ocean-depth': createLightCanvas('14, 165, 233', '6, 182, 212'),
  'sakura-noir': createLightCanvas('236, 72, 153', '168, 85, 247'),
}

export const themeIds = Object.keys(themes)

export const DEFAULT_THEME_ID = 'neon-violet'

export const resolveColorScheme = (
  colorMode: ColorMode,
  prefersDark: boolean
): ThemeColorScheme => {
  if (colorMode === ColorMode.System) return prefersDark ? 'dark' : 'light'
  return colorMode
}

export const getThemePalette = (
  id: string,
  colorScheme: ThemeColorScheme = 'dark'
): ThemePalette => {
  const palette = themes[id] ?? themes[DEFAULT_THEME_ID]
  if (colorScheme === 'dark') return palette

  return {
    ...palette,
    glass: lightGlassPalettes[palette.id],
    canvas: {
      backdrop: lightCanvases[palette.id],
    },
    skipButton: {
      text: 'rgba(15, 23, 42, 0.94)',
      closeText: 'rgba(15, 23, 42, 0.66)',
    },
  }
}

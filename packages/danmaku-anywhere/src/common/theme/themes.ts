import { ColorMode } from '@/common/theme/enums'

export type ThemeColorScheme = 'dark' | 'light'

export interface GlassPalette {
  /** Transparent fill for chrome elements (buttons, pills, FAB) */
  base: string
  /** Chrome hover fill */
  hover: string
  /** Heavier fill for text-dense surfaces (panel, menus, dialogs) */
  scrim: string
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
  /** Theme-colored gradient overlay, layered over base/scrim via multi-bg */
  tint: string
}

export interface ThemePalette {
  id: string
  name: string
  primary: string
  secondary: string
  darkBg: string
  glass: GlassPalette
  gradient: string
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
  blur: 'blur(28px) saturate(190%)',
  border: `rgba(${highlightRgb}, 0.22)`,
  borderGradient: `linear-gradient(155deg, rgba(${highlightRgb}, 0.72) 0%, rgba(${highlightRgb}, 0.16) 34%, rgba(${primaryRgb}, 0.34) 68%, rgba(${secondaryRgb}, 0.18) 100%)`,
  specular: `inset 0 1px 0 rgba(${highlightRgb}, 0.42), inset 1px 0 0 rgba(${highlightRgb}, 0.12), inset 0 -1px 0 rgba(${highlightRgb}, 0.07), inset 0 0 32px rgba(${primaryRgb}, 0.12)`,
  depth: `0 14px 44px rgba(0, 0, 0, 0.38), 0 3px 12px rgba(0, 0, 0, 0.24), 0 0 28px rgba(${primaryRgb}, 0.10)`,
  tint: `radial-gradient(circle at 18% 0%, rgba(${highlightRgb}, 0.24), transparent 34%), linear-gradient(135deg, rgba(${primaryRgb}, 0.18), rgba(${secondaryRgb}, 0.08) 58%, rgba(${highlightRgb}, 0.02))`,
})

const createLightGlass = (
  primaryRgb: string,
  secondaryRgb: string
): GlassPalette => ({
  base: 'rgba(255, 255, 255, 0.32)',
  hover: 'rgba(255, 255, 255, 0.48)',
  scrim: 'rgba(248, 250, 252, 0.64)',
  blur: 'blur(30px) saturate(185%) brightness(1.06)',
  border: 'rgba(255, 255, 255, 0.72)',
  borderGradient: `linear-gradient(155deg, rgba(255, 255, 255, 0.98) 0%, rgba(255, 255, 255, 0.54) 34%, rgba(${primaryRgb}, 0.30) 70%, rgba(${secondaryRgb}, 0.20) 100%)`,
  specular: `inset 0 1px 0 rgba(255, 255, 255, 0.92), inset 1px 0 0 rgba(255, 255, 255, 0.48), inset 0 -1px 0 rgba(15, 23, 42, 0.08), inset 0 0 30px rgba(${primaryRgb}, 0.08)`,
  depth: `0 14px 42px rgba(15, 23, 42, 0.18), 0 3px 12px rgba(15, 23, 42, 0.10), 0 0 26px rgba(${primaryRgb}, 0.10)`,
  tint: `radial-gradient(circle at 18% 0%, rgba(255, 255, 255, 0.76), transparent 36%), linear-gradient(135deg, rgba(${primaryRgb}, 0.14), rgba(${secondaryRgb}, 0.07) 58%, rgba(255, 255, 255, 0.12))`,
})

const neonViolet: ThemePalette = {
  id: 'neon-violet',
  name: 'theme.neonViolet',
  primary: '#8b5cf6',
  secondary: '#d946ef',
  darkBg: '#0f172a',
  glass: createDarkGlass('15, 23, 42', '139, 92, 246', '217, 70, 239'),
  gradient: 'linear-gradient(135deg, #8b5cf6, #d946ef)',
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
    skipButton: {
      text: 'rgba(15, 23, 42, 0.94)',
      closeText: 'rgba(15, 23, 42, 0.66)',
    },
  }
}

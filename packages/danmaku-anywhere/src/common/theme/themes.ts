export interface ThemePalette {
  id: string
  name: string
  primary: string
  secondary: string
  darkBg: string
  glass: {
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

const neonViolet: ThemePalette = {
  id: 'neon-violet',
  name: 'theme.neonViolet',
  primary: '#8b5cf6',
  secondary: '#d946ef',
  darkBg: '#0f172a',
  glass: {
    base: 'rgba(15, 23, 42, 0.40)',
    hover: 'rgba(30, 41, 59, 0.55)',
    scrim: 'rgba(15, 23, 42, 0.68)',
    blur: 'blur(20px) saturate(180%)',
    border: 'rgba(255, 255, 255, 0.14)',
    borderGradient:
      'linear-gradient(165deg, rgba(255, 255, 255, 0.45) 0%, rgba(255, 255, 255, 0.08) 35%, rgba(139, 92, 246, 0.22) 70%, rgba(255, 255, 255, 0.12) 100%)',
    specular:
      'inset 0 1px 0 rgba(255, 255, 255, 0.25), inset 0 -1px 0 rgba(255, 255, 255, 0.05), inset 0 0 24px rgba(139, 92, 246, 0.08)',
    depth: '0 8px 32px rgba(0, 0, 0, 0.35), 0 2px 8px rgba(0, 0, 0, 0.25)',
    tint: 'linear-gradient(135deg, rgba(139, 92, 246, 0.10), rgba(217, 70, 239, 0.05))',
  },
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
  glass: {
    base: 'rgba(26, 15, 8, 0.42)',
    hover: 'rgba(46, 28, 16, 0.56)',
    scrim: 'rgba(26, 15, 8, 0.68)',
    blur: 'blur(20px) saturate(180%)',
    border: 'rgba(255, 224, 178, 0.14)',
    borderGradient:
      'linear-gradient(165deg, rgba(255, 244, 224, 0.45) 0%, rgba(255, 255, 255, 0.08) 35%, rgba(245, 158, 11, 0.22) 70%, rgba(255, 255, 255, 0.10) 100%)',
    specular:
      'inset 0 1px 0 rgba(255, 236, 200, 0.25), inset 0 -1px 0 rgba(255, 255, 255, 0.05), inset 0 0 24px rgba(245, 158, 11, 0.08)',
    depth: '0 8px 32px rgba(0, 0, 0, 0.35), 0 2px 8px rgba(0, 0, 0, 0.25)',
    tint: 'linear-gradient(135deg, rgba(245, 158, 11, 0.10), rgba(239, 68, 68, 0.05))',
  },
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
  glass: {
    base: 'rgba(10, 22, 40, 0.42)',
    hover: 'rgba(18, 38, 66, 0.56)',
    scrim: 'rgba(10, 22, 40, 0.70)',
    blur: 'blur(20px) saturate(180%)',
    border: 'rgba(186, 230, 253, 0.14)',
    borderGradient:
      'linear-gradient(165deg, rgba(224, 242, 254, 0.45) 0%, rgba(255, 255, 255, 0.08) 35%, rgba(14, 165, 233, 0.22) 70%, rgba(255, 255, 255, 0.10) 100%)',
    specular:
      'inset 0 1px 0 rgba(224, 242, 254, 0.25), inset 0 -1px 0 rgba(255, 255, 255, 0.05), inset 0 0 24px rgba(14, 165, 233, 0.08)',
    depth: '0 8px 32px rgba(0, 0, 0, 0.35), 0 2px 8px rgba(0, 0, 0, 0.25)',
    tint: 'linear-gradient(135deg, rgba(14, 165, 233, 0.10), rgba(6, 182, 212, 0.05))',
  },
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
  glass: {
    base: 'rgba(21, 10, 24, 0.42)',
    hover: 'rgba(38, 18, 44, 0.56)',
    scrim: 'rgba(21, 10, 24, 0.68)',
    blur: 'blur(20px) saturate(180%)',
    border: 'rgba(251, 207, 232, 0.14)',
    borderGradient:
      'linear-gradient(165deg, rgba(253, 242, 248, 0.45) 0%, rgba(255, 255, 255, 0.08) 35%, rgba(236, 72, 153, 0.22) 70%, rgba(255, 255, 255, 0.10) 100%)',
    specular:
      'inset 0 1px 0 rgba(251, 207, 232, 0.25), inset 0 -1px 0 rgba(255, 255, 255, 0.05), inset 0 0 24px rgba(236, 72, 153, 0.08)',
    depth: '0 8px 32px rgba(0, 0, 0, 0.35), 0 2px 8px rgba(0, 0, 0, 0.25)',
    tint: 'linear-gradient(135deg, rgba(236, 72, 153, 0.10), rgba(168, 85, 247, 0.05))',
  },
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

export const themeIds = Object.keys(themes)

export const DEFAULT_THEME_ID = 'neon-violet'

export const getThemePalette = (id: string): ThemePalette => {
  return themes[id] ?? themes[DEFAULT_THEME_ID]
}

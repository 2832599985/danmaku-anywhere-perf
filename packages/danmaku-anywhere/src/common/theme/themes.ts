export interface ThemePalette {
  id: string
  name: string
  primary: string
  secondary: string
  darkBg: string
  glass: {
    base: string
    hover: string
    border: string
    blur: string
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
    base: 'rgba(15, 23, 42, 0.7)',
    hover: 'rgba(30, 41, 59, 0.8)',
    border: 'rgba(255, 255, 255, 0.1)',
    blur: 'blur(12px)',
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
    base: 'rgba(26, 15, 8, 0.72)',
    hover: 'rgba(46, 28, 16, 0.82)',
    border: 'rgba(245, 158, 11, 0.12)',
    blur: 'blur(12px)',
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
    base: 'rgba(10, 22, 40, 0.75)',
    hover: 'rgba(18, 38, 66, 0.85)',
    border: 'rgba(14, 165, 233, 0.12)',
    blur: 'blur(12px)',
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
    base: 'rgba(21, 10, 24, 0.72)',
    hover: 'rgba(38, 18, 44, 0.82)',
    border: 'rgba(236, 72, 153, 0.12)',
    blur: 'blur(12px)',
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

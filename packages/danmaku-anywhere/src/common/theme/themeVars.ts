import type { ThemePalette } from '@/common/theme/themes'

export function getThemeCssVarsString(palette: ThemePalette): string {
  return `:host {
  --da-primary: ${palette.primary};
  --da-secondary: ${palette.secondary};
  --da-dark-bg: ${palette.darkBg};
  --da-glass-base: ${palette.glass.base};
  --da-glass-hover: ${palette.glass.hover};
  --da-glass-border: ${palette.glass.border};
  --da-glass-blur: ${palette.glass.blur};
  --da-gradient: ${palette.gradient};
  --da-density-played: ${palette.density.played};
  --da-density-unplayed: ${palette.density.unplayed};
  --da-region-op-fill: ${palette.regions.op.fill};
  --da-region-op-border: ${palette.regions.op.border};
  --da-region-ed-fill: ${palette.regions.ed.fill};
  --da-region-ed-border: ${palette.regions.ed.border};
  --da-skip-text: ${palette.skipButton.text};
  --da-skip-close-text: ${palette.skipButton.closeText};
}`
}

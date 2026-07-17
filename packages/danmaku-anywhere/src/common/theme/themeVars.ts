import type { ThemePalette } from '@/common/theme/themes'
import { DATA_FONT, MOTION, RADIUS } from '@/common/theme/tokens'

/**
 * Serializes a palette (plus the invariant radius/motion/font tokens) into a
 * `:host` CSS variable block for the shadow DOM. Player-layer code has no React
 * and reads these vars directly; keep every token that plain-DOM surfaces need
 * mirrored here.
 */
export function getThemeCssVarsString(palette: ThemePalette): string {
  return `:host {
  --da-primary: ${palette.primary};
  --da-secondary: ${palette.secondary};
  --da-dark-bg: ${palette.darkBg};
  --da-glass-base: ${palette.glass.base};
  --da-glass-hover: ${palette.glass.hover};
  --da-glass-scrim: ${palette.glass.scrim};
  --da-glass-overlay: ${palette.glass.overlay};
  --da-glass-border: ${palette.glass.border};
  --da-glass-border-gradient: ${palette.glass.borderGradient};
  --da-glass-blur: ${palette.glass.blur};
  --da-glass-specular: ${palette.glass.specular};
  --da-glass-depth: ${palette.glass.depth};
  --da-glass-glow: ${palette.glass.glow};
  --da-glass-tint: ${palette.glass.tint};
  --da-glass-solid: ${palette.glass.solid};
  --da-canvas-backdrop: ${palette.canvas.backdrop};
  --da-gradient: ${palette.gradient};
  --da-status-success: ${palette.status.success};
  --da-status-warning: ${palette.status.warning};
  --da-status-error: ${palette.status.error};
  --da-status-info: ${palette.status.info};
  --da-density-played: ${palette.density.played};
  --da-density-unplayed: ${palette.density.unplayed};
  --da-region-op-fill: ${palette.regions.op.fill};
  --da-region-op-border: ${palette.regions.op.border};
  --da-region-ed-fill: ${palette.regions.ed.fill};
  --da-region-ed-border: ${palette.regions.ed.border};
  --da-skip-text: ${palette.skipButton.text};
  --da-skip-close-text: ${palette.skipButton.closeText};
  --da-radius-s: ${RADIUS.s}px;
  --da-radius-m: ${RADIUS.m}px;
  --da-radius-l: ${RADIUS.l}px;
  --da-radius-pill: ${RADIUS.pill}px;
  --da-ease-swift: ${MOTION.easeSwift};
  --da-dur-fast: ${MOTION.durFast}ms;
  --da-dur-base: ${MOTION.durBase}ms;
  --da-dur-slow: ${MOTION.durSlow}ms;
  --da-font-data: ${DATA_FONT};
}`
}

import type { CSSObject } from '@mui/material/styles'
import type { ThemePalette } from '@/common/theme/themes'
import { MOTION, RADIUS } from '@/common/theme/tokens'

export interface LiquidGlassOptions {
  /**
   * 'chrome' = transparent fill (buttons); 'surface' = scrim fill (text-dense);
   * 'overlay' = near-opaque fill (dialogs/tooltips over bright video).
   */
  variant?: 'chrome' | 'surface' | 'overlay'
  /** One of the four radius steps, or an explicit value. Defaults to l. */
  radius?: keyof typeof RADIUS | number | string
  /** Renders the top-lit gradient rim via ::before mask; else flat 1px border */
  gradientBorder?: boolean
  /** Adds hover/active micro-interactions */
  interactive?: boolean
  /** Adds the theme bloom (glass.glow) to the shadow stack */
  glow?: boolean
}

const resolveRadius = (radius: LiquidGlassOptions['radius']): string => {
  if (typeof radius === 'number') return `${radius}px`
  if (typeof radius === 'string' && radius in RADIUS)
    return `${RADIUS[radius as keyof typeof RADIUS]}px`
  if (typeof radius === 'string') return radius
  return `${RADIUS.l}px`
}

/**
 * Shared liquid-glass recipe: translucent tinted fill, blur + saturate
 * backdrop, inset specular highlights and a soft drop shadow. Components
 * using the 'chrome' variant must keep copy short/bold and apply
 * GLASS_TEXT_SHADOW to text for readability over bright video.
 *
 * Under `prefers-reduced-transparency` the blur and translucent fill are
 * dropped for an opaque `glass.solid` fill — the rim and specular stay, so the
 * surface keeps its identity without a live backdrop filter (T3 fallback).
 */
export const getLiquidGlassSx = (
  palette: ThemePalette,
  options: LiquidGlassOptions = {}
): CSSObject => {
  const {
    variant = 'surface',
    radius = 'l',
    gradientBorder = false,
    interactive = false,
    glow = false,
  } = options
  const g = palette.glass
  const fill =
    variant === 'chrome' ? g.base : variant === 'overlay' ? g.overlay : g.scrim
  const shadow = glow
    ? `${g.specular}, ${g.depth}, ${g.glow}`
    : `${g.specular}, ${g.depth}`

  return {
    position: 'relative',
    backgroundColor: fill,
    backgroundImage: g.tint,
    backgroundClip: 'padding-box',
    backdropFilter: g.blur,
    WebkitBackdropFilter: g.blur,
    borderRadius: resolveRadius(radius),
    boxShadow: shadow,
    '@media (prefers-reduced-transparency: reduce)': {
      backgroundColor: g.solid,
      backgroundImage: 'none',
      backdropFilter: 'none',
      WebkitBackdropFilter: 'none',
    },
    ...(gradientBorder
      ? {
          border: 'none',
          // 1px gradient rim: paint the gradient on a 1px-padded overlay and
          // mask out the content box (border-image can't follow border-radius)
          '&::before': {
            content: '""',
            position: 'absolute',
            inset: 0,
            borderRadius: 'inherit',
            padding: '1px',
            background: g.borderGradient,
            WebkitMask:
              'linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)',
            WebkitMaskComposite: 'xor',
            maskComposite: 'exclude',
            pointerEvents: 'none',
            zIndex: 1,
          },
        }
      : {
          border: `1px solid ${g.border}`,
        }),
    ...(interactive && {
      transition: `background-color ${MOTION.durBase}ms ${MOTION.easeSwift}, box-shadow ${MOTION.durBase}ms ${MOTION.easeSwift}, transform ${MOTION.durFast}ms ${MOTION.easeSwift}, filter ${MOTION.durBase}ms ${MOTION.easeSwift}`,
      '&:hover': {
        backgroundColor: g.hover,
        filter: 'brightness(1.08)',
      },
      '&:active': {
        transform: 'scale(0.97)',
        filter: 'brightness(0.98)',
      },
      '@media (prefers-reduced-motion: reduce)': {
        transition: 'background-color 80ms linear',
        '&:active': { transform: 'none' },
      },
    }),
  }
}

/** Text shadow required on any text sitting on 'chrome' (transparent) glass */
export const GLASS_TEXT_SHADOW = '0 1px 2px rgba(0, 0, 0, 0.6)'

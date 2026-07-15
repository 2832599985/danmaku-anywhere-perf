import type { CSSObject } from '@mui/material/styles'
import type { ThemePalette } from '@/common/theme/themes'

export interface LiquidGlassOptions {
  /** 'chrome' = transparent fill (buttons); 'surface' = scrim fill (text-dense) */
  variant?: 'chrome' | 'surface'
  radius?: number | string
  /** Renders the top-lit gradient rim via ::before mask; else flat 1px border */
  gradientBorder?: boolean
  /** Adds hover/active micro-interactions */
  interactive?: boolean
}

/**
 * Shared liquid-glass recipe: translucent tinted fill, blur + saturate
 * backdrop, inset specular highlights and a soft drop shadow. Components
 * using the 'chrome' variant must keep copy short/bold and apply
 * GLASS_TEXT_SHADOW to text for readability over bright video.
 */
export const getLiquidGlassSx = (
  palette: ThemePalette,
  options: LiquidGlassOptions = {}
): CSSObject => {
  const {
    variant = 'surface',
    radius = 20,
    gradientBorder = false,
    interactive = false,
  } = options
  const g = palette.glass
  const fill = variant === 'chrome' ? g.base : g.scrim

  return {
    position: 'relative',
    // multi-layer background: theme tint gradient over the translucent fill;
    // the color layer must come last in the shorthand
    background: `${g.tint}, ${fill}`,
    backdropFilter: g.blur,
    WebkitBackdropFilter: g.blur,
    borderRadius: typeof radius === 'number' ? `${radius}px` : radius,
    boxShadow: `${g.specular}, ${g.depth}`,
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
      transition:
        'background 0.2s ease, box-shadow 0.2s ease, transform 0.15s ease, filter 0.2s ease',
      '&:hover': {
        background: `${g.tint}, ${g.hover}`,
        filter: 'brightness(1.08)',
      },
      '&:active': {
        transform: 'scale(0.97)',
        filter: 'brightness(0.98)',
      },
    }),
  }
}

/** Text shadow required on any text sitting on 'chrome' (transparent) glass */
export const GLASS_TEXT_SHADOW = '0 1px 2px rgba(0, 0, 0, 0.6)'

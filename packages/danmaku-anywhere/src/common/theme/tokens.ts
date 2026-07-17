/**
 * Theme-independent design tokens for the「放映厅」UI language.
 *
 * Palettes (themes.ts) carry color/glass; these carry the invariant scales —
 * radius steps, motion curves, and the data typeface — so every surface,
 * React or plain-DOM, pulls from one source. Player-layer code reads the
 * mirrored CSS vars (see themeVars.ts); React code imports these directly.
 */

/** The only four corner radii allowed. Everything rounds to one of these. */
export const RADIUS = {
  /** chips, badges, small tags */
  s: 10,
  /** list rows, inputs, menus (= MUI shape.borderRadius) */
  m: 16,
  /** panels, cards, dialogs, the popup floating card */
  l: 22,
  /** FAB, skip buttons, switches, pill buttons */
  pill: 999,
} as const

/** Motion curves and durations. Swift easing gives the iOS-like glass feel. */
export const MOTION = {
  /** primary easing — decisive in, gentle settle */
  easeSwift: 'cubic-bezier(0.32, 0.72, 0.16, 1)',
  /** accelerating exit for things leaving the screen */
  easeExit: 'cubic-bezier(0.4, 0, 1, 1)',
  /** hover / press feedback */
  durFast: 120,
  /** expand / collapse, menus */
  durBase: 200,
  /** panel open, scene-level transitions */
  durSlow: 320,
} as const

/**
 * Data typeface for numeric/technical positions (timestamps, counts, episode
 * numbers, provider tags). A monospace stack — not a bundled webfont — so it
 * costs zero bytes on every content-script injection and never touches the
 * host page's font set. tabular-nums keeps digits column-aligned.
 */
export const DATA_FONT =
  'ui-monospace, "SF Mono", "Cascadia Code", "JetBrains Mono", "Roboto Mono", Consolas, monospace'

/** Body/UI font stack: native first, with CJK fallbacks. No bundled CJK. */
export const UI_FONT =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, "Microsoft YaHei", "PingFang SC", "Hiragino Sans GB", "Noto Sans CJK SC", sans-serif'

/** sx helper for data positions: mono + tabular figures. */
export const dataFigures = {
  fontFamily: DATA_FONT,
  fontVariantNumeric: 'tabular-nums' as const,
  letterSpacing: '0.01em',
}

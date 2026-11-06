/**
 * Row pitch for the danmaku engine.
 *
 * The engine places each comment at `track.middle - height / 2`, where `height`
 * is the node's measured `clientHeight`. If a node is taller than its track it
 * spills into the track below and the two lines collide. The engine's own
 * `trackHeight` default is a fixed 32px, while the browser's default line box
 * for CJK system fonts is ~1.35em — so a 26px font was already 35px tall and
 * touched the next row, and anything larger piled up.
 *
 * Two knobs fix that, and they must agree:
 *  - `TEXT_BOX_RATIO` pins `line-height` on every node, so its height is
 *    exactly `fontSize * TEXT_BOX_RATIO` instead of whatever the font decides.
 *  - `lineHeight` (the user's 行距 slider) is the *pitch*: how much vertical
 *    space each row gets, as a multiple of the font size.
 *
 * Pitch is rounded UP so the box can never be taller than the track holding it,
 * and floored at `TEXT_BOX_RATIO` so even a stale persisted value can't
 * produce overlapping rows.
 */

/** Pinned `line-height` (unitless) of the text box: tight, but no glyph clipping. */
export const TEXT_BOX_RATIO = 1.15

/** Default row pitch: 45% more space than the glyphs themselves take. */
export const DEFAULT_LINE_HEIGHT = 1.45

/** Compactest pitch the slider offers: still a visible gap, never touching. */
export const LINE_HEIGHT_MIN = 1.25
export const LINE_HEIGHT_MAX = 2.2
export const LINE_HEIGHT_STEP = 0.05

/** Track pitch in px for a given font size and 行距 multiplier. */
export const danmakuTrackHeight = (
  fontSize: number,
  lineHeight: number
): number => {
  const size = Number.isFinite(fontSize) && fontSize > 0 ? fontSize : 1
  const ratio =
    Number.isFinite(lineHeight) && lineHeight > 0 ? lineHeight : TEXT_BOX_RATIO
  // Never below the box, or the next row would overlap this one.
  const pitch = size * Math.max(ratio, TEXT_BOX_RATIO)
  return Math.max(1, Math.ceil(pitch))
}

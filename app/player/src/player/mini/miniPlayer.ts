import type { DanmakuSettings, SubtitleSettings } from '@/store/settings'

/**
 * Mini player (小窗) geometry and the temporary text scaling it applies.
 *
 * The scaling is applied where settings are handed to the danmaku engine and
 * the subtitle renderer, never written to the store: leaving the mini window
 * must bring back exactly the sizes the user chose.
 */

/** Default mini window width in logical px; the height follows the source. */
export const MINI_WIDTH = 480
/** Used until the video reports its size (or for a degenerate one). */
const FALLBACK_ASPECT = 16 / 9

/** Text in a ~480px window at full size would cover the picture. */
export const MINI_TEXT_SCALE = 0.6
/** Never shrink text below what is still readable. */
const MINI_MIN_FONT = 12

/** Window size for the mini player, matching the source's aspect ratio. */
export const miniWindowSize = (
  videoWidth: number,
  videoHeight: number
): { width: number; height: number } => {
  const aspect =
    videoWidth > 0 && videoHeight > 0
      ? videoWidth / videoHeight
      : FALLBACK_ASPECT
  // Very tall or very wide sources would give an unusable strip; keep the
  // window between 4:3-ish and 21:9-ish.
  const clamped = Math.min(Math.max(aspect, 1.2), 2.4)
  return { width: MINI_WIDTH, height: Math.round(MINI_WIDTH / clamped) }
}

const scaleFont = (size: number): number =>
  Math.max(MINI_MIN_FONT, Math.round(size * MINI_TEXT_SCALE))

/** Danmaku settings as the engine should see them right now. */
export const effectiveDanmakuSettings = (
  settings: DanmakuSettings,
  mini: boolean
): DanmakuSettings =>
  mini ? { ...settings, fontSize: scaleFont(settings.fontSize) } : settings

/** Subtitle settings as the renderer should see them right now. */
export const effectiveSubtitleSettings = (
  settings: SubtitleSettings,
  mini: boolean
): SubtitleSettings =>
  mini ? { ...settings, fontSize: scaleFont(settings.fontSize) } : settings

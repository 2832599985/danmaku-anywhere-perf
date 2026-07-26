/**
 * Settings shapes + defaults (FROZEN — see CONTRACT.md §7).
 * The upscale block mirrors the extension's schema 1:1 so the engine glue is
 * identical. Danmaku settings are a flat, UI-friendly view that the
 * DanmakuController translates into the engine's nested DanmakuOptions.
 */

export type UpscaleModeId =
  | 'builtin-mode-a'
  | 'builtin-mode-b'
  | 'builtin-mode-c'
  | 'builtin-mode-aa'
  | 'builtin-mode-bb'
  | 'builtin-mode-ca'

export type PerformanceTier = 'performance' | 'balanced' | 'quality' | 'ultra'

export type TargetResolution =
  | 'x2'
  | 'x4'
  | 'x8'
  | '720p'
  | '1080p'
  | '2k'
  | '4k'
  | 'native'

export type InterpolationResolution = '480p' | '720p'

/** How the interpolation factor is chosen. */
export type InterpolationMode = 'multiplier' | 'targetFps'
/** Explicit integer factors offered in the UI. */
export type InterpolationMultiplier = 2 | 3 | 4
/** Target output frame rates offered in the UI (matches common refresh rates). */
export type InterpolationTargetFps = 60 | 120 | 144 | 170

export interface UpscaleSettings {
  enabled: boolean
  modeId: UpscaleModeId
  performanceTier: PerformanceTier
  targetResolution: TargetResolution
  frameInterpolation: {
    enabled: boolean
    resolution: InterpolationResolution
    /** 'multiplier' = fixed N×; 'targetFps' = adapt N× to reach a target fps. */
    mode: InterpolationMode
    /** used when mode === 'multiplier'. */
    multiplier: InterpolationMultiplier
    /** used when mode === 'targetFps'. */
    targetFps: InterpolationTargetFps
  }
}

/** A patch for UpscaleSettings that allows a partial nested frameInterpolation. */
export type UpscaleSettingsPatch = Partial<
  Omit<UpscaleSettings, 'frameInterpolation'>
> & {
  frameInterpolation?: Partial<UpscaleSettings['frameInterpolation']>
}

export interface DanmakuSettings {
  /** Whether danmaku are shown (maps to renderer show()/hide()). */
  visible: boolean
  /** 0..1 */
  opacity: number
  /** px */
  fontSize: number
  /** engine scroll speed multiplier (1 = default). */
  speed: number
  /** display area as a percentage of height, measured from the top (yEnd). */
  area: number
  /** timing offset in milliseconds (danmaku shifted vs. video time). */
  offset: number
  /** maximum simultaneous on-screen danmaku. */
  maxOnScreen: number
  /** 0..100 overlap tolerance. */
  overlap: number
}

export interface PlaybackSettings {
  /** seconds moved by ArrowLeft / ArrowRight. */
  seekStepSec: number
  /** volume delta (0..1) moved by ArrowUp / ArrowDown. */
  volumeStep: number
  /** when the current video ends, automatically play the next playlist item. */
  autoAdvance: boolean
}

export interface Settings {
  upscale: UpscaleSettings
  danmaku: DanmakuSettings
  playback: PlaybackSettings
}

export const DEFAULT_UPSCALE: UpscaleSettings = {
  enabled: false,
  modeId: 'builtin-mode-a',
  performanceTier: 'balanced',
  targetResolution: 'x2',
  frameInterpolation: {
    enabled: false,
    resolution: '720p',
    mode: 'multiplier',
    multiplier: 2,
    targetFps: 60,
  },
}

export const DEFAULT_DANMAKU: DanmakuSettings = {
  visible: true,
  opacity: 0.75,
  fontSize: 26,
  speed: 1,
  area: 100,
  offset: 0,
  maxOnScreen: 200,
  overlap: 0,
}

export const DEFAULT_PLAYBACK: PlaybackSettings = {
  seekStepSec: 5,
  volumeStep: 0.05,
  autoAdvance: true,
}

export const DEFAULT_SETTINGS: Settings = {
  upscale: DEFAULT_UPSCALE,
  danmaku: DEFAULT_DANMAKU,
  playback: DEFAULT_PLAYBACK,
}

/** Anime4K base-mode letter for each built-in mode id. */
export const MODE_ID_TO_BASE_MODE: Record<
  UpscaleModeId,
  'A' | 'B' | 'C' | 'A+A' | 'B+B' | 'C+A'
> = {
  'builtin-mode-a': 'A',
  'builtin-mode-b': 'B',
  'builtin-mode-c': 'C',
  'builtin-mode-aa': 'A+A',
  'builtin-mode-bb': 'B+B',
  'builtin-mode-ca': 'C+A',
}

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

export type InterpolationResolution = '480p' | '720p' | '1080p'

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

/** A blocked-word rule: plain substring or (when isRegex) a RegExp source. */
export interface DanmakuFilter {
  pattern: string
  isRegex: boolean
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
  /** drop all but the first of comments with identical text (降重). */
  mergeDuplicates: boolean
  /** blocked words applied before comments reach the renderer. */
  filters: DanmakuFilter[]
  /**
   * When no sibling danmaku file exists, parse the filename with the free
   * built-in AI (proxy-hosted Gemini) and auto search+mount DanDanPlay
   * danmaku. Tauri only; silent no-op on network/parse failure.
   */
  autoOnlineMatch: boolean
}

/** How the player handles detected OP/ED segments. */
export type SkipOpEdMode = 'auto' | 'ask' | 'off'

/** Which recognition engine local speech-to-text uses. */
export type SubtitleEngine = 'sensevoice' | 'whisper'
/** Language fed to recognition ('auto' lets the engine decide). */
export type SubtitleSourceLanguage = 'auto' | 'ja' | 'zh'
/** What the subtitle layer shows: the transcription or a Chinese translation. */
export type SubtitleDisplayLanguage = 'source' | 'zh'

export interface SubtitleSettings {
  /** master switch; hides the layer without dropping mounted cues. */
  visible: boolean
  /** px */
  fontSize: number
  /** timing offset in ms (positive = cues shown later, danmaku convention). */
  offset: number
  /** distance of the cue block from the stage bottom, % of stage height. */
  bottom: number
  /** 0..1 */
  opacity: number
  /** ink outline + hard shadow behind the paper-colored text. */
  outline: boolean
  /** recognition engine used when generating subtitles from audio. */
  engine: SubtitleEngine
  /** language of the audio source fed to recognition. */
  sourceLanguage: SubtitleSourceLanguage
  /** what the layer displays: transcription or the translated Chinese track. */
  displayLanguage: SubtitleDisplayLanguage
  /** translate generated cues to Chinese with the built-in AI (ja→zh). */
  autoTranslate: boolean
  /** prefer GPU inference when available (falls back to CPU). */
  useGpu: boolean
}

export interface PlaybackSettings {
  /** seconds moved by ArrowLeft / ArrowRight. */
  seekStepSec: number
  /** volume delta (0..1) moved by ArrowUp / ArrowDown. */
  volumeStep: number
  /** when the current video ends, automatically play the next playlist item. */
  autoAdvance: boolean
  /** OP/ED skip behavior: auto-skip, ask first, or disabled. */
  skipOpEd: SkipOpEdMode
  /**
   * Temporary playback rate while the right arrow is HELD (long press). A
   * short tap still seeks; only an auto-repeated press engages this rate, and
   * releasing the key restores whatever the global rate was before the hold
   * (snapshotted on engage, so a 1.5× global rate resumes after a 3× hold).
   */
  holdSpeed: number
}

export interface Settings {
  upscale: UpscaleSettings
  danmaku: DanmakuSettings
  playback: PlaybackSettings
  subtitle: SubtitleSettings
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
  mergeDuplicates: false,
  filters: [],
  autoOnlineMatch: true,
}

export const DEFAULT_PLAYBACK: PlaybackSettings = {
  seekStepSec: 5,
  volumeStep: 0.05,
  autoAdvance: true,
  skipOpEd: 'ask',
  holdSpeed: 3,
}

export const DEFAULT_SUBTITLE: SubtitleSettings = {
  visible: true,
  fontSize: 30,
  offset: 0,
  bottom: 6,
  opacity: 1,
  outline: true,
  engine: 'sensevoice',
  sourceLanguage: 'auto',
  displayLanguage: 'source',
  autoTranslate: true,
  useGpu: false,
}

export const DEFAULT_SETTINGS: Settings = {
  upscale: DEFAULT_UPSCALE,
  danmaku: DEFAULT_DANMAKU,
  playback: DEFAULT_PLAYBACK,
  subtitle: DEFAULT_SUBTITLE,
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

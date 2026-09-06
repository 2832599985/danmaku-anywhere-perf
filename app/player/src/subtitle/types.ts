/**
 * Shared subtitle shapes. Times are seconds from video start; a cue's text may
 * contain `\n` for multi-line display.
 */

/** One timed subtitle line. */
export interface SubtitleCue {
  start: number
  end: number
  text: string
}

/** Where the mounted cues came from (mirrors DanmakuSource). */
export interface SubtitleSource {
  label: string
  count: number
  /** 'file' = external/sibling subtitle file; 'generated' = local speech-to-text. */
  kind: 'file' | 'generated'
}

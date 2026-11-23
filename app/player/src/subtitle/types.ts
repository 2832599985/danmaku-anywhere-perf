/**
 * Shared subtitle shapes. Times are seconds from video start; a cue's text may
 * contain `\n` for multi-line display.
 */

/** One timed subtitle line. */
export interface SubtitleCue {
  start: number
  end: number
  text: string
  /**
   * Numpad alignment, the ASS `\an` convention: 1–3 bottom, 4–6 middle, 7–9
   * top (left / center / right within each row). Absent = 2, bottom center.
   * SRT carries it as a leading `{\an8}`.
   */
  align?: number
  /**
   * Typeset position (ASS `\pos`, or the start of a `\move`) as fractions of
   * the script's play area, anchored by `align`. Absent = flows with the
   * other lines of its row.
   */
  pos?: { x: number; y: number }
  /**
   * Size relative to the track's main dialogue style — the Japanese line of a
   * bilingual fansub track is typically ~0.65. Absent = 1.
   */
  scale?: number
  italic?: boolean
  /**
   * Vertical margin in script pixels (ASS MarginV). Only used to order lines
   * that share a row: a larger margin sits further from the edge, which is how
   * bilingual scripts put the Chinese line above the Japanese one.
   */
  marginV?: number
}

/** Where the mounted cues came from (mirrors DanmakuSource). */
export interface SubtitleSource {
  label: string
  count: number
  /** 'file' = external/sibling subtitle file; 'generated' = local speech-to-text. */
  kind: 'file' | 'generated'
  /**
   * true while only the minutes around the playhead are mounted (an embedded
   * track's quick first read); the whole track replaces them shortly.
   */
  loading?: boolean
}

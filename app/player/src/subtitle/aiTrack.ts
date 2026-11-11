/**
 * The AI subtitle track as data: recognized Japanese lines, their Chinese,
 * and which stretches of the video recognition has covered. Pure functions
 * only — the scheduler in `generate.ts` owns the state, this module answers
 * "what is covered", "what to translate next" and "what goes on screen".
 */
import type { SubtitleCue } from './types'

/** One recognized line. */
export interface AiLine {
  start: number
  end: number
  ja: string
  /**
   * undefined = not translated yet; null = translation tried and rejected
   * (shown as the Japanese, never retried); string = the Chinese.
   */
  zh?: string | null
}

/** Half-open span of video time, seconds. */
export interface Interval {
  from: number
  to: number
}

export type DisplayMode = 'zh' | 'ja' | 'dual'

/** Gaps this small between covered spans count as covered. */
const JOIN_EPS = 0.5

/** Insert a covered span, merging overlapping/adjacent ones. */
export const addInterval = (list: Interval[], add: Interval): Interval[] => {
  if (!(add.to > add.from)) return list
  const all = [...list, add].sort((a, b) => a.from - b.from)
  const out: Interval[] = []
  for (const iv of all) {
    const last = out[out.length - 1]
    if (last && iv.from <= last.to + JOIN_EPS) {
      last.to = Math.max(last.to, iv.to)
    } else {
      out.push({ ...iv })
    }
  }
  return out
}

/** End of the covered span containing `t`, or null when `t` is uncovered. */
export const coveredEnd = (list: Interval[], t: number): number | null => {
  for (const iv of list) {
    if (t >= iv.from - JOIN_EPS && t < iv.to) return iv.to
  }
  return null
}

/**
 * Merge freshly recognized lines into the track. A line that duplicates an
 * existing one (same text starting within a second — the same audio heard
 * by two overlapping runs) is dropped; translations already made are kept.
 */
export const mergeLines = (
  existing: AiLine[],
  incoming: AiLine[]
): AiLine[] => {
  const fresh = incoming.filter(
    (line) =>
      !existing.some(
        (old) => old.ja === line.ja && Math.abs(old.start - line.start) < 1
      )
  )
  if (!fresh.length) return existing
  return [...existing, ...fresh].sort((a, b) => a.start - b.start)
}

/** Lines just before the playhead still get translated first (a seek lands mid-line). */
const PRIORITY_BEHIND = 3
/** …and the next minute ahead of it. */
const PRIORITY_AHEAD = 60

/**
 * Indices of the next lines to translate (≤ size), playhead first:
 * untranslated lines starting in [playhead-3, playhead+60] in time order, then
 * the rest after the playhead, then whatever is left behind it.
 */
export const pickBatch = (
  lines: AiLine[],
  playhead: number,
  size: number
): number[] => {
  const pending = lines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => line.zh === undefined)
  const near = pending.filter(
    ({ line }) =>
      line.end > playhead - PRIORITY_BEHIND &&
      line.start <= playhead + PRIORITY_AHEAD
  )
  const after = pending.filter(
    ({ line }) => line.start > playhead + PRIORITY_AHEAD
  )
  const behind = pending.filter(
    ({ line }) => line.end <= playhead - PRIORITY_BEHIND
  )
  return [...near, ...after, ...behind.reverse()]
    .slice(0, size)
    .map(({ index }) => index)
}

/**
 * How far from `playhead` the Chinese is complete: up to the first line that
 * still waits for translation, and never past what recognition has covered.
 * Returns `playhead` itself when nothing ahead is ready.
 */
export const zhFrontier = (
  lines: AiLine[],
  asr: Interval[],
  playhead: number
): number => {
  const asrTo = coveredEnd(asr, playhead)
  if (asrTo === null) return playhead
  const blocking = lines.find(
    (line) => line.end > playhead && line.start < asrTo && line.zh === undefined
  )
  return blocking ? Math.max(playhead, blocking.start) : asrTo
}

/** True when any line before `until` still needs translating. */
export const hasPendingBefore = (lines: AiLine[], until: number): boolean =>
  lines.some((line) => line.zh === undefined && line.start < until)

/** Japanese line under the Chinese in bilingual mode (fansub convention). */
const DUAL_JA_SCALE = 0.62

/**
 * On-screen cues for a display mode. A line without (usable) Chinese shows
 * its Japanese in every mode — an untranslated line is never blank.
 * Bilingual = Chinese above, smaller Japanese below: two cues in the bottom
 * row, the larger margin placed higher (see SubtitleRenderer).
 */
export const buildCues = (
  lines: AiLine[],
  mode: DisplayMode
): SubtitleCue[] => {
  const out: SubtitleCue[] = []
  for (const line of lines) {
    const { start, end, ja } = line
    const zh = typeof line.zh === 'string' ? line.zh : null
    if (mode === 'ja' || !zh) {
      out.push({ start, end, text: ja })
    } else if (mode === 'zh') {
      out.push({ start, end, text: zh })
    } else {
      out.push({ start, end, text: zh, marginV: 1 })
      out.push({ start, end, text: ja, scale: DUAL_JA_SCALE, marginV: 0 })
    }
  }
  return out
}

/** Next mode for the cycle shortcut. */
export const nextDisplayMode = (mode: DisplayMode): DisplayMode =>
  mode === 'dual' ? 'zh' : mode === 'zh' ? 'ja' : 'dual'

export const DISPLAY_MODE_LABEL: Record<DisplayMode, string> = {
  dual: '双语',
  zh: '译文',
  ja: '原文',
}

// ---------------------------------------------------------------------------
// Cache (persisted per video by Rust under <data dir>/subs/)
// ---------------------------------------------------------------------------

interface CacheFile {
  v: 1
  lines: AiLine[]
  asr: Interval[]
}

export const serializeTrack = (lines: AiLine[], asr: Interval[]): string =>
  JSON.stringify({ v: 1, lines, asr } satisfies CacheFile)

const isNum = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v)

/** Parse a cache file; null when absent, foreign or corrupt. */
export const parseTrack = (
  text: string | null
): { lines: AiLine[]; asr: Interval[] } | null => {
  if (!text) return null
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return null
  }
  if (!raw || typeof raw !== 'object') return null
  const file = raw as Partial<CacheFile>
  if (file.v !== 1 || !Array.isArray(file.lines) || !Array.isArray(file.asr)) {
    return null
  }
  const lines: AiLine[] = []
  for (const item of file.lines as unknown[]) {
    const l = item as Partial<AiLine>
    if (!isNum(l?.start) || !isNum(l.end) || typeof l.ja !== 'string') continue
    const line: AiLine = { start: l.start, end: l.end, ja: l.ja }
    if (typeof l.zh === 'string' || l.zh === null) line.zh = l.zh
    lines.push(line)
  }
  let asr: Interval[] = []
  for (const item of file.asr as unknown[]) {
    const iv = item as Partial<Interval>
    if (isNum(iv?.from) && isNum(iv.to)) {
      asr = addInterval(asr, { from: iv.from, to: iv.to })
    }
  }
  return { lines: lines.sort((a, b) => a.start - b.start), asr }
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export type ExportKind = 'zh' | 'ja' | 'dual'

/** Cues for an exported .srt (bilingual = two lines in one cue). */
export const exportCues = (lines: AiLine[], kind: ExportKind): SubtitleCue[] =>
  lines.map(({ start, end, ja, zh }) => {
    const chinese = typeof zh === 'string' ? zh : null
    const text =
      kind === 'ja'
        ? ja
        : kind === 'zh'
          ? (chinese ?? ja)
          : chinese
            ? `${chinese}\n${ja}`
            : ja
    return { start, end, text }
  })

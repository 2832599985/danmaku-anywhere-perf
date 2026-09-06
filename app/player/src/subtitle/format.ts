import type { SubtitleCue } from './types'

/**
 * Subtitle file parsing/serialization: SRT (+ WebVTT-compatible timestamps)
 * and a basic ASS/SSA reader. The pickers and drop handlers route .srt/.ass/
 * .vtt here; everything is parsed to plain SubtitleCue[] — styling markup is
 * stripped, multi-line text is kept as \n.
 */

const TIME_RE = /(\d{1,2}):(\d{1,2}):(\d{1,2})[.,](\d{1,3})/

const toSeconds = (
  h: string,
  m: string,
  s: string,
  frac: string
): number | null => {
  const hh = Number(h)
  const mm = Number(m)
  const ss = Number(s)
  if (
    !Number.isFinite(hh) ||
    !Number.isFinite(mm) ||
    !Number.isFinite(ss) ||
    mm > 59 ||
    ss > 59
  ) {
    return null
  }
  // ".5" means 500ms, ".050" means 50ms.
  const ms = Number(frac.padEnd(3, '0').slice(0, 3))
  return hh * 3600 + mm * 60 + ss + ms / 1000
}

/** Parse one SRT/VTT timestamp token ("00:01:02,500" / "0:01:02.500"). */
const parseTimestamp = (token: string): number | null => {
  const match = TIME_RE.exec(token.trim())
  if (!match) return null
  const [, h, m, s, frac] = match
  return toSeconds(h, m, s, frac)
}

/** Drop inline markup: <i>, </font>, {\an8} override tags. */
const stripTags = (text: string): string =>
  text.replace(/\{\\[^}]*\}/g, '').replace(/<[^>]+>/g, '')

const cleanText = (text: string): string =>
  stripTags(text)
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .trim()

/**
 * SRT (and lenient WebVTT) parser. Blocks are blank-line separated; within a
 * block everything before the "-->" line is an optional index/identifier and
 * everything after it is the text, so both numbered SRT and id-prefixed VTT
 * parse with the same loop. Line endings are normalized first: most SRT files
 * are CRLF and a lone "\r" between blocks would defeat the "\n{2,}" split.
 */
const parseSrt = (raw: string): SubtitleCue[] => {
  const text = raw.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
  const cues: SubtitleCue[] = []
  for (const block of text.split(/\n{2,}/)) {
    const lines = block.split('\n')
    const arrow = lines.findIndex((line) => line.includes('-->'))
    if (arrow < 0) continue
    const [from, to] = lines[arrow].split('-->')
    if (!from || !to) continue
    const start = parseTimestamp(from)
    // `.split(/\s+/)` on a leading-space string yields '' first — trim first.
    const end = parseTimestamp(to.trim().split(/\s+/)[0] ?? '')
    if (start === null || end === null || end <= start) continue
    const body = cleanText(lines.slice(arrow + 1).join('\n'))
    if (!body) continue
    cues.push({ start, end, text: body })
  }
  return cues
}

/** ASS/SSA centisecond timestamp ("0:01:02.50"). */
const parseAssTimestamp = (token: string): number | null => {
  const match = /^(\d+):(\d{1,2}):(\d{1,2})[.,](\d{1,3})$/.exec(token.trim())
  if (!match) return null
  const [, h, m, s, frac] = match
  return toSeconds(h, m, s, frac)
}

/**
 * Minimal ASS/SSA reader: finds the [Events] section, reads the Format line to
 * locate the Start/End/Text columns, and strips override tags. Only dialogue
 * lines become cues; positioning/styling is ignored (bottom-centered render).
 */
const parseAss = (raw: string): SubtitleCue[] => {
  const text = raw.replace(/^\uFEFF/, '')
  const cues: SubtitleCue[] = []
  let fields: string[] | null = null
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (/^\[.*\]$/.test(trimmed)) {
      // Leaving [Events] invalidates the format spec.
      if (fields && !/^events$/i.test(trimmed.slice(1, -1))) fields = null
      continue
    }
    const separator = trimmed.indexOf(':')
    if (separator < 0) continue
    const key = trimmed.slice(0, separator).trim().toLowerCase()
    const value = trimmed.slice(separator + 1)
    if (key === 'format' && fields === null) {
      fields = value.split(',').map((f) => f.trim().toLowerCase())
      continue
    }
    if (key !== 'dialogue' || !fields) continue
    // Keep the tail intact: dialogue text itself contains commas.
    const parts = value.split(',')
    if (parts.length < fields.length) continue
    const fieldOf = (name: string): string => {
      const index = fields?.indexOf(name) ?? -1
      return index >= 0 && index < parts.length ? parts[index].trim() : ''
    }
    const start = parseAssTimestamp(fieldOf('start'))
    const end = parseAssTimestamp(fieldOf('end'))
    // Text is the last field; rejoin any extra splits.
    const textIndex = fields.indexOf('text')
    const body = cleanText(
      (textIndex >= 0 ? parts.slice(textIndex).join(',') : '')
        .replace(/\\N/gi, '\n')
        .replace(/\\h/g, ' ')
    )
    if (start === null || end === null || end <= start || !body) continue
    cues.push({ start, end, text: body })
  }
  return cues
}

const looksLikeAss = (text: string): boolean =>
  text.includes('[Script Info]') && /^\s*Dialogue:/m.test(text)

/**
 * Parse a subtitle file by name (extension decides the format; content sniffing
 * rescues mislabeled files). Returns cues sorted by start time.
 */
export const parseSubtitleText = (raw: string, name: string): SubtitleCue[] => {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  if (ext === 'ass' || ext === 'ssa' || looksLikeAss(raw)) {
    return sortCues(parseAss(raw))
  }
  return sortCues(parseSrt(raw))
}

/** Sort by start time (binary-search cue lookup in the controller requires it). */
export const sortCues = (cues: SubtitleCue[]): SubtitleCue[] =>
  [...cues].sort((a, b) => a.start - b.start)

const pad = (value: number, width = 2): string =>
  value.toString().padStart(width, '0')

const formatSrtTimestamp = (seconds: number): string => {
  const total = Math.max(0, seconds)
  const ms = Math.round((total % 1) * 1000)
  // Rounding can push 59.9995 to 1000ms; fold it back.
  const rest = ms === 1000 ? total + 1 : total
  const safeMs = ms === 1000 ? 0 : ms
  return `${pad(Math.floor(rest / 3600))}:${pad(
    Math.floor((rest / 60) % 60)
  )}:${pad(Math.floor(rest % 60))},${pad(safeMs, 3)}`
}

/** Serialize cues to SRT (the on-disk cache format for generated subtitles). */
export const serializeSrt = (cues: SubtitleCue[]): string =>
  cues
    .map(
      (cue, index) =>
        `${index + 1}\n${formatSrtTimestamp(cue.start)} --> ${formatSrtTimestamp(
          cue.end
        )}\n${cue.text.replace(/\n/g, '\n')}`
    )
    .join('\n\n') + (cues.length ? '\n' : '')

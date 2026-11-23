import type { SubtitleCue } from './types'

/**
 * Subtitle file parsing: SRT, WebVTT and ASS/SSA → start-sorted SubtitleCue[].
 *
 * Plain-text formats keep what the renderer can show (line breaks, `{\an8}`
 * top placement, whole-line italics) and drop the rest. ASS keeps the layout a
 * fansub track depends on — alignment, `\pos` for signs, the relative size of
 * each style (a bilingual track's Japanese line is smaller than the Chinese
 * one), margins that stack the two lines — and drops what must never reach the
 * screen: `{comments}`, vector drawings (`\p1 m 0 0 l …`), `Comment:` events,
 * embedded fonts. Animation (`\t`, `\fad`, karaoke `\k`) is not reproduced.
 */

// --- timestamps --------------------------------------------------------------

/** `h:mm:ss.fff`, `mm:ss.fff` (WebVTT), `,` or `.` before the fraction. */
const CLOCK_RE = /^(?:(\d+):)?(\d{1,2}):(\d{1,2})[.,](\d{1,3})$/

/** Seconds for one timestamp token, or null when it is not a timestamp. */
export const parseClock = (token: string): number | null => {
  const match = CLOCK_RE.exec(token.trim())
  if (!match) return null
  const [, h = '0', m, s, frac] = match
  const hh = Number(h)
  const mm = Number(m)
  const ss = Number(s)
  if (mm > 59 || ss > 59) return null
  // ".5" means 500 ms, ".05" (ASS centiseconds) 50 ms, ".050" 50 ms.
  const ms = Number(frac.padEnd(3, '0'))
  return hh * 3600 + mm * 60 + ss + ms / 1000
}

// --- shared text helpers -------------------------------------------------------

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  lrm: '',
  rlm: '',
}

const decodeEntities = (text: string): string =>
  text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body: string) => {
    if (body[0] === '#') {
      const code =
        body[1] === 'x' || body[1] === 'X'
          ? Number.parseInt(body.slice(2), 16)
          : Number.parseInt(body.slice(1), 10)
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : whole
    }
    return ENTITIES[body.toLowerCase()] ?? whole
  })

/** Trim every line and drop the empty ones. */
const tidyLines = (text: string): string =>
  text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join('\n')

/**
 * SSA (v4) numbers its alignments differently from ASS: 1–3 bottom, 5–7 top,
 * 9–11 middle. Convert to the numpad layout (`\an`) the renderer uses.
 */
const legacyAlign = (value: number): number => {
  const numpad = value >= 9 ? value - 5 : value >= 5 ? value + 2 : value
  return numpad >= 1 && numpad <= 9 ? numpad : 2
}

const validAlign = (value: number): number | undefined =>
  Number.isInteger(value) && value >= 1 && value <= 9 ? value : undefined

// --- SRT / WebVTT --------------------------------------------------------------

const TIMING_RE = /^\s*([\d:.,]+)\s*-->\s*([\d:.,]+)(.*)$/

/**
 * WebVTT cue settings → numpad alignment. `line:` picks the row (a percentage
 * of the video height, or a line number counted from the top when positive),
 * `align:` the column. Returns undefined for the default bottom-center.
 */
const vttAlign = (settings: string): number | undefined => {
  let row = 0 // 0 bottom, 1 middle, 2 top
  const line = /(?:^|\s)line:(-?\d+(?:\.\d+)?)(%?)/.exec(settings)
  if (line) {
    const value = Number(line[1])
    if (line[2] === '%') row = value < 40 ? 2 : value > 60 ? 0 : 1
    else row = value >= 0 ? 2 : 0
  }
  let column = 1 // 0 left, 1 center, 2 right
  const align = /(?:^|\s)align:([a-z]+)/.exec(settings)
  if (align) {
    if (align[1] === 'start' || align[1] === 'left') column = 0
    else if (align[1] === 'end' || align[1] === 'right') column = 2
  }
  const numpad = row * 3 + 1 + column
  return numpad === 2 ? undefined : numpad
}

/** One SRT/VTT cue body → display text plus the layout it asks for. */
const cleanPlainCue = (
  body: string
): { text: string; align?: number; italic?: boolean } => {
  let raw = body
  let align: number | undefined
  // `{\an8}` (and legacy `{\a6}`) is the de-facto way SRT asks for the top.
  raw = raw.replace(/\{\\(an|a)(\d{1,2})\}/gi, (_whole, tag: string, n) => {
    if (align === undefined) {
      align =
        tag.toLowerCase() === 'an'
          ? validAlign(Number(n))
          : legacyAlign(Number(n))
    }
    return ''
  })
  // Any other override block (`{\i1}`, `{\fs20}`) is markup, not text.
  raw = raw.replace(/\{\\[^}]*\}/g, '')
  // A cue wrapped whole in <i>…</i> is an italic line (lyrics, a voice off).
  const italic =
    /^\s*<i>[\s\S]*<\/i>\s*$/i.test(raw) && !/<\/i>[\s\S]*<i>/i.test(raw)
  raw = raw.replace(/\\N/g, '\n').replace(/\\h/g, ' ')
  // <i>, <font …>, WebVTT <c.cls>/<v Speaker>/<00:00:01.000> — all markup.
  raw = raw.replace(/<[^>\n]*>/g, '')
  const text = tidyLines(decodeEntities(raw))
  return {
    text,
    align: align === 2 ? undefined : align,
    italic: italic || undefined,
  }
}

/**
 * SRT and WebVTT share one line-based reader. A cue starts at its timing line
 * and ends at the first blank line; everything after that blank line (the next
 * cue's number, a VTT identifier, a NOTE block) is not text. Files that forget
 * the blank line between cues are common enough to handle: there the next
 * cue's bare number is the last line before its timing line, and is dropped.
 */
const parsePlain = (raw: string, vtt: boolean): SubtitleCue[] => {
  const lines = raw.split(/\r\n?|\n/)
  const cues: SubtitleCue[] = []
  let current: { start: number; end: number; settings: string } | null = null
  let body: string[] = []

  const finish = () => {
    if (!current) return
    let end = body.findIndex((line) => line.trim() === '')
    if (end < 0) {
      end = body.length
      // No blank line before the next timing line: a trailing bare number is
      // the next cue's index, not this cue's text.
      if (end > 0 && /^\s*\d+\s*$/.test(body[end - 1])) end -= 1
    }
    const cleaned = cleanPlainCue(body.slice(0, end).join('\n'))
    if (cleaned.text && current.end > current.start) {
      const cue: SubtitleCue = {
        start: current.start,
        end: current.end,
        text: cleaned.text,
      }
      const align =
        cleaned.align ?? (vtt ? vttAlign(current.settings) : undefined)
      if (align !== undefined) cue.align = align
      if (cleaned.italic) cue.italic = true
      cues.push(cue)
    }
    current = null
    body = []
  }

  for (const line of lines) {
    const timing = line.includes('-->') ? TIMING_RE.exec(line) : null
    if (timing) {
      const start = parseClock(timing[1])
      const end = parseClock(timing[2])
      if (start !== null && end !== null) {
        finish()
        current = { start, end, settings: timing[3] ?? '' }
        continue
      }
    }
    if (current) body.push(line)
  }
  finish()
  return cues
}

// --- ASS / SSA -----------------------------------------------------------------

interface AssStyle {
  size: number
  italic: boolean
  align: number
  marginV: number
}

/** Layout carried by a line's override tags (first occurrence wins). */
interface AssTags {
  align?: number
  pos?: { x: number; y: number }
  size?: number
  italic?: boolean
}

const DEFAULT_STYLE_FORMAT =
  'name,fontname,fontsize,primarycolour,secondarycolour,outlinecolour,backcolour,bold,italic,underline,strikeout,scalex,scaley,spacing,angle,borderstyle,outline,shadow,alignment,marginl,marginr,marginv,encoding'.split(
    ','
  )
const DEFAULT_EVENT_FORMAT =
  'layer,start,end,style,name,marginl,marginr,marginv,effect,text'.split(',')

/** Split `value` into `count` comma fields; the last keeps its commas. */
const splitFields = (value: string, count: number): string[] => {
  const parts: string[] = []
  let rest = value
  for (let i = 0; i < count - 1; i += 1) {
    const comma = rest.indexOf(',')
    if (comma < 0) break
    parts.push(rest.slice(0, comma))
    rest = rest.slice(comma + 1)
  }
  parts.push(rest)
  return parts
}

/** Remove `\t(…)` animations (their tags describe a LATER state), nested parens included. */
const stripAnimations = (block: string): string => {
  let out = ''
  let i = 0
  while (i < block.length) {
    if (block.startsWith('\\t(', i)) {
      let depth = 0
      let j = i + 2
      for (; j < block.length; j += 1) {
        if (block[j] === '(') depth += 1
        else if (block[j] === ')') {
          depth -= 1
          if (depth === 0) break
        }
      }
      i = j + 1
      continue
    }
    out += block[i]
    i += 1
  }
  return out
}

const numbers = (args: string): number[] =>
  args
    .split(',')
    .map((part) => Number(part.trim()))
    .filter((n) => Number.isFinite(n))

/**
 * Apply one `{…}` override block to `tags`. Returns the drawing level set by a
 * `\p` tag in it (0 = back to text), or null when the block has none.
 */
const readOverrides = (
  block: string,
  tags: AssTags,
  atLineStart: boolean
): number | null => {
  const body = stripAnimations(block)
  let drawing: number | null = null
  const tagRe =
    /\\(?:an(\d)|a(\d{1,2})|pos\(([^)]*)\)|move\(([^)]*)\)|fs(\d+(?:\.\d+)?)(?![a-z])|i([01])(?![a-z])|p(\d+)(?![a-z]))/gi
  for (const match of body.matchAll(tagRe)) {
    const [, an, a, pos, move, fs, italic, p] = match
    if (an !== undefined) tags.align ??= validAlign(Number(an))
    else if (a !== undefined) tags.align ??= legacyAlign(Number(a))
    else if (pos !== undefined || move !== undefined) {
      const [x, y] = numbers(pos ?? move ?? '')
      if (tags.pos === undefined && x !== undefined && y !== undefined) {
        tags.pos = { x, y }
      }
    } else if (fs !== undefined) tags.size ??= Number(fs)
    else if (italic !== undefined) {
      if (atLineStart) tags.italic ??= italic === '1'
    } else if (p !== undefined) drawing = Number(p)
  }
  return drawing
}

/** Dialogue text → display text + layout tags. */
const readAssText = (
  raw: string,
  wrapStyle: number
): { text: string; tags: AssTags } => {
  const tags: AssTags = {}
  let out = ''
  let drawing = false
  let i = 0
  while (i < raw.length) {
    const ch = raw[i]
    if (ch === '{') {
      const close = raw.indexOf('}', i + 1)
      if (close < 0) {
        // An unterminated brace is literal text in every renderer.
        if (!drawing) out += raw.slice(i)
        break
      }
      // Everything inside braces is an override block or a comment
      // (`{TL注：…}`); neither is shown.
      const level = readOverrides(
        raw.slice(i + 1, close),
        tags,
        out.trim() === ''
      )
      if (level !== null) drawing = level > 0
      i = close + 1
      continue
    }
    if (drawing) {
      i += 1
      continue
    }
    if (ch === '\\' && i + 1 < raw.length) {
      const next = raw[i + 1]
      if (next === 'N') {
        out += '\n'
        i += 2
        continue
      }
      if (next === 'n') {
        // A soft break only breaks with WrapStyle 2; otherwise it is a space.
        out += wrapStyle === 2 ? '\n' : ' '
        i += 2
        continue
      }
      if (next === 'h') {
        out += ' '
        i += 2
        continue
      }
    }
    out += ch
    i += 1
  }
  return { text: tidyLines(out), tags }
}

const parseAss = (raw: string): SubtitleCue[] => {
  let section = ''
  let playResX = 0
  let playResY = 0
  let wrapStyle = 0
  let styleFormat: string[] | null = null
  let eventFormat: string[] | null = null
  const styles = new Map<string, AssStyle>()
  const events: Array<{
    start: number
    end: number
    style: string
    marginV: number
    text: string
  }> = []

  for (const line of raw.split(/\r\n?|\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed[0] === ';') continue
    if (trimmed[0] === '[' && trimmed.endsWith(']')) {
      section = trimmed.slice(1, -1).trim().toLowerCase()
      continue
    }
    const colon = trimmed.indexOf(':')
    if (colon < 0) continue
    const key = trimmed.slice(0, colon).trim().toLowerCase()
    const value = trimmed.slice(colon + 1).trim()

    if (section === 'script info') {
      if (key === 'playresx') playResX = Number(value) || 0
      else if (key === 'playresy') playResY = Number(value) || 0
      else if (key === 'wrapstyle') wrapStyle = Number(value) || 0
    } else if (section === 'v4+ styles' || section === 'v4 styles') {
      if (key === 'format') {
        styleFormat = value.split(',').map((f) => f.trim().toLowerCase())
      } else if (key === 'style') {
        const format = styleFormat ?? DEFAULT_STYLE_FORMAT
        const parts = splitFields(value, format.length)
        const field = (name: string): string => {
          const index = format.indexOf(name)
          return index >= 0 ? (parts[index] ?? '').trim() : ''
        }
        const alignRaw = Number(field('alignment')) || 2
        styles.set(field('name').replace(/^\*/, ''), {
          size: Number(field('fontsize')) || 0,
          italic: field('italic') === '-1' || field('italic') === '1',
          align:
            section === 'v4 styles'
              ? legacyAlign(alignRaw)
              : (validAlign(alignRaw) ?? 2),
          marginV: Number(field('marginv')) || 0,
        })
      }
    } else if (section === 'events') {
      if (key === 'format') {
        eventFormat = value.split(',').map((f) => f.trim().toLowerCase())
      } else if (key === 'dialogue') {
        const format = eventFormat ?? DEFAULT_EVENT_FORMAT
        const parts = splitFields(value, format.length)
        const field = (name: string): string => {
          const index = format.indexOf(name)
          return index >= 0 ? (parts[index] ?? '') : ''
        }
        const start = parseClock(field('start'))
        const end = parseClock(field('end'))
        if (start === null || end === null || end <= start) continue
        events.push({
          start,
          end,
          style: field('style').trim().replace(/^\*/, ''),
          marginV: Number(field('marginv').trim()) || 0,
          text: field('text'),
        })
      }
      // `Comment:` events are notes for the typesetter, never shown.
    }
  }

  // Script coordinates default the way libass defaults them.
  if (!playResX && !playResY) {
    playResX = 384
    playResY = 288
  } else if (!playResY) {
    playResY = playResX === 1280 ? 1024 : Math.round((playResX * 3) / 4)
  } else if (!playResX) {
    playResX = playResY === 1024 ? 1280 : Math.round((playResY * 4) / 3)
  }

  const styleOf = (name: string): AssStyle | undefined =>
    styles.get(name) ??
    styles.get(name.toLowerCase()) ??
    styles.get('Default') ??
    styles.values().next().value

  // Sizes are relative to the style most dialogue uses: that one renders at
  // the player's font size, a bilingual track's smaller line scales with it.
  const usage = new Map<string, number>()
  for (const event of events) {
    usage.set(event.style, (usage.get(event.style) ?? 0) + 1)
  }
  let mainStyle = ''
  let mainCount = -1
  for (const [name, count] of usage) {
    if (count > mainCount) {
      mainStyle = name
      mainCount = count
    }
  }
  const referenceSize = styleOf(mainStyle)?.size ?? 0

  const cues: SubtitleCue[] = []
  const seen = new Set<string>()
  for (const event of events) {
    const { text, tags } = readAssText(event.text, wrapStyle)
    if (!text) continue // drawings, empty signs, comment-only lines
    const style = styleOf(event.style)
    const align = tags.align ?? style?.align ?? 2
    const pos = tags.pos
      ? { x: tags.pos.x / playResX, y: tags.pos.y / playResY }
      : undefined
    // Karaoke templates stack identical copies (fill, border, glow) of one
    // line; they would otherwise be shown three times over.
    const key = `${event.start}|${event.end}|${text}|${align}|${pos?.x},${pos?.y}`
    if (seen.has(key)) continue
    seen.add(key)

    const cue: SubtitleCue = { start: event.start, end: event.end, text }
    if (align !== 2) cue.align = align
    if (pos) cue.pos = pos
    const size = tags.size ?? style?.size ?? 0
    if (referenceSize > 0 && size > 0) {
      const scale = Math.min(3, Math.max(0.3, size / referenceSize))
      if (Math.abs(scale - 1) > 0.02) cue.scale = Math.round(scale * 100) / 100
    }
    if (tags.italic ?? style?.italic) cue.italic = true
    const marginV = event.marginV > 0 ? event.marginV : (style?.marginV ?? 0)
    if (!pos && marginV > 0) cue.marginV = marginV
    cues.push(cue)
  }
  return cues
}

const looksLikeAss = (text: string): boolean =>
  /^\s*\[(script info|v4\+? styles|events)\]/im.test(text) &&
  /^\s*dialogue\s*:/im.test(text)

/**
 * Parse a subtitle file. The extension picks the format; content sniffing
 * rescues mislabeled files. Returns cues sorted by start time (file order
 * among equal starts, which the renderer uses to stack simultaneous lines).
 */
export const parseSubtitleText = (raw: string, name: string): SubtitleCue[] => {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  // A byte-order mark survives some decoders; it is not part of the text.
  const text = raw.replace(/^\uFEFF/, '')
  if (ext === 'ass' || ext === 'ssa' || looksLikeAss(text)) {
    return sortCues(parseAss(text))
  }
  const vtt = ext === 'vtt' || /^WEBVTT/.test(text)
  return sortCues(parsePlain(text, vtt))
}

/** Stable sort by start time (the timing controller requires start order). */
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
        )}\n${cue.text}`
    )
    .join('\n\n') + (cues.length ? '\n' : '')

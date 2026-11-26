import { type CommentEntity, CommentMode } from '../canonical/comment/types.js'

export interface AssOptions {
  /** Video width resolution for ASS script (default: 1920) */
  resolutionX?: number
  /** Video height resolution for ASS script (default: 1080) */
  resolutionY?: number
  /** Font family name (default: 'Microsoft YaHei') */
  fontName?: string
  /** Font size in ASS pixels (default: 36) */
  fontSize?: number
  /** Duration for scrolling danmaku in seconds (default: 8) */
  scrollDuration?: number
  /** Duration for top/bottom fixed danmaku in seconds (default: 4) */
  fixedDuration?: number
  /** Text opacity 0-255 where 0 is opaque and 255 is transparent (default: 50) */
  opacity?: number
  /** Title shown in ASS header */
  title?: string
}

const defaultOptions: Required<AssOptions> = {
  resolutionX: 1920,
  resolutionY: 1080,
  fontName: 'Microsoft YaHei',
  fontSize: 36,
  scrollDuration: 8,
  fixedDuration: 4,
  opacity: 50,
  title: 'Danmaku Anywhere Export',
}

/**
 * Convert decimal RGB color (e.g. 16777215 = #FFFFFF) to ASS BGR color (&HBBGGRR&)
 */
const decimalToAssColor = (decimal: number): string => {
  const safe =
    Number.isFinite(decimal) && decimal >= 0
      ? Math.floor(decimal) & 0xffffff
      : 0xffffff
  const r = (safe >> 16) & 0xff
  const g = (safe >> 8) & 0xff
  const b = safe & 0xff
  const hex = (n: number) => n.toString(16).toUpperCase().padStart(2, '0')
  return `&H${hex(b)}${hex(g)}${hex(r)}&`
}

/**
 * Format time in seconds to ASS time format: H:MM:SS.CC (centiseconds 00..99).
 * Rounds total centiseconds first so values like 59.996 become `0:01:00.00`
 * rather than invalid `0:00:59.100`, and clamps negative times to `0:00:00.00`.
 */
export const formatAssTime = (seconds: number): string => {
  const clamped = Number.isFinite(seconds) ? Math.max(0, seconds) : 0
  const totalCs = Math.round(clamped * 100)
  const cs = totalCs % 100
  const totalSec = Math.floor(totalCs / 100)
  const sInt = totalSec % 60
  const totalMin = Math.floor(totalSec / 60)
  const m = totalMin % 60
  const h = Math.floor(totalMin / 60)
  return `${h}:${m.toString().padStart(2, '0')}:${sInt.toString().padStart(2, '0')}.${cs.toString().padStart(2, '0')}`
}

/**
 * Parse the `p` field of a CommentEntity into structured data.
 * Format: "time,mode,color[,uid]"
 */
const parseCommentP = (
  p: string
): { time: number; mode: number; color: number } => {
  const parts = p.split(',')
  const parsedColor = Number.parseInt(parts[2], 10)
  return {
    time: Number.parseFloat(parts[0]),
    mode: Number.parseInt(parts[1], 10),
    color: Number.isFinite(parsedColor) ? parsedColor : 16777215,
  }
}

/**
 * Escape text for ASS format: replace newlines, braces, and backslashes
 */
const escapeAssText = (text: string): string => {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/\{/g, '\\{')
    .replace(/\}/g, '\\}')
    .replace(/\r?\n/g, '\\N')
}

/**
 * Estimate rendered pixel width of a danmaku string so `\move` exits completely
 * off-screen without prematurely clipping wide comments.
 */
const estimateTextWidth = (text: string, fontSize: number): number => {
  let width = 0
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0
    width += code > 0x7f ? fontSize : fontSize * 0.6
  }
  return Math.max(fontSize, Math.ceil(width))
}

const pickRowTrack = (freeAt: number[], startTime: number): number => {
  let bestIdx = 0
  for (let i = 0; i < freeAt.length; i++) {
    if (freeAt[i] <= startTime) return i
    if (freeAt[i] < freeAt[bestIdx]) bestIdx = i
  }
  return bestIdx
}

/**
 * Convert an array of CommentEntity to ASS subtitle format string.
 */
export const commentsToAss = (
  comments: CommentEntity[],
  options?: AssOptions
): string => {
  const opts = { ...defaultOptions, ...options }
  const clampedOpacity = Math.max(0, Math.min(255, Math.round(opts.opacity)))
  const alphaHex = clampedOpacity.toString(16).toUpperCase().padStart(2, '0')

  const lines: string[] = []

  // [Script Info]
  lines.push('[Script Info]')
  lines.push(`Title: ${opts.title}`)
  lines.push('ScriptType: v4.00+')
  lines.push(`PlayResX: ${opts.resolutionX}`)
  lines.push(`PlayResY: ${opts.resolutionY}`)
  lines.push('Timer: 100.0000')
  lines.push('WrapStyle: 2')
  lines.push('ScaledBorderAndShadow: yes')
  lines.push('')

  // [V4+ Styles]
  lines.push('[V4+ Styles]')
  lines.push(
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding'
  )
  // Default style for scrolling danmaku (top-center anchor \an8 on row track)
  lines.push(
    `Style: Scroll,${opts.fontName},${opts.fontSize},&H${alphaHex}FFFFFF,&H${alphaHex}FFFFFF,&H${alphaHex}000000,&H${alphaHex}000000,-1,0,0,0,100,100,0,0,1,2,0,8,0,0,0,1`
  )
  // Top fixed style
  lines.push(
    `Style: Top,${opts.fontName},${opts.fontSize},&H${alphaHex}FFFFFF,&H${alphaHex}FFFFFF,&H${alphaHex}000000,&H${alphaHex}000000,-1,0,0,0,100,100,0,0,1,2,0,8,0,0,0,1`
  )
  // Bottom fixed style
  lines.push(
    `Style: Bottom,${opts.fontName},${opts.fontSize},&H${alphaHex}FFFFFF,&H${alphaHex}FFFFFF,&H${alphaHex}000000,&H${alphaHex}000000,-1,0,0,0,100,100,0,0,1,2,0,2,0,0,0,1`
  )
  lines.push('')

  // [Events]
  lines.push('[Events]')
  lines.push(
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text'
  )

  const marginY = 20
  const lineHeight = Math.max(24, Math.round(opts.fontSize * 1.25))
  const maxRows = Math.max(
    1,
    Math.floor((opts.resolutionY - marginY * 2) / lineHeight)
  )
  const scrollTracks = new Array<number>(maxRows).fill(Number.NEGATIVE_INFINITY)
  const topTracks = new Array<number>(maxRows).fill(Number.NEGATIVE_INFINITY)
  const bottomTracks = new Array<number>(maxRows).fill(Number.NEGATIVE_INFINITY)

  const entries = comments
    .map((comment, idx) => {
      const parsed = parseCommentP(comment.p)
      return { comment, idx, ...parsed }
    })
    .filter((item) => Number.isFinite(item.time))
    .sort((a, b) => a.time - b.time || a.idx - b.idx)

  for (const entry of entries) {
    const startSec = Math.max(0, entry.time)
    const assColor = decimalToAssColor(entry.color)
    const text = escapeAssText(entry.comment.m)
    const colorTag =
      entry.color !== 16777215 ? `{\\c${assColor}\\alpha&H${alphaHex}&}` : ''

    if (entry.mode === CommentMode.rtl || entry.mode === CommentMode.ltr) {
      const startTime = formatAssTime(startSec)
      const endSec = startSec + opts.scrollDuration
      const endTime = formatAssTime(endSec)

      const width = estimateTextWidth(entry.comment.m, opts.fontSize)
      const halfWidth = Math.ceil(width / 2) + 20
      const totalDistance = opts.resolutionX + width + 40
      const speed = totalDistance / Math.max(0.1, opts.scrollDuration)
      // Track is clear for the next comment's leading edge once this comment
      // has fully entered the screen plus a small gap.
      const occupyDuration = (width + 40) / speed

      const row = pickRowTrack(scrollTracks, startSec)
      scrollTracks[row] = startSec + occupyDuration
      const yPos = marginY + row * lineHeight

      const startX =
        entry.mode === CommentMode.rtl
          ? opts.resolutionX + halfWidth
          : -halfWidth
      const endX =
        entry.mode === CommentMode.rtl
          ? -halfWidth
          : opts.resolutionX + halfWidth

      lines.push(
        `Dialogue: 0,${startTime},${endTime},Scroll,,0,0,0,,{\\an8\\move(${startX},${yPos},${endX},${yPos})}${colorTag}${text}`
      )
    } else if (entry.mode === CommentMode.top) {
      const startTime = formatAssTime(startSec)
      const endSec = startSec + opts.fixedDuration
      const endTime = formatAssTime(endSec)
      const row = pickRowTrack(topTracks, startSec)
      topTracks[row] = endSec
      const xPos = Math.round(opts.resolutionX / 2)
      const yPos = marginY + row * lineHeight

      lines.push(
        `Dialogue: 1,${startTime},${endTime},Top,,0,0,0,,{\\an8\\pos(${xPos},${yPos})}${colorTag}${text}`
      )
    } else if (entry.mode === CommentMode.bottom) {
      const startTime = formatAssTime(startSec)
      const endSec = startSec + opts.fixedDuration
      const endTime = formatAssTime(endSec)
      const row = pickRowTrack(bottomTracks, startSec)
      bottomTracks[row] = endSec
      const xPos = Math.round(opts.resolutionX / 2)
      const yPos = opts.resolutionY - marginY - row * lineHeight

      lines.push(
        `Dialogue: 1,${startTime},${endTime},Bottom,,0,0,0,,{\\an2\\pos(${xPos},${yPos})}${colorTag}${text}`
      )
    }
  }

  return lines.join('\n')
}

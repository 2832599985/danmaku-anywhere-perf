import type { CommentEntity } from '../canonical/comment/types.js'
import { CommentMode } from '../canonical/comment/types.js'

export interface AssOptions {
  title?: string
  /** Video width for positioning calculations */
  resolutionX?: number
  /** Video height for positioning calculations */
  resolutionY?: number
  /** Default font name */
  fontName?: string
  /** Default font size */
  fontSize?: number
  /** Duration in seconds for scrolling danmaku */
  scrollDuration?: number
  /** Duration in seconds for fixed (top/bottom) danmaku */
  fixedDuration?: number
  /** Opacity from 0-255 (ASS alpha: 0=opaque, FF=transparent) */
  opacity?: number
}

const defaultOptions: Required<AssOptions> = {
  title: 'Danmaku Anywhere Export',
  resolutionX: 1920,
  resolutionY: 1080,
  fontName: 'Arial',
  fontSize: 40,
  scrollDuration: 8,
  fixedDuration: 4,
  opacity: 0,
}

/**
 * Convert decimal RGB color to ASS &HBBGGRR& format
 */
const decimalToAssColor = (decimal: number): string => {
  const r = (decimal >> 16) & 0xff
  const g = (decimal >> 8) & 0xff
  const b = decimal & 0xff
  const hex = (n: number) => n.toString(16).toUpperCase().padStart(2, '0')
  return `&H${hex(b)}${hex(g)}${hex(r)}&`
}

/**
 * Format time in seconds to ASS time format: H:MM:SS.CC (centiseconds)
 */
const formatAssTime = (seconds: number): string => {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  const sInt = Math.floor(s)
  const cs = Math.round((s - sInt) * 100)
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
  return {
    time: Number.parseFloat(parts[0]),
    mode: Number.parseInt(parts[1], 10),
    color: Number.parseInt(parts[2], 10),
  }
}

/**
 * Escape text for ASS format: replace newlines and backslashes
 */
const escapeAssText = (text: string): string => {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/\{/g, '\\{')
    .replace(/\}/g, '\\}')
    .replace(/\r?\n/g, '\\N')
}

/**
 * Convert an array of CommentEntity to ASS subtitle format string.
 */
export const commentsToAss = (
  comments: CommentEntity[],
  options?: AssOptions
): string => {
  const opts = { ...defaultOptions, ...options }
  const alphaHex = opts.opacity.toString(16).toUpperCase().padStart(2, '0')

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
  // Default style for scrolling danmaku (rtl)
  lines.push(
    `Style: Scroll,${opts.fontName},${opts.fontSize},&H${alphaHex}FFFFFF,&H${alphaHex}FFFFFF,&H${alphaHex}000000,&H${alphaHex}000000,-1,0,0,0,100,100,0,0,1,2,0,2,0,0,0,1`
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

  for (const comment of comments) {
    const { time, mode, color } = parseCommentP(comment.p)
    if (Number.isNaN(time)) continue

    const assColor = decimalToAssColor(color)
    const text = escapeAssText(comment.m)
    const colorTag =
      color !== 16777215 ? `{\\c${assColor}\\alpha&H${alphaHex}&}` : ''

    if (mode === CommentMode.rtl || mode === CommentMode.ltr) {
      // Scrolling danmaku
      const startTime = formatAssTime(time)
      const endTime = formatAssTime(time + opts.scrollDuration)

      // Use \move for scrolling: from right edge to left edge
      const startX = mode === CommentMode.rtl ? opts.resolutionX + 200 : -200
      const endX = mode === CommentMode.rtl ? -200 : opts.resolutionX + 200

      // Random Y position seeded by comment content hash to keep deterministic
      const yHash = simpleHash(comment.m + comment.p)
      const yPos = 20 + (yHash % (opts.resolutionY - 60))

      lines.push(
        `Dialogue: 0,${startTime},${endTime},Scroll,,0,0,0,,{\\move(${startX},${yPos},${endX},${yPos})}${colorTag}${text}`
      )
    } else if (mode === CommentMode.top) {
      // Top fixed danmaku
      const startTime = formatAssTime(time)
      const endTime = formatAssTime(time + opts.fixedDuration)
      const xPos = Math.round(opts.resolutionX / 2)
      const yPos = 20

      lines.push(
        `Dialogue: 1,${startTime},${endTime},Top,,0,0,0,,{\\an8\\pos(${xPos},${yPos})}${colorTag}${text}`
      )
    } else if (mode === CommentMode.bottom) {
      // Bottom fixed danmaku
      const startTime = formatAssTime(time)
      const endTime = formatAssTime(time + opts.fixedDuration)
      const xPos = Math.round(opts.resolutionX / 2)
      const yPos = opts.resolutionY - 20

      lines.push(
        `Dialogue: 1,${startTime},${endTime},Bottom,,0,0,0,,{\\an2\\pos(${xPos},${yPos})}${colorTag}${text}`
      )
    }
  }

  return lines.join('\n')
}

/**
 * Simple string hash for deterministic Y positioning
 */
const simpleHash = (str: string): number => {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = ((hash << 5) - hash + char) | 0
  }
  return Math.abs(hash)
}

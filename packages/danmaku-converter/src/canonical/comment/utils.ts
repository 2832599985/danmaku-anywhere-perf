import { hexToRgb888, rgb888ToHex } from '../../utils/index.js'
import type { CommentOptions } from './types.js'
import { CommentMode } from './types.js'

export const parseCommentGradient = (s: string) => {
  const [gr, flag] = s.split(',')
  const [start, end] = gr.split('~')
  const startHex = rgb888ToHex(Number.parseInt(start, 10))
  const endHex = rgb888ToHex(Number.parseInt(end, 10))

  return {
    start: startHex,
    end: endHex,
    stroke: flag === '0',
  }
}

// convert string to object
export const parseCommentEntityTime = (p: string): number => {
  const comma = p.indexOf(',')
  if (comma === -1) return Number.NaN
  return Number.parseFloat(p.slice(0, comma))
}

export const parseCommentEntityP = (p: string): CommentOptions => {
  const first = p.indexOf(',')
  if (first === -1) {
    throw new Error(`Invalid comment options: ${p}`)
  }
  const second = p.indexOf(',', first + 1)
  if (second === -1) {
    throw new Error(`Invalid comment options: ${p}`)
  }
  const third = p.indexOf(',', second + 1)

  const timeStr = p.slice(0, first)
  const modeStr = p.slice(first + 1, second)
  const colorStr =
    third === -1 ? p.slice(second + 1) : p.slice(second + 1, third)
  const uid = third === -1 ? '' : p.slice(third + 1)

  const mode = Number.parseInt(modeStr, 10)
  if (!CommentMode[mode]) {
    throw new Error(`Invalid mode: ${modeStr}`)
  }

  return {
    time: Number.parseFloat(timeStr),
    mode: CommentMode[mode] as keyof typeof CommentMode,
    color: rgb888ToHex(Number.parseInt(colorStr, 10)),
    uid, // uid may include string
  }
}

export const commentOptionsToString = (
  commentOptions: CommentOptions
): string => {
  const { time, mode, color, uid } = commentOptions

  let p = `${time.toFixed(2)},${CommentMode[mode]},${hexToRgb888(color)}`

  if (uid) {
    p += `,${uid}`
  }

  return p
}

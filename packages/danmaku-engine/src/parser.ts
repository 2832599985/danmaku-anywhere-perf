import {
  type CommentEntity,
  parseCommentEntityP,
  parseCommentGradient,
} from '@danmaku-anywhere/danmaku-converter'

import type {
  DanmakuColorFilter,
  DanmakuFilter,
  DanmakuModeFilter,
} from './options'

// copied from danmaku
export interface ParsedComment {
  text: string
  /**
   * @default rtl
   */
  mode: 'ltr' | 'rtl' | 'top' | 'bottom'
  /**
   * Specified in seconds. Not required in live mode.
   * @default media?.currentTime
   */
  time: number
  style: Record<string, string>
  color: string
  gradient?: {
    start: string
    end: string
    stroke: boolean
  }
}

export interface TimedComment {
  time: number
  raw: CommentEntity
  parsed?: ParsedComment
  /**
   * Set when parsing fails (invalid `p`, unsupported mode, etc). We skip these
   * entries at emit-time to avoid breaking the whole timeline.
   */
  parseError?: true
}

export interface DanmakuOption {
  /**
   * The stage to display comments will be appended to container.
   */
  container: HTMLElement
  /**
   * If it's not provided, Danmaku will be in live mode.
   */
  media?: HTMLMediaElement
  /**
   * Preset comments, used in media mode
   */
  comments?: ParsedComment[]
  /**
   * Canvas engine may more efficient than DOM however it costs more memory.
   * @default dom
   */
  // engine?: 'dom' | 'canvas'
  /**
   * The speed of comments in `ltr` and `rtl` mode.
   */
  speed?: number
}

const EMPTY_STYLE: Record<string, string> = Object.freeze(
  {} as Record<string, string>
)

export const transformComment = (
  comment: CommentEntity,
  offset: number
): ParsedComment => {
  const { p, m, s } = comment
  const { time, mode, color } = parseCommentEntityP(p)
  const offsetTime = time + offset / 1000

  const parsed: ParsedComment = {
    text: m,
    mode,
    time: offsetTime,
    style: EMPTY_STYLE,
    color,
  }

  if (s) {
    try {
      const { start, end, stroke } = parseCommentGradient(s)
      parsed.gradient = { start, end, stroke }
    } catch {
      // ignore errors
    }
  }

  return parsed
}

const regexCache = new Map<string, { regex: RegExp | null; lastUsed: number }>()

const REGEX_CACHE_TTL_MS = 5 * 60 * 1000

let lastCacheCleanup = Date.now()

const cleanRegexCache = () => {
  const now = Date.now()
  if (now - lastCacheCleanup < REGEX_CACHE_TTL_MS) return
  lastCacheCleanup = now
  for (const [key, entry] of regexCache) {
    if (now - entry.lastUsed > REGEX_CACHE_TTL_MS) {
      regexCache.delete(key)
    }
  }
}

// returns true if the comment should be filtered out
export const applyFilter = (comment: string, filters: DanmakuFilter[]) => {
  cleanRegexCache()
  return filters.some(({ type, value, enabled }) => {
    if (!enabled) return false

    switch (type) {
      case 'text':
        return comment.includes(value)
      case 'regex': {
        const now = Date.now()
        let entry = regexCache.get(value)
        if (!entry) {
          try {
            entry = { regex: new RegExp(value), lastUsed: now }
          } catch {
            entry = { regex: null, lastUsed: now }
          }
          regexCache.set(value, entry)
        } else {
          entry.lastUsed = now
        }
        if (!entry.regex) return false
        return entry.regex.test(comment)
      }
    }
  })
}

const WHITE_COLOR = '#ffffff'

export const applyModeFilter = (
  mode: ParsedComment['mode'],
  modeFilter: DanmakuModeFilter
): boolean => {
  return !modeFilter[mode]
}

export const applyColorFilter = (
  color: string,
  colorFilter: DanmakuColorFilter
): boolean => {
  if (!colorFilter.enabled) return false
  if (colorFilter.onlyWhite && color.toLowerCase() !== WHITE_COLOR) return true
  if (colorFilter.blacklist.length > 0) {
    const lowerColor = color.toLowerCase()
    return colorFilter.blacklist.some((c) => c.toLowerCase() === lowerColor)
  }
  return false
}

export const filterComments = (
  comments: CommentEntity[],
  filters: DanmakuFilter[]
) => {
  return comments.filter((comment) => {
    return !applyFilter(comment.m, filters)
  })
}

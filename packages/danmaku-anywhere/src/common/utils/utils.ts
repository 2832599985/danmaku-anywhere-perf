import type { PopoverVirtualElement } from '@mui/material'
import JSZip from 'jszip'
import * as OpenCC from 'opencc-js'
import { match as matchPinyin } from 'pinyin-pro'

export const toArray = <T>(value: T | T[]): T[] => {
  return Array.isArray(value) ? value : [value]
}

export const validateOrigin = async (origin: string) => {
  try {
    if (!chrome || !chrome.permissions) {
      return
    }
    await chrome.permissions.contains({
      origins: [origin],
    })
  } catch (e: unknown) {
    if (e instanceof Error) {
      return e.message
    }
    return 'invalid pattern'
  }
}

export function invariant(
  condition: boolean,
  message: string
): asserts condition {
  if (!condition) {
    throw new Error(message)
  }
}

export const isServiceWorker = () => {
  // getBackgroundPage is not available in service worker, also not available in Firefox
  if (import.meta.env.DEV) {
    return chrome.runtime.getBackgroundPage === undefined
  }
  return true
}

export const sleep = async (ms: number) => {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export const sanitizeFilename = (filename: string) => {
  return filename.replace(/[<>:"\/|?*]+/g, '_')
}

// TODO: replace with wicg-file-system-access when it's available in Firefox
export const createDownload = (data: Blob, filename?: string) => {
  const url = URL.createObjectURL(data)

  const dateString = new Date().toISOString().split('T')[0]

  const defaultFileName = `export-${dateString}.json`

  const link = document.createElement('a')
  link.href = url
  link.download = sanitizeFilename(filename ?? defaultFileName)

  document.body.appendChild(link)

  link.click()

  return new Promise<void>((resolve) => {
    setTimeout(() => {
      document.body.removeChild(link)
      URL.revokeObjectURL(url)
      resolve()
    }, 100)
  })
}

export const downloadZip = async (
  fileName: string,
  files: {
    name: string
    data: Blob | string
  }[]
) => {
  const zip = new JSZip()

  files.forEach((file) => {
    zip.file(file.name, file.data)
  })

  const zipBlob = await zip.generateAsync({ type: 'blob' })
  await createDownload(zipBlob, `${fileName}.zip`)
}

export const createVirtualElement = (
  x: number,
  y: number
): PopoverVirtualElement => {
  return {
    getBoundingClientRect: () => ({
      width: 0,
      height: 0,
      x,
      y,
      top: y,
      right: x,
      bottom: y,
      left: x,
      toJSON: () => ({}),
    }),
    nodeType: Node.ELEMENT_NODE,
  }
}

export const matchWithPinyin = (inputString: string, searchString: string) => {
  const lowerCaseInputString = inputString.toLocaleLowerCase()
  const lowerCaseSearchString = searchString.toLocaleLowerCase()

  // string search
  if (lowerCaseInputString.includes(lowerCaseSearchString)) return true

  // pinyin match
  const pinyinMatches = matchPinyin(lowerCaseInputString, lowerCaseSearchString)
  return !!pinyinMatches
}

function fallbackGenerateUUID(): string {
  const template = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'
  return template.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

export const getRandomUUID = () => {
  try {
    return globalThis.crypto.randomUUID()
  } catch {
    // fallback to Math.random if crypto.randomUUID is not available
    return fallbackGenerateUUID()
  }
}

export const getElementByXpath = (path: string, parent = window.document) => {
  try {
    return document.evaluate(
      path,
      parent,
      null,
      XPathResult.FIRST_ORDERED_NODE_TYPE,
      null
    ).singleNodeValue
  } catch {
    return null
  }
}

export const docsLink = (path: string) => {
  return `https://docs.danmaku.weeblify.app/${path}`
}

export const getOS = () => {
  const { userAgent } = navigator
  if (userAgent.includes('Windows')) return 'Windows'
  if (userAgent.includes('Mac OS')) return 'MacOS'
  if (userAgent.includes('Linux')) return 'Linux'
  return 'Unknown'
}

export const properCase = (str: string) => {
  return str.charAt(0).toUpperCase() + str.slice(1)
}

const twToCn = OpenCC.Converter({ from: 'tw', to: 'cn' })
const hkToCn = OpenCC.Converter({ from: 'hk', to: 'cn' })

export const toSimplified = (str: string) => {
  return twToCn(hkToCn(str))
}

export const zip = <T, K, R>(
  a: T[],
  b: K[],
  combinator: (a: T, b: K) => R
): R[] => {
  if (a.length !== b.length) {
    throw new Error('cannot zip 2 arrays of different sizes')
  }

  return a.map((item, i) => {
    return combinator(item, b[i])
  })
}

export const concatArr = <T>(a: T[], b: T[]): T[] => {
  for (const item of b) {
    a.push(item)
  }
  return a
}

/**
 * Build a stable dedup key for a comment.
 * Prefer `cid` when available, fallback to `p+m` composite key.
 */
export const commentKey = (comment: {
  cid?: number
  p: string
  m: string
}): string => {
  return comment.cid !== undefined
    ? `cid:${comment.cid}`
    : `pt:${comment.p}|${comment.m}`
}

/**
 * 弹幕去重：优先使用 cid，fallback 到 content+time 组合
 */
export const dedupeComments = <
  T extends { cid?: number; p: string; m: string },
>(
  comments: T[]
): T[] => {
  const seen = new Set<string>()
  return comments.filter((comment) => {
    const key = commentKey(comment)

    if (seen.has(key)) {
      return false
    }
    seen.add(key)
    return true
  })
}

/**
 * Merge new comments into an existing array, deduplicating using `p+m` composite key.
 * Returns a new array containing all unique comments from both sources.
 */
export const mergeComments = <T extends { cid?: number; p: string; m: string }>(
  existing: T[],
  incoming: T[]
): T[] => {
  const seen = new Set<string>()
  const result: T[] = []

  for (const comment of existing) {
    const key = commentKey(comment)
    if (!seen.has(key)) {
      seen.add(key)
      result.push(comment)
    }
  }

  for (const comment of incoming) {
    const key = commentKey(comment)
    if (!seen.has(key)) {
      seen.add(key)
      result.push(comment)
    }
  }

  return result
}

/**
 * Extract the time value from a comment's `p` field.
 * The `p` field is formatted as `time,mode,color[,uid]`.
 */
const extractTime = (p: string): number => {
  const comma = p.indexOf(',')
  if (comma === -1) return Number.NaN
  return Number.parseFloat(p.slice(0, comma))
}

/**
 * Fuzzy deduplication for multi-source danmaku merge.
 * Two comments are considered duplicates if:
 * 1. Their text (`m`) is exactly the same, AND
 * 2. Their time values are within `timeTolerance` seconds of each other.
 *
 * This is a pure function suitable for unit testing.
 * Time complexity: O(n * m) where n = existing, m = incoming, but in practice
 * the inner loop is bounded by the number of comments with the same text.
 */
export const fuzzyDedupeComments = <
  T extends { cid?: number; p: string; m: string },
>(
  existing: T[],
  incoming: T[],
  timeTolerance = 1
): T[] => {
  // First do exact dedup
  const seen = new Set<string>()
  const result: T[] = []

  for (const comment of existing) {
    const key = commentKey(comment)
    if (!seen.has(key)) {
      seen.add(key)
      result.push(comment)
    }
  }

  // Group existing comments by text for fuzzy matching
  const existingByText = new Map<string, number[]>()
  for (const comment of result) {
    const time = extractTime(comment.p)
    if (!existingByText.has(comment.m)) {
      existingByText.set(comment.m, [])
    }
    existingByText.get(comment.m)?.push(time)
  }

  for (const comment of incoming) {
    const key = commentKey(comment)
    // Exact match dedup
    if (seen.has(key)) {
      continue
    }

    // Fuzzy time match: same text within timeTolerance seconds
    const existingTimes = existingByText.get(comment.m)
    if (existingTimes) {
      const incomingTime = extractTime(comment.p)
      const isFuzzyDuplicate = existingTimes.some(
        (t) => Math.abs(t - incomingTime) < timeTolerance
      )
      if (isFuzzyDuplicate) {
        continue
      }
    }

    seen.add(key)
    result.push(comment)

    // Track for subsequent fuzzy checks
    const time = extractTime(comment.p)
    if (!existingByText.has(comment.m)) {
      existingByText.set(comment.m, [])
    }
    existingByText.get(comment.m)?.push(time)
  }

  return result
}

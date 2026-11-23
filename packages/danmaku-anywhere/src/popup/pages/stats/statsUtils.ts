import type { CommentEntity } from '@danmaku-anywhere/danmaku-converter'
import { parseCommentEntityTime } from '@danmaku-anywhere/danmaku-converter'

export interface TypeDistribution {
  rtl: number
  top: number
  bottom: number
  ltr: number
}

export interface KeywordEntry {
  word: string
  count: number
}

export interface DensityBin {
  time: number
  value: number
  count: number
}

export interface StatsData {
  totalComments: number
  seasonCount: number
  episodeCount: number
  typeDistribution: TypeDistribution
  topKeywords: KeywordEntry[]
  densityBins: DensityBin[]
  avgLength: number
  peakTime: string
}

/**
 * Parse mode from CommentEntity.p field.
 * Format: "time,mode,color[,uid]"
 * Mode enum: 1=rtl, 4=bottom, 5=top, 6=ltr
 */
function parseMode(p: string): number {
  const first = p.indexOf(',')
  if (first === -1) return 1
  const second = p.indexOf(',', first + 1)
  if (second === -1) return 1
  return Number.parseInt(p.slice(first + 1, second), 10)
}

export function computeTypeDistribution(
  comments: CommentEntity[]
): TypeDistribution {
  const dist: TypeDistribution = { rtl: 0, top: 0, bottom: 0, ltr: 0 }
  for (const c of comments) {
    const mode = parseMode(c.p)
    switch (mode) {
      case 1:
        dist.rtl++
        break
      case 4:
        dist.bottom++
        break
      case 5:
        dist.top++
        break
      case 6:
        dist.ltr++
        break
      default:
        dist.rtl++
    }
  }
  return dist
}

/**
 * Compute top N keywords from comments.
 * Chinese: 2-gram character extraction
 * English: space-separated words
 */
export function computeTopKeywords(
  comments: CommentEntity[],
  topN = 10
): KeywordEntry[] {
  const freq = new Map<string, number>()

  for (const c of comments) {
    const text = c.m.trim()
    if (!text) continue

    // Check if the text contains CJK characters
    const hasCJK = /[\u4e00-\u9fff\u3400-\u4dbf]/.test(text)

    if (hasCJK) {
      // Chinese: extract 2-grams
      for (let i = 0; i < text.length - 1; i++) {
        const ch1 = text[i]
        const ch2 = text[i + 1]
        // Skip if either character is a space or punctuation
        if (/[\s\p{P}]/u.test(ch1) || /[\s\p{P}]/u.test(ch2)) {
          continue
        }
        const gram = ch1 + ch2
        freq.set(gram, (freq.get(gram) ?? 0) + 1)
      }
    } else {
      // English/other: space-separated words
      const words = text
        .toLowerCase()
        .split(/\s+/)
        .filter((w) => w.length > 1)
      for (const w of words) {
        // Remove leading/trailing punctuation
        const clean = w.replace(/^[\p{P}]+|[\p{P}]+$/gu, '')
        if (clean.length > 1) {
          freq.set(clean, (freq.get(clean) ?? 0) + 1)
        }
      }
    }
  }

  return Array.from(freq.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([word, count]) => ({ word, count }))
}

/**
 * Compute density bins for all comments combined.
 * Uses a fixed bin size of 10 seconds, treating all comments
 * as if from one continuous timeline.
 */
export function computeGlobalDensityBins(
  comments: CommentEntity[],
  binSizeSec = 10
): DensityBin[] {
  if (comments.length === 0) return []

  // Find max time to determine duration
  let maxTime = 0
  for (const c of comments) {
    const t = parseCommentEntityTime(c.p)
    if (Number.isFinite(t) && t > maxTime) {
      maxTime = t
    }
  }

  if (maxTime <= 0) return []

  const duration = maxTime
  const binSize = Math.max(1, binSizeSec)
  const binCount = Math.max(1, Math.ceil(duration / binSize))
  const counts = new Array<number>(binCount).fill(0)

  for (const c of comments) {
    const t = parseCommentEntityTime(c.p)
    if (!Number.isFinite(t) || t < 0 || t > duration) {
      continue
    }
    const idx = Math.min(binCount - 1, Math.floor(t / binSize))
    counts[idx] += 1
  }

  const maxCount = counts.reduce((m, v) => (v > m ? v : m), 0) || 1

  return counts.map((cnt, i) => {
    const time = Math.min(duration, i * binSize + binSize / 2)
    const value = cnt / maxCount
    return { time, value, count: cnt }
  })
}

export function computeAvgLength(comments: CommentEntity[]): number {
  if (comments.length === 0) return 0
  let total = 0
  for (const c of comments) {
    total += c.m.length
  }
  return total / comments.length
}

export function computePeakTime(densityBins: DensityBin[]): string {
  if (densityBins.length === 0) return '--'
  let maxIdx = 0
  for (let i = 1; i < densityBins.length; i++) {
    if (densityBins[i].count > densityBins[maxIdx].count) {
      maxIdx = i
    }
  }
  const seconds = Math.floor(densityBins[maxIdx].time)
  const min = Math.floor(seconds / 60)
  const sec = seconds % 60
  return `${min}:${sec.toString().padStart(2, '0')}`
}

import type { CommentEntity } from '@danmaku-anywhere/danmaku-converter'
import { parseCommentEntityP } from '@danmaku-anywhere/danmaku-converter'

export interface DanmakuStats {
  totalCount: number
  avgLength: number
  /** Sorted density buckets (bucketStartSec -> count), 30s intervals */
  densityBuckets: { time: number; count: number }[]
  /** Peak density bucket */
  peakDensity: { time: number; count: number } | null
  /** Type distribution: mode label -> count */
  typeDistribution: { mode: string; count: number }[]
  /** Top keywords sorted by frequency descending */
  topKeywords: { word: string; count: number }[]
}

const MODE_LABELS: Record<string, string> = {
  rtl: 'RTL',
  ltr: 'LTR',
  top: 'Top',
  bottom: 'Bottom',
}

/** Minimum word length to consider as a keyword */
const MIN_WORD_LENGTH = 2

/** Bucket size in seconds for density calculation */
const BUCKET_SIZE = 30

/**
 * Common stop words that should be excluded from keyword analysis.
 * Covers Chinese particles, English common words, and single characters.
 */
const STOP_WORDS = new Set([
  // Chinese
  '的',
  '了',
  '是',
  '在',
  '我',
  '有',
  '和',
  '就',
  '不',
  '人',
  '都',
  '一',
  '一个',
  '上',
  '也',
  '很',
  '到',
  '说',
  '要',
  '去',
  '你',
  '会',
  '着',
  '没有',
  '看',
  '好',
  '自己',
  '这',
  '他',
  '她',
  '它',
  '吗',
  '吧',
  '啊',
  '呢',
  '哈',
  '嗯',
  '哦',
  '呀',
  '啦',
  '嘛',
  '么',
  '哈哈',
  '哈哈哈',
  '这个',
  '那个',
  '什么',
  '怎么',
  '可以',
  '没有',
  '知道',
  '还是',
  '已经',
  '所以',
  '因为',
  '但是',
  '如果',
  '真的',
  // English
  'the',
  'be',
  'to',
  'of',
  'and',
  'a',
  'in',
  'that',
  'have',
  'i',
  'it',
  'for',
  'not',
  'on',
  'with',
  'he',
  'as',
  'you',
  'do',
  'at',
  'this',
  'but',
  'his',
  'by',
  'from',
  'they',
  'we',
  'her',
  'she',
  'or',
  'an',
  'my',
  'is',
  'was',
  'are',
  'so',
  'if',
  'no',
  'lol',
  'www',
])

/**
 * Simple word segmentation that handles both CJK and Latin text.
 * For CJK: extracts bigrams (2-char sequences).
 * For Latin: splits on whitespace/punctuation.
 */
function extractWords(text: string): string[] {
  const words: string[] = []

  // Extract Latin words
  const latinMatches = text.match(/[a-zA-Z]+/g)
  if (latinMatches) {
    for (const word of latinMatches) {
      const lower = word.toLowerCase()
      if (lower.length >= MIN_WORD_LENGTH && !STOP_WORDS.has(lower)) {
        words.push(lower)
      }
    }
  }

  // Extract CJK bigrams
  const cjkChars = text.replace(/[^\u4e00-\u9fff\u3400-\u4dbf]/g, '')
  for (let i = 0; i < cjkChars.length - 1; i++) {
    const bigram = cjkChars.slice(i, i + 2)
    if (!STOP_WORDS.has(bigram)) {
      words.push(bigram)
    }
  }

  return words
}

export function computeStats(comments: CommentEntity[]): DanmakuStats {
  if (comments.length === 0) {
    return {
      totalCount: 0,
      avgLength: 0,
      densityBuckets: [],
      peakDensity: null,
      typeDistribution: [],
      topKeywords: [],
    }
  }

  // --- Average length ---
  let totalLength = 0
  for (const c of comments) {
    totalLength += c.m.length
  }
  const avgLength = totalLength / comments.length

  // --- Type distribution & density ---
  const modeCounts = new Map<string, number>()
  const bucketMap = new Map<number, number>()

  for (const c of comments) {
    try {
      const parsed = parseCommentEntityP(c.p)

      // Mode distribution
      const label = MODE_LABELS[parsed.mode] ?? parsed.mode
      modeCounts.set(label, (modeCounts.get(label) ?? 0) + 1)

      // Density buckets
      const bucket = Math.floor(parsed.time / BUCKET_SIZE) * BUCKET_SIZE
      bucketMap.set(bucket, (bucketMap.get(bucket) ?? 0) + 1)
    } catch {
      // Skip malformed entries
    }
  }

  // Sort density buckets by time
  const densityBuckets = Array.from(bucketMap.entries())
    .map(([time, count]) => ({ time, count }))
    .sort((a, b) => a.time - b.time)

  // Peak density
  let peakDensity: { time: number; count: number } | null = null
  for (const bucket of densityBuckets) {
    if (!peakDensity || bucket.count > peakDensity.count) {
      peakDensity = bucket
    }
  }

  // Sort type distribution by count descending
  const typeDistribution = Array.from(modeCounts.entries())
    .map(([mode, count]) => ({ mode, count }))
    .sort((a, b) => b.count - a.count)

  // --- Top keywords ---
  const wordFreq = new Map<string, number>()
  for (const c of comments) {
    const words = extractWords(c.m)
    for (const word of words) {
      wordFreq.set(word, (wordFreq.get(word) ?? 0) + 1)
    }
  }

  const topKeywords = Array.from(wordFreq.entries())
    .map(([word, count]) => ({ word, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 15)

  return {
    totalCount: comments.length,
    avgLength: Math.round(avgLength * 10) / 10,
    densityBuckets,
    peakDensity,
    typeDistribution,
    topKeywords,
  }
}

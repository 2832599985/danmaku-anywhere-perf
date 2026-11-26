import { chineseToNumber } from './chineseToNumber.js'

export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[\s\u3000]+/g, '') // Remove spaces (including fullwidth)
    .replace(/[^\w\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff]/g, '') // Keep alphanumeric and CJK only
}

const seasonPatterns: {
  pattern: RegExp
  extract: (m: RegExpMatchArray) => number
}[] = [
  // Chinese: 第一季/第二期, ..., 第十部
  {
    pattern: /第([一二三四五六七八九十百千]+)[季期部]/,
    extract: (m) => chineseToNumber(m[1]) ?? 0,
  },
  // Chinese: 第1季 / 第2期 / 第3部
  { pattern: /第(\d+)[季期部]/, extract: (m) => Number.parseInt(m[1], 10) },
  // English: Season 3, season 3
  { pattern: /season\s*(\d+)/i, extract: (m) => Number.parseInt(m[1], 10) },
  // English: 2nd Season, 3rd season
  {
    pattern: /(\d+)(?:st|nd|rd|th)\s*season/i,
    extract: (m) => Number.parseInt(m[1], 10),
  },
  // English: Part 2
  { pattern: /\bpart\s*(\d+)/i, extract: (m) => Number.parseInt(m[1], 10) },
  // Short: S3, S03
  { pattern: /\bS(\d+)\b/i, extract: (m) => Number.parseInt(m[1], 10) },
  // Roman numerals: II, III, IV (at word boundary or end)
  {
    pattern: /\b(II|III|IV|V|VI|VII|VIII|IX|X)\b/,
    extract: (m) => romanToNumber(m[1]),
  },
]

const romanMap: Record<string, number> = {
  I: 1,
  II: 2,
  III: 3,
  IV: 4,
  V: 5,
  VI: 6,
  VII: 7,
  VIII: 8,
  IX: 9,
  X: 10,
}

function romanToNumber(str: string): number {
  return romanMap[str] ?? 0
}

export function extractSeasonHint(text: string): number | null {
  for (const { pattern, extract } of seasonPatterns) {
    const match = text.match(pattern)
    if (match) {
      const num = extract(match)
      if (num > 0) return num
    }
  }
  return null
}

export function findBestMatchingSeason<T extends { title: string }>(
  seasons: T[],
  keyword: string,
  seasonHint?: number | null
): T | null {
  const normalizedKeyword = normalizeTitle(keyword)

  // 1. Exact match
  const exact = seasons.find(
    (s) => normalizeTitle(s.title) === normalizedKeyword
  )
  if (exact) return exact

  // 2. Contains match — pick shortest title (closest to keyword)
  const containing = seasons
    .filter((s) => normalizeTitle(s.title).includes(normalizedKeyword))
    .sort((a, b) => a.title.length - b.title.length)

  // 2a. If we have a season hint, prefer seasons whose title contains a matching season number
  if (seasonHint && seasonHint > 0 && containing.length > 1) {
    const hintMatched = containing.filter((s) => {
      const seasonNum = extractSeasonHint(s.title)
      return seasonNum === seasonHint
    })
    if (hintMatched.length > 0) return hintMatched[0]
  }

  if (containing.length > 0) return containing[0]

  // 3. When `keyword` itself carries a season marker (e.g. "咒术回战 第二季")
  // while provider titles spell the season differently ("第2季" / "Season 2")
  // or insert an arc subtitle ("咒术回战 怀玉·玉折 第二季"), match the stripped
  // base title together with the season number.
  const effectiveHint = seasonHint ?? extractSeasonHint(keyword)
  if (effectiveHint && effectiveHint > 0) {
    let stripped = keyword
    for (const { pattern } of seasonPatterns) {
      stripped = stripped.replace(pattern, '')
    }
    const normalizedBase = normalizeTitle(stripped)
    if (normalizedBase.length > 0 && normalizedBase !== normalizedKeyword) {
      const baseMatched = seasons
        .filter(
          (s) =>
            normalizeTitle(s.title).includes(normalizedBase) &&
            extractSeasonHint(s.title) === effectiveHint
        )
        .sort((a, b) => a.title.length - b.title.length)
      if (baseMatched.length > 0) return baseMatched[0]
    }
  }

  return null
}

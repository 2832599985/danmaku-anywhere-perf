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
  // Chinese: 第一季, 第二季, ..., 第十季
  {
    pattern: /第([一二三四五六七八九十百千]+)季/,
    extract: (m) => chineseToNumber(m[1]),
  },
  // Chinese: 第1季, 第2季
  { pattern: /第(\d+)季/, extract: (m) => Number.parseInt(m[1], 10) },
  // English: Season 3, season 3
  { pattern: /season\s*(\d+)/i, extract: (m) => Number.parseInt(m[1], 10) },
  // Short: S3, S03
  { pattern: /\bS(\d+)\b/i, extract: (m) => Number.parseInt(m[1], 10) },
  // Roman numerals: II, III, IV (at word boundary or end)
  {
    pattern: /\b(II|III|IV|V|VI|VII|VIII|IX|X)\b/,
    extract: (m) => romanToNumber(m[1]),
  },
]

const chineseNumberMap: Record<string, number> = {
  一: 1,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
  十: 10,
}

function chineseToNumber(str: string): number {
  if (str.length === 1) return chineseNumberMap[str] ?? 0
  // Handle 十一 = 11, 二十 = 20, 二十三 = 23
  let result = 0
  if (str.startsWith('十')) {
    result = 10 + (chineseNumberMap[str[1]] ?? 0)
  } else if (str.includes('十')) {
    const parts = str.split('十')
    result =
      (chineseNumberMap[parts[0]] ?? 0) * 10 + (chineseNumberMap[parts[1]] ?? 0)
  } else {
    result = chineseNumberMap[str] ?? 0
  }
  return result
}

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

  return null
}

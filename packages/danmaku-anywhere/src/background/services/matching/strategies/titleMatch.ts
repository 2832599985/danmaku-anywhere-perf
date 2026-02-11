export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[\s\u3000]+/g, '') // Remove spaces (including fullwidth)
    .replace(/[^\w\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff]/g, '') // Keep alphanumeric and CJK only
}

export function findBestMatchingSeason<T extends { title: string }>(
  seasons: T[],
  keyword: string
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
  if (containing.length > 0) return containing[0]

  return null
}

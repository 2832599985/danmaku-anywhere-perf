import type { CommentEntity } from '@danmaku-anywhere/danmaku-converter'
import type { DanmakuFilter } from '@/store/settings'

/**
 * Pre-render comment filtering: blocked words (plain substring or regex) and
 * optional duplicate merging (identical text keeps only the first occurrence).
 * Pure and cheap enough to re-run whenever settings change — the result feeds
 * DanmakuController.setComments, the full list in the store stays untouched.
 */
export const filterComments = (
  comments: CommentEntity[],
  filters: DanmakuFilter[],
  mergeDuplicates: boolean
): CommentEntity[] => {
  const matchers: ((text: string) => boolean)[] = []
  for (const f of filters) {
    const pattern = f.pattern.trim()
    if (!pattern) continue
    if (f.isRegex) {
      try {
        const re = new RegExp(pattern)
        matchers.push((text) => re.test(text))
      } catch {
        // an invalid regex silently matches nothing rather than crashing
      }
    } else {
      matchers.push((text) => text.includes(pattern))
    }
  }

  if (matchers.length === 0 && !mergeDuplicates) return comments

  const seen = mergeDuplicates ? new Set<string>() : null
  return comments.filter((c) => {
    const text = c.m
    if (matchers.some((match) => match(text))) return false
    if (seen) {
      if (seen.has(text)) return false
      seen.add(text)
    }
    return true
  })
}

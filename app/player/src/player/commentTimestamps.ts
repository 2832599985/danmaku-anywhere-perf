import type { CommentEntity } from '@danmaku-anywhere/danmaku-converter'

const sortedTimesCache = new WeakMap<CommentEntity[], Float64Array>()

/**
 * Parse and ascending-sort finite non-negative comment timestamps once per
 * `comments` array reference. Shared by the hover tooltip, 48-bar density
 * histogram, and OP/ED marker heuristic so pointer movement never re-parses
 * tens of thousands of `c.p` strings on the main thread.
 */
export const getSortedCommentTimes = (
  comments: CommentEntity[]
): Float64Array => {
  const cached = sortedTimesCache.get(comments)
  if (cached) return cached

  const buf = new Float64Array(comments.length)
  let count = 0
  for (const comment of comments) {
    const t = Number.parseFloat(comment.p)
    if (Number.isFinite(t) && t >= 0) {
      buf[count++] = t
    }
  }
  const result = count === buf.length ? buf : buf.subarray(0, count).slice()
  result.sort()
  sortedTimesCache.set(comments, result)
  return result
}

const lowerBound = (arr: Float64Array, target: number): number => {
  let lo = 0
  let hi = arr.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (arr[mid] < target) lo = mid + 1
    else hi = mid
  }
  return lo
}

const upperBound = (arr: Float64Array, target: number): number => {
  let lo = 0
  let hi = arr.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (arr[mid] <= target) lo = mid + 1
    else hi = mid
  }
  return lo
}

/**
 * Count comments whose timestamp falls within `[minTime, maxTime]` inclusive
 * in `O(log N)` time.
 */
export const countCommentsInRange = (
  sortedTimes: Float64Array,
  minTime: number,
  maxTime: number
): number => {
  if (sortedTimes.length === 0 || maxTime < minTime) return 0
  return upperBound(sortedTimes, maxTime) - lowerBound(sortedTimes, minTime)
}

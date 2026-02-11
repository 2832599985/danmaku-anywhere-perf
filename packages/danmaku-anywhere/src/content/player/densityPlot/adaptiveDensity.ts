import {
  type CommentEntity,
  parseCommentEntityTime,
} from '@danmaku-anywhere/danmaku-converter'

/**
 * Compute an adaptive bin size based on video duration.
 * Shorter videos use smaller bins for finer resolution;
 * longer videos use larger bins to keep computation cheap.
 */
export function getAdaptiveBinSize(durationSec: number): number {
  if (durationSec < 300) return 3 // < 5 min
  if (durationSec < 1800) return 5 // 5-30 min
  if (durationSec < 3600) return 10 // 30-60 min
  return 30 // > 60 min
}

/**
 * Filter comments to reduce density in high-density segments.
 *
 * Algorithm:
 * 1. Bucket comments by time into bins of `binSizeSec`.
 * 2. Compute average comments per bin.
 * 3. For bins with density > 2x average, randomly drop comments
 *    so the effective count is capped at ~1.5x average.
 * 4. All comments in low-density bins (<= 2x average) pass through.
 *
 * Uses a deterministic seed derived from comment content (`p` field)
 * so the same set of comments always produces the same filtering result
 * (no flickering on re-mount).
 */
export function filterByAdaptiveDensity(
  comments: CommentEntity[],
  durationSec: number,
  binSizeSec: number
): CommentEntity[] {
  if (
    comments.length === 0 ||
    !Number.isFinite(durationSec) ||
    durationSec <= 0
  ) {
    return comments
  }

  const binSize = Math.max(1, binSizeSec)
  const binCount = Math.max(1, Math.ceil(durationSec / binSize))

  // Group comments into bins
  const bins: CommentEntity[][] = Array.from({ length: binCount }, () => [])

  for (const c of comments) {
    const t = parseCommentEntityTime(c.p)
    if (!Number.isFinite(t) || t < 0 || t > durationSec) {
      // Keep comments with invalid times unfiltered
      bins[0].push(c)
      continue
    }
    const idx = Math.min(binCount - 1, Math.floor(t / binSize))
    bins[idx].push(c)
  }

  // Compute average count per bin (only counting non-empty bins)
  let totalComments = 0
  let nonEmptyBins = 0
  for (const bin of bins) {
    if (bin.length > 0) {
      totalComments += bin.length
      nonEmptyBins++
    }
  }
  const avgCount = nonEmptyBins > 0 ? totalComments / nonEmptyBins : 0

  if (avgCount === 0) return comments

  const densityThreshold = avgCount * 2
  const targetCount = Math.ceil(avgCount * 1.5)

  const result: CommentEntity[] = []

  for (const bin of bins) {
    if (bin.length <= densityThreshold) {
      // Low/normal density: keep all
      for (const c of bin) {
        result.push(c)
      }
    } else {
      // High density: keep `targetCount` comments, sampling deterministically
      const keepRatio = targetCount / bin.length
      for (const c of bin) {
        if (simpleHash(c.p) < keepRatio) {
          result.push(c)
        }
      }
    }
  }

  return result
}

/**
 * Deterministic hash of a string to a [0, 1) float.
 * Uses a simple FNV-1a-like hash for speed.
 */
function simpleHash(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  // Convert to unsigned 32-bit, then normalize to [0, 1)
  return ((h >>> 0) & 0x7fffffff) / 0x7fffffff
}

import type { CommentEntity } from '@danmaku-anywhere/danmaku-converter'
import { parseCommentEntityTime } from '@danmaku-anywhere/danmaku-converter'
import type { DensityPoint } from './types'

export interface HighlightMoment {
  /** Peak time in seconds */
  time: number
  /** Duration of the highlight region in seconds */
  duration: number
  /** Peak density value (0-1 normalized) */
  peakDensity: number
  /** Raw comment count at peak */
  peakCount: number
  /** Top representative comments from this region */
  topComments: string[]
}

/**
 * Detect highlight moments from density data using peak detection.
 *
 * Algorithm:
 * 1. Compute mean and stddev of density values
 * 2. Find local maxima above threshold (mean + 1.5 * stddev)
 * 3. Merge adjacent peaks within 10s
 * 4. Extract top comments from each peak region
 * 5. Return top N highlights sorted by density
 */
export function detectHighlights(
  data: DensityPoint[],
  comments: CommentEntity[],
  maxResults = 8
): HighlightMoment[] {
  if (data.length < 3) return []

  const values = data.map((d) => d.value)
  const mean = values.reduce((s, v) => s + v, 0) / values.length
  const variance =
    values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length
  const stddev = Math.sqrt(variance)
  const threshold = Math.max(mean + 1.5 * stddev, 0.3)

  // Find peaks above threshold
  const peaks: Array<{ index: number; point: DensityPoint }> = []
  for (let i = 1; i < data.length - 1; i++) {
    if (
      data[i].value >= threshold &&
      data[i].value >= data[i - 1].value &&
      data[i].value >= data[i + 1].value
    ) {
      peaks.push({ index: i, point: data[i] })
    }
  }

  if (peaks.length === 0) return []

  // Merge adjacent peaks (within 10s)
  const mergeGap = 10
  const merged: Array<{
    startTime: number
    endTime: number
    peakPoint: DensityPoint
  }> = []

  let current = {
    startTime: peaks[0].point.time,
    endTime: peaks[0].point.time,
    peakPoint: peaks[0].point,
  }

  for (let i = 1; i < peaks.length; i++) {
    const p = peaks[i]
    if (p.point.time - current.endTime <= mergeGap) {
      current.endTime = p.point.time
      if (p.point.value > current.peakPoint.value) {
        current.peakPoint = p.point
      }
    } else {
      merged.push(current)
      current = {
        startTime: p.point.time,
        endTime: p.point.time,
        peakPoint: p.point,
      }
    }
  }
  merged.push(current)

  // Estimate bin size from data
  const binSize = data.length >= 2 ? data[1].time - data[0].time : 10

  // Extract top comments for each highlight region
  const highlights: HighlightMoment[] = merged.map((region) => {
    const regionStart = region.startTime - binSize
    const regionEnd = region.endTime + binSize

    // Collect comments in this time range
    const regionComments: string[] = []
    for (const c of comments) {
      const t = parseCommentEntityTime(c.p)
      if (t >= regionStart && t <= regionEnd) {
        regionComments.push(c.m)
      }
    }

    // Find most common comments (simple frequency count)
    const freq = new Map<string, number>()
    for (const text of regionComments) {
      freq.set(text, (freq.get(text) ?? 0) + 1)
    }
    const topComments = [...freq.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([text]) => text)

    return {
      time: region.peakPoint.time,
      duration: Math.max(binSize, region.endTime - region.startTime + binSize),
      peakDensity: region.peakPoint.value,
      peakCount: region.peakPoint.count ?? 0,
      topComments,
    }
  })

  // Sort by peak density descending, take top N
  return highlights
    .sort((a, b) => b.peakDensity - a.peakDensity)
    .slice(0, maxResults)
}

/**
 * Format seconds to mm:ss string
 */
export function formatTimestamp(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

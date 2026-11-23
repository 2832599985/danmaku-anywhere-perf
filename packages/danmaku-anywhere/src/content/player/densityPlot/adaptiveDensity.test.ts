import type { CommentEntity } from '@danmaku-anywhere/danmaku-converter'
import { describe, expect, it } from 'vitest'
import {
  filterByAdaptiveDensity,
  getAdaptiveBinSize,
} from '@/content/player/densityPlot/adaptiveDensity'

function c(time: number, text = 'x'): CommentEntity {
  return {
    p: `${time},1,16777215`,
    m: text,
  }
}

describe('getAdaptiveBinSize', () => {
  it('returns 3s for videos under 5 minutes', () => {
    expect(getAdaptiveBinSize(60)).toBe(3)
    expect(getAdaptiveBinSize(299)).toBe(3)
  })

  it('returns 5s for 5-30 minute videos', () => {
    expect(getAdaptiveBinSize(300)).toBe(5)
    expect(getAdaptiveBinSize(1799)).toBe(5)
  })

  it('returns 10s for 30-60 minute videos', () => {
    expect(getAdaptiveBinSize(1800)).toBe(10)
    expect(getAdaptiveBinSize(3599)).toBe(10)
  })

  it('returns 30s for videos over 60 minutes', () => {
    expect(getAdaptiveBinSize(3600)).toBe(30)
    expect(getAdaptiveBinSize(7200)).toBe(30)
  })
})

describe('filterByAdaptiveDensity', () => {
  it('returns all comments when input is empty', () => {
    expect(filterByAdaptiveDensity([], 100, 10)).toEqual([])
  })

  it('returns all comments for invalid duration', () => {
    const comments = [c(1), c(2)]
    expect(filterByAdaptiveDensity(comments, 0, 10)).toBe(comments)
    expect(filterByAdaptiveDensity(comments, Number.NaN, 10)).toBe(comments)
  })

  it('passes through all comments when density is uniform', () => {
    // 10 bins, 2 comments each = uniform, all below 2x average
    const comments: CommentEntity[] = []
    for (let i = 0; i < 10; i++) {
      comments.push(c(i * 10 + 1, `a${i}`))
      comments.push(c(i * 10 + 2, `b${i}`))
    }
    const result = filterByAdaptiveDensity(comments, 100, 10)
    expect(result.length).toBe(comments.length)
  })

  it('filters high-density bins while keeping low-density bins intact', () => {
    // Create a spike: 50 comments in first 10s, 2 comments in each of the other 9 bins
    const comments: CommentEntity[] = []
    for (let i = 0; i < 50; i++) {
      comments.push(c(i * 0.2, `spike${i}`))
    }
    for (let bin = 1; bin < 10; bin++) {
      comments.push(c(bin * 10 + 1, `low_a${bin}`))
      comments.push(c(bin * 10 + 2, `low_b${bin}`))
    }
    // Total: 50 + 18 = 68 comments, 10 bins, avg = 6.8
    // First bin (50) is > 2 * 6.8 = 13.6, so it will be filtered
    // Target for first bin = ceil(6.8 * 1.5) = 11
    const result = filterByAdaptiveDensity(comments, 100, 10)
    expect(result.length).toBeLessThan(comments.length)
    // Low-density bins should be kept intact (18 comments)
    // High-density bin should be around 11 comments
    expect(result.length).toBeGreaterThanOrEqual(18)
    expect(result.length).toBeLessThanOrEqual(18 + 15)
  })

  it('produces deterministic results', () => {
    const comments: CommentEntity[] = []
    for (let i = 0; i < 100; i++) {
      comments.push(c(i * 0.1, `comment${i}`))
    }
    const result1 = filterByAdaptiveDensity(comments, 100, 10)
    const result2 = filterByAdaptiveDensity(comments, 100, 10)
    expect(result1).toEqual(result2)
  })
})

import { describe, expect, it } from 'vitest'
import {
  commentKey,
  dedupeComments,
  fuzzyDedupeComments,
  mergeComments,
} from './utils'

describe('commentKey', () => {
  it('should use cid when available', () => {
    const comment = { cid: 123, p: '1.00,1,16777215', m: 'hello' }
    expect(commentKey(comment)).toBe('cid:123')
  })

  it('should fallback to p+m composite key when no cid', () => {
    const comment = { p: '1.00,1,16777215', m: 'hello' }
    expect(commentKey(comment)).toBe('pt:1.00,1,16777215|hello')
  })

  it('should use cid even when cid is 0', () => {
    const comment = { cid: 0, p: '1.00,1,16777215', m: 'hello' }
    expect(commentKey(comment)).toBe('cid:0')
  })
})

describe('dedupeComments', () => {
  it('should remove exact duplicates by cid', () => {
    const comments = [
      { cid: 1, p: '1.00,1,16777215', m: 'hello' },
      { cid: 1, p: '1.00,1,16777215', m: 'hello' },
      { cid: 2, p: '2.00,1,16777215', m: 'world' },
    ]
    const result = dedupeComments(comments)
    expect(result).toHaveLength(2)
    expect(result[0].cid).toBe(1)
    expect(result[1].cid).toBe(2)
  })

  it('should remove exact duplicates by p+m when no cid', () => {
    const comments = [
      { p: '1.00,1,16777215', m: 'hello' },
      { p: '1.00,1,16777215', m: 'hello' },
      { p: '2.00,1,16777215', m: 'world' },
    ]
    const result = dedupeComments(comments)
    expect(result).toHaveLength(2)
  })

  it('should keep comments with same text but different times', () => {
    const comments = [
      { p: '1.00,1,16777215', m: 'hello' },
      { p: '5.00,1,16777215', m: 'hello' },
    ]
    const result = dedupeComments(comments)
    expect(result).toHaveLength(2)
  })

  it('should handle empty array', () => {
    const result = dedupeComments([])
    expect(result).toHaveLength(0)
  })
})

describe('mergeComments', () => {
  it('should merge two arrays and remove exact duplicates', () => {
    const existing = [
      { p: '1.00,1,16777215', m: 'hello' },
      { p: '2.00,1,16777215', m: 'world' },
    ]
    const incoming = [
      { p: '1.00,1,16777215', m: 'hello' }, // duplicate
      { p: '3.00,1,16777215', m: 'new comment' },
    ]
    const result = mergeComments(existing, incoming)
    expect(result).toHaveLength(3)
    expect(result[2].m).toBe('new comment')
  })

  it('should preserve order: existing first, then new incoming', () => {
    const existing = [{ p: '2.00,1,16777215', m: 'second' }]
    const incoming = [{ p: '1.00,1,16777215', m: 'first' }]
    const result = mergeComments(existing, incoming)
    expect(result[0].m).toBe('second')
    expect(result[1].m).toBe('first')
  })

  it('should handle empty existing', () => {
    const result = mergeComments([], [{ p: '1.00,1,16777215', m: 'hello' }])
    expect(result).toHaveLength(1)
  })

  it('should handle empty incoming', () => {
    const result = mergeComments([{ p: '1.00,1,16777215', m: 'hello' }], [])
    expect(result).toHaveLength(1)
  })
})

describe('fuzzyDedupeComments', () => {
  it('should remove exact duplicates (same p+m)', () => {
    const existing = [{ p: '1.00,1,16777215', m: 'hello' }]
    const incoming = [{ p: '1.00,1,16777215', m: 'hello' }]
    const result = fuzzyDedupeComments(existing, incoming)
    expect(result).toHaveLength(1)
  })

  it('should remove fuzzy duplicates (same text within 1s)', () => {
    const existing = [{ p: '1.00,1,16777215', m: 'hello' }]
    const incoming = [{ p: '1.50,1,16777215', m: 'hello' }] // 0.5s diff
    const result = fuzzyDedupeComments(existing, incoming)
    expect(result).toHaveLength(1)
    expect(result[0].p).toBe('1.00,1,16777215') // keeps existing
  })

  it('should keep comments with same text but time > 1s apart', () => {
    const existing = [{ p: '1.00,1,16777215', m: 'hello' }]
    const incoming = [{ p: '3.00,1,16777215', m: 'hello' }] // 2s diff
    const result = fuzzyDedupeComments(existing, incoming)
    expect(result).toHaveLength(2)
  })

  it('should keep comments with different text even at same time', () => {
    const existing = [{ p: '1.00,1,16777215', m: 'hello' }]
    const incoming = [{ p: '1.00,1,16777215', m: 'world' }]
    const result = fuzzyDedupeComments(existing, incoming)
    expect(result).toHaveLength(2)
  })

  it('should respect custom timeTolerance', () => {
    const existing = [{ p: '1.00,1,16777215', m: 'hello' }]
    const incoming = [{ p: '3.00,1,16777215', m: 'hello' }]

    // With 5s tolerance, should be considered duplicate
    const result5s = fuzzyDedupeComments(existing, incoming, 5)
    expect(result5s).toHaveLength(1)

    // With 1s tolerance (default), should not be duplicate
    const result1s = fuzzyDedupeComments(existing, incoming, 1)
    expect(result1s).toHaveLength(2)
  })

  it('should handle exact boundary of timeTolerance (exclusive)', () => {
    const existing = [{ p: '1.00,1,16777215', m: 'hello' }]
    const incoming = [{ p: '2.00,1,16777215', m: 'hello' }] // exactly 1s diff

    // timeTolerance = 1 means < 1s, so exactly 1s apart should NOT be deduped
    const result = fuzzyDedupeComments(existing, incoming, 1)
    expect(result).toHaveLength(2)
  })

  it('should dedupe within incoming array too', () => {
    const existing = [{ p: '1.00,1,16777215', m: 'hello' }]
    const incoming = [
      { p: '5.00,1,16777215', m: 'new' },
      { p: '5.30,1,16777215', m: 'new' }, // fuzzy dup of previous incoming
    ]
    const result = fuzzyDedupeComments(existing, incoming)
    expect(result).toHaveLength(2) // existing + first incoming
  })

  it('should handle comments with cid for exact dedup', () => {
    const existing = [{ cid: 1, p: '1.00,1,16777215', m: 'hello' }]
    const incoming = [{ cid: 1, p: '1.00,1,16777215', m: 'hello' }]
    const result = fuzzyDedupeComments(existing, incoming)
    expect(result).toHaveLength(1)
  })

  it('should handle empty arrays', () => {
    expect(fuzzyDedupeComments([], [])).toHaveLength(0)
    expect(
      fuzzyDedupeComments([], [{ p: '1.00,1,16777215', m: 'hello' }])
    ).toHaveLength(1)
    expect(
      fuzzyDedupeComments([{ p: '1.00,1,16777215', m: 'hello' }], [])
    ).toHaveLength(1)
  })

  it('should handle large batches efficiently', () => {
    const existing = Array.from({ length: 1000 }, (_, i) => ({
      p: `${i}.00,1,16777215`,
      m: `comment${i}`,
    }))
    const incoming = Array.from({ length: 1000 }, (_, i) => ({
      p: `${i + 0.5}.00,1,16777215`,
      m: `comment${i}`,
    }))
    // All should be fuzzy deduped since text matches and time is within 1s
    const result = fuzzyDedupeComments(existing, incoming)
    expect(result).toHaveLength(1000)
  })

  it('should handle multi-source scenario with overlapping comments', () => {
    // Simulating DanDanPlay + Bilibili overlap
    const ddp = [
      { p: '10.00,1,16777215', m: '233333' },
      { p: '15.50,1,16777215', m: 'wwww' },
      { p: '20.00,1,16777215', m: 'unique ddp comment' },
    ]
    const bilibili = [
      { p: '10.20,1,16777215', m: '233333' }, // fuzzy dup
      { p: '15.80,1,16777215', m: 'wwww' }, // fuzzy dup
      { p: '25.00,1,16777215', m: 'unique bilibili comment' },
    ]
    const result = fuzzyDedupeComments(ddp, bilibili)
    expect(result).toHaveLength(4) // 3 ddp + 1 unique bilibili
    expect(result.map((c) => c.m)).toEqual([
      '233333',
      'wwww',
      'unique ddp comment',
      'unique bilibili comment',
    ])
  })
})

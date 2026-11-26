import type { CommentEntity } from '@danmaku-anywhere/danmaku-converter'
import { describe, expect, it } from 'vitest'
import {
  countCommentsInRange,
  getSortedCommentTimes,
} from './commentTimestamps'

const makeComment = (p: string, m = 'test'): CommentEntity => ({
  cid: 1,
  p,
  m,
})

describe('commentTimestamps', () => {
  it('parses, filters invalid values, sorts ascending, and caches per array', () => {
    const comments: CommentEntity[] = [
      makeComment('25.5,1,16777215'),
      makeComment('bad,1,16777215'),
      makeComment('-3.2,1,16777215'),
      makeComment('10.0,1,16777215'),
      makeComment('15.0,5,16777215'),
    ]
    const first = getSortedCommentTimes(comments)
    const second = getSortedCommentTimes(comments)
    expect(second).toBe(first)
    expect(Array.from(first)).toEqual([10, 15, 25.5])
  })

  it('counts inclusive [min, max] ranges in O(log N) accurately', () => {
    const comments: CommentEntity[] = [
      makeComment('5,1,16777215'),
      makeComment('10,1,16777215'),
      makeComment('10,1,16777215'),
      makeComment('15,1,16777215'),
      makeComment('20,1,16777215'),
      makeComment('20.01,1,16777215'),
    ]
    const sorted = getSortedCommentTimes(comments)
    expect(countCommentsInRange(sorted, 10, 20)).toBe(4)
    expect(countCommentsInRange(sorted, 0, 4.99)).toBe(0)
    expect(countCommentsInRange(sorted, 20.02, 30)).toBe(0)
    expect(countCommentsInRange(sorted, 10, 10)).toBe(2)
  })
})

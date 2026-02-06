import { describe, expect, it } from 'vitest'

import type { CommentEntity, CommentMode } from './types.js'
import {
  commentOptionsToString,
  parseCommentEntityP,
  parseCommentEntityTime,
} from './utils.js'

const commentEntity: CommentEntity = {
  cid: 1737712333,
  p: '658.73,1,16777215,[BiliBili]8a40949',
  m: '纯哥你怎么这么有女人缘啊',
}

const commentOptions = {
  time: 658.73,
  mode: 'rtl' as keyof typeof CommentMode,
  color: '#ffffff',
  uid: '[BiliBili]8a40949',
}

describe('comment entity conversion', () => {
  it('should convert string to object', () => {
    const commentOptions = parseCommentEntityP(commentEntity.p)

    expect(commentOptions).toEqual(commentOptions)
  })

  it('should convert object to string', () => {
    const p = commentOptionsToString(commentOptions)

    expect(p).toEqual(commentEntity.p)
  })

  it('should parse time from comment entity p', () => {
    expect(parseCommentEntityTime(commentEntity.p)).toBe(658.73)
  })

  it('should return NaN when no comma exists', () => {
    expect(Number.isNaN(parseCommentEntityTime('invalid'))).toBe(true)
  })

  it('should return NaN when time is not a number', () => {
    expect(Number.isNaN(parseCommentEntityTime('foo,1,16777215'))).toBe(true)
  })
})

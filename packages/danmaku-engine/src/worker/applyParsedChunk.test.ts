import { describe, expect, it } from 'vitest'
import type { ParsedComment, TimedComment } from '../parser'
import { applyParsedChunk } from './applyParsedChunk'

const createTimed = (count: number): TimedComment[] => {
  const raw = { p: '0,1,16777215', m: 'hi' }
  return Array.from({ length: count }, (_, i) => ({
    time: i,
    raw,
  }))
}

describe('applyParsedChunk', () => {
  it('applies parsed comments into the target array by index', () => {
    const target = createTimed(5)
    const parsed: Array<ParsedComment | undefined> = [
      { text: 'a', mode: 'rtl', time: 1, style: {}, color: '#fff' },
      { text: 'b', mode: 'rtl', time: 2, style: {}, color: '#fff' },
      { text: 'c', mode: 'rtl', time: 3, style: {}, color: '#fff' },
    ]

    applyParsedChunk(target, 1, parsed)

    expect(target[1].parsed?.text).toBe('a')
    expect(target[2].parsed?.text).toBe('b')
    expect(target[3].parsed?.text).toBe('c')
  })

  it('skips undefined entries', () => {
    const target = createTimed(4)
    const parsed: Array<ParsedComment | undefined> = [
      { text: 'a', mode: 'rtl', time: 1, style: {}, color: '#fff' },
      undefined,
      { text: 'c', mode: 'rtl', time: 3, style: {}, color: '#fff' },
    ]

    applyParsedChunk(target, 1, parsed)

    expect(target[1].parsed?.text).toBe('a')
    expect(target[2].parsed).toBeUndefined()
    expect(target[2].parseError).toBe(true)
    expect(target[3].parsed?.text).toBe('c')
  })
})

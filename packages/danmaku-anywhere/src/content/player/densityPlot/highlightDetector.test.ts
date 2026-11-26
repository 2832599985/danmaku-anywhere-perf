import { describe, expect, it } from 'vitest'
import { detectHighlights } from './highlightDetector'

describe('detectHighlights', () => {
  it('detects density spikes and extracts representative comments accurately', () => {
    const data = [
      { time: 0, value: 0.1, count: 5 },
      { time: 10, value: 0.1, count: 5 },
      { time: 20, value: 0.95, count: 50 },
      { time: 30, value: 0.1, count: 5 },
      { time: 40, value: 0.1, count: 5 },
    ]
    const comments = [
      { cid: 1, p: '5,1,16777215', m: 'op' },
      { cid: 2, p: '19,1,16777215', m: '名场面' },
      { cid: 3, p: '21,1,16777215', m: '名场面' },
      { cid: 4, p: '22,1,16777215', m: '高能' },
      { cid: 5, p: '39,1,16777215', m: 'ed' },
    ]

    const highlights = detectHighlights(data, comments)
    expect(highlights).toHaveLength(1)
    expect(highlights[0].time).toBe(20)
    expect(highlights[0].topComments[0]).toBe('名场面')
    expect(highlights[0].topComments).toContain('高能')
  })
})

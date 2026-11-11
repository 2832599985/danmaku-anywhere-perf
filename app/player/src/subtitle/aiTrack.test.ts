import { describe, expect, it } from 'vitest'
import {
  type AiLine,
  addInterval,
  buildCues,
  coveredEnd,
  exportCues,
  hasPendingBefore,
  mergeLines,
  nextDisplayMode,
  parseTrack,
  pickBatch,
  serializeTrack,
  zhFrontier,
} from './aiTrack'

const line = (start: number, ja: string, zh?: string | null): AiLine => {
  const l: AiLine = { start, end: start + 2, ja }
  if (zh !== undefined) l.zh = zh
  return l
}

describe('intervals', () => {
  it('merges overlapping and touching spans', () => {
    let list = addInterval([], { from: 100, to: 200 })
    list = addInterval(list, { from: 300, to: 400 })
    list = addInterval(list, { from: 200.3, to: 250 })
    expect(list).toEqual([
      { from: 100, to: 250 },
      { from: 300, to: 400 },
    ])
    list = addInterval(list, { from: 240, to: 310 })
    expect(list).toEqual([{ from: 100, to: 400 }])
  })

  it('ignores empty spans', () => {
    expect(addInterval([], { from: 5, to: 5 })).toEqual([])
  })

  it('reports where the span holding t ends', () => {
    const list = [
      { from: 100, to: 250 },
      { from: 300, to: 400 },
    ]
    expect(coveredEnd(list, 120)).toBe(250)
    expect(coveredEnd(list, 99.8)).toBe(250) // a seek just before still counts
    expect(coveredEnd(list, 260)).toBeNull()
    expect(coveredEnd(list, 400)).toBeNull()
  })
})

describe('mergeLines', () => {
  it('drops the same line heard twice and keeps translations', () => {
    const existing = [line(10, 'はい', '是的')]
    const merged = mergeLines(existing, [line(10.4, 'はい'), line(20, '次')])
    expect(merged.map((l) => l.ja)).toEqual(['はい', '次'])
    expect(merged[0]).toBe(existing[0])
  })
})

describe('pickBatch', () => {
  const lines = [
    line(0, 'a'),
    line(50, 'b'),
    line(98, 'c'),
    line(101, 'd', '已译'),
    line(110, 'e'),
    line(200, 'f'),
  ]

  it('takes the playhead neighbourhood first, then ahead, then behind', () => {
    expect(pickBatch(lines, 100, 8).map((i) => lines[i].ja)).toEqual([
      'c',
      'e',
      'f',
      'b',
      'a',
    ])
  })

  it('respects the batch size', () => {
    expect(pickBatch(lines, 100, 2).map((i) => lines[i].ja)).toEqual(['c', 'e'])
  })

  it('never re-picks a rejected (null) line', () => {
    expect(pickBatch([line(0, 'x', null)], 0, 8)).toEqual([])
  })
})

describe('zhFrontier', () => {
  const asr = [{ from: 0, to: 300 }]

  it('stops at the first untranslated line ahead', () => {
    const lines = [line(10, 'a', '甲'), line(20, 'b', null), line(40, 'c')]
    expect(zhFrontier(lines, asr, 5)).toBe(40)
  })

  it('reaches the end of recognition when all is translated', () => {
    expect(zhFrontier([line(10, 'a', '甲')], asr, 5)).toBe(300)
  })

  it('is the playhead itself where nothing was recognized', () => {
    expect(zhFrontier([], asr, 400)).toBe(400)
  })

  it('a line already playing but untranslated blocks at the playhead', () => {
    expect(zhFrontier([line(9, 'a')], asr, 10)).toBe(10)
  })

  it('pending check', () => {
    expect(hasPendingBefore([line(50, 'a')], 60)).toBe(true)
    expect(hasPendingBefore([line(50, 'a')], 40)).toBe(false)
  })
})

describe('display', () => {
  const lines = [line(1, 'はい', '是的'), line(5, '銀'), line(9, 'ええ', null)]

  it('dual puts the Chinese above a smaller Japanese line', () => {
    const cues = buildCues(lines, 'dual')
    expect(cues[0]).toMatchObject({ text: '是的', marginV: 1 })
    expect(cues[1]).toMatchObject({ text: 'はい', marginV: 0 })
    expect(cues[1].scale).toBeLessThan(1)
    // untranslated / rejected lines show the Japanese once, full size
    expect(cues.slice(2).map((c) => [c.text, c.scale])).toEqual([
      ['銀', undefined],
      ['ええ', undefined],
    ])
  })

  it('zh and ja modes', () => {
    expect(buildCues(lines, 'zh').map((c) => c.text)).toEqual([
      '是的',
      '銀',
      'ええ',
    ])
    expect(buildCues(lines, 'ja').map((c) => c.text)).toEqual([
      'はい',
      '銀',
      'ええ',
    ])
  })

  it('cycles dual → zh → ja', () => {
    expect(nextDisplayMode('dual')).toBe('zh')
    expect(nextDisplayMode('zh')).toBe('ja')
    expect(nextDisplayMode('ja')).toBe('dual')
  })

  it('exports bilingual as two lines in one cue', () => {
    expect(exportCues(lines, 'dual').map((c) => c.text)).toEqual([
      '是的\nはい',
      '銀',
      'ええ',
    ])
  })
})

describe('cache', () => {
  it('round-trips and keeps the "rejected" marker', () => {
    const lines = [line(1, 'a', '甲'), line(3, 'b', null), line(5, 'c')]
    const text = serializeTrack(lines, [{ from: 0, to: 120 }])
    const back = parseTrack(text)
    expect(back?.lines).toEqual(lines)
    expect(back?.asr).toEqual([{ from: 0, to: 120 }])
    expect('zh' in (back?.lines[2] ?? {})).toBe(false)
  })

  it('rejects foreign or corrupt files', () => {
    expect(parseTrack(null)).toBeNull()
    expect(parseTrack('{oops')).toBeNull()
    expect(parseTrack('{"v":2,"lines":[],"asr":[]}')).toBeNull()
    const partial = parseTrack(
      '{"v":1,"lines":[{"start":1,"end":2,"ja":"x"},{"start":"bad"}],"asr":[{"from":0,"to":"x"}]}'
    )
    expect(partial?.lines).toHaveLength(1)
    expect(partial?.asr).toEqual([])
  })
})

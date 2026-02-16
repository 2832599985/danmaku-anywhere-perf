import { describe, expect, it } from 'vitest'

import {
  extractSeasonHint,
  findBestMatchingSeason,
  normalizeTitle,
} from './titleMatch'

describe('normalizeTitle', () => {
  it('lowercases and removes spaces', () => {
    expect(normalizeTitle('Attack On Titan')).toBe('attackontitan')
  })

  it('removes fullwidth spaces', () => {
    expect(normalizeTitle('进击\u3000的巨人')).toBe('进击的巨人')
  })

  it('removes punctuation but keeps CJK', () => {
    expect(normalizeTitle('进击的巨人！第三季')).toBe('进击的巨人第三季')
  })

  it('keeps alphanumeric characters', () => {
    expect(normalizeTitle('Re:Zero S2')).toBe('rezeros2')
  })
})

describe('extractSeasonHint', () => {
  it('extracts Chinese season numbers', () => {
    expect(extractSeasonHint('进击的巨人 第三季')).toBe(3)
    expect(extractSeasonHint('凡人修仙传 第二季')).toBe(2)
    expect(extractSeasonHint('某动漫 第十季')).toBe(10)
  })

  it('extracts numeric Chinese season format', () => {
    expect(extractSeasonHint('进击的巨人 第2季')).toBe(2)
    expect(extractSeasonHint('某动漫 第12季')).toBe(12)
  })

  it('extracts English Season N format', () => {
    expect(extractSeasonHint('Attack on Titan Season 3')).toBe(3)
    expect(extractSeasonHint('Attack on Titan season 2')).toBe(2)
  })

  it('extracts S3 short format', () => {
    expect(extractSeasonHint('Re:Zero S2')).toBe(2)
    expect(extractSeasonHint('Show S03')).toBe(3)
  })

  it('extracts Roman numerals', () => {
    expect(extractSeasonHint('Show III')).toBe(3)
    expect(extractSeasonHint('Show IV')).toBe(4)
  })

  it('returns null when no season hint found', () => {
    expect(extractSeasonHint('进击的巨人')).toBeNull()
    expect(extractSeasonHint('鬼灭之刃 最终季')).toBeNull()
  })
})

describe('findBestMatchingSeason', () => {
  const seasons = [
    { title: '进击的巨人' },
    { title: '进击的巨人 第二季' },
    { title: '进击的巨人 第三季' },
    { title: '进击的巨人 最终季' },
  ]

  it('returns exact match', () => {
    const result = findBestMatchingSeason(seasons, '进击的巨人')
    expect(result).toEqual({ title: '进击的巨人' })
  })

  it('returns exact match ignoring spaces', () => {
    const result = findBestMatchingSeason(seasons, '进击 的 巨人')
    expect(result).toEqual({ title: '进击的巨人' })
  })

  it('returns shortest containing match when no exact match', () => {
    const result = findBestMatchingSeason(
      [{ title: '进击的巨人 第二季' }, { title: '进击的巨人 第三季' }],
      '进击的巨人'
    )
    // Both contain the keyword, shortest title wins
    expect(result?.title).toBe('进击的巨人 第二季')
  })

  it('returns null when nothing matches', () => {
    const result = findBestMatchingSeason(seasons, '鬼灭之刃')
    expect(result).toBeNull()
  })

  it('returns null for empty array', () => {
    const result = findBestMatchingSeason([], '进击的巨人')
    expect(result).toBeNull()
  })

  it('handles case-insensitive matching', () => {
    const englishSeasons = [
      { title: 'Attack on Titan' },
      { title: 'Attack on Titan Season 2' },
    ]
    const result = findBestMatchingSeason(englishSeasons, 'attack on titan')
    expect(result).toEqual({ title: 'Attack on Titan' })
  })

  // Season hint tests
  it('prefers season hint match over shortest containing title', () => {
    const multiSeasons = [
      { title: '进击的巨人 第二季' },
      { title: '进击的巨人 第三季' },
      { title: '进击的巨人 最终季' },
    ]
    // Without hint, shortest wins (第二季)
    const resultNoHint = findBestMatchingSeason(multiSeasons, '进击的巨人')
    expect(resultNoHint?.title).toBe('进击的巨人 第二季')

    // With hint=3, 第三季 should be preferred
    const resultWithHint = findBestMatchingSeason(multiSeasons, '进击的巨人', 3)
    expect(resultWithHint?.title).toBe('进击的巨人 第三季')
  })

  it('falls back to shortest containing when hint does not match any', () => {
    const multiSeasons = [
      { title: '进击的巨人 第二季' },
      { title: '进击的巨人 第三季' },
    ]
    // Hint=5 matches neither, so fallback to shortest
    const result = findBestMatchingSeason(multiSeasons, '进击的巨人', 5)
    expect(result?.title).toBe('进击的巨人 第二季')
  })

  it('works with English Season N hint matching', () => {
    const englishSeasons = [
      { title: 'Attack on Titan Season 2' },
      { title: 'Attack on Titan Season 3' },
      { title: 'Attack on Titan Season 3 Part 2' },
    ]
    const result = findBestMatchingSeason(englishSeasons, 'Attack on Titan', 3)
    expect(result?.title).toBe('Attack on Titan Season 3')
  })
})

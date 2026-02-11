import { describe, expect, it } from 'vitest'

import { findBestMatchingSeason, normalizeTitle } from './titleMatch'

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
})

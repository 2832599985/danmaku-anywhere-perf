import { describe, expect, it } from 'vitest'
import { applyColorFilter, applyFilter } from './parser'

describe('parser filters', () => {
  it('ignores empty text and regex filters instead of blocking every comment', () => {
    expect(
      applyFilter('任意弹幕内容', [
        { type: 'text', value: '', enabled: true },
        { type: 'regex', value: '', enabled: true },
      ])
    ).toBe(false)

    expect(
      applyFilter('剧透警告', [{ type: 'text', value: '剧透', enabled: true }])
    ).toBe(true)
  })

  it('matches color blacklists case-insensitively with cached lookup', () => {
    const filter = {
      enabled: true,
      onlyWhite: false,
      blacklist: ['#FF0000', '#00ff00'],
    }
    expect(applyColorFilter('#ff0000', filter)).toBe(true)
    expect(applyColorFilter('#00FF00', filter)).toBe(true)
    expect(applyColorFilter('#ffffff', filter)).toBe(false)
  })
})

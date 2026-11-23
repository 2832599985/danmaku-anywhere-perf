import { describe, expect, it } from 'vitest'
import { screenshotFileName } from './screenshot'

describe('screenshotFileName', () => {
  it('formats mm-ss and hh-mm-ss timestamps and strips illegal chars', () => {
    expect(screenshotFileName('葬送的芙莉莲 - 01.mkv', 75.8)).toBe(
      '葬送的芙莉莲 - 01_01-15.png'
    )
    expect(screenshotFileName('Movie:Part*1?.mp4', 3661)).toBe(
      'Movie_Part_1__1-01-01.png'
    )
    expect(screenshotFileName('clip.mp4', Number.NaN)).toBe('clip_00-00.png')
  })
})

import { describe, expect, it } from 'vitest'
import {
  DEFAULT_LINE_HEIGHT,
  danmakuTrackHeight,
  LINE_HEIGHT_MAX,
  LINE_HEIGHT_MIN,
  TEXT_BOX_RATIO,
} from './trackHeight'

describe('danmakuTrackHeight', () => {
  it('rounds the pitch up so the text box always fits inside the track', () => {
    // 26 * 1.3 = 33.8: a 33px track would be shorter than the line box.
    expect(danmakuTrackHeight(26, 1.3)).toBe(34)
    expect(danmakuTrackHeight(26, 1.45)).toBe(38)
    expect(danmakuTrackHeight(48, 2)).toBe(96)
  })

  it('never lets the pitch fall below the text box', () => {
    // A persisted value below the box ratio (or a bad one) must not overlap.
    expect(danmakuTrackHeight(26, 0.5)).toBe(Math.ceil(26 * TEXT_BOX_RATIO))
    // The slider's own minimum is already above the box, so it passes through.
    expect(danmakuTrackHeight(26, LINE_HEIGHT_MIN)).toBe(
      Math.ceil(26 * LINE_HEIGHT_MIN)
    )
    expect(LINE_HEIGHT_MIN).toBeGreaterThan(TEXT_BOX_RATIO)
  })

  it('grows with the font size, so a large font never collides', () => {
    for (let size = 12; size <= 48; size += 1) {
      for (const ratio of [LINE_HEIGHT_MIN, DEFAULT_LINE_HEIGHT, 2]) {
        const pitch = danmakuTrackHeight(size, ratio)
        // The row must hold the box (fontSize * TEXT_BOX_RATIO) with room to
        // spare, and it must never shrink as the font grows.
        expect(pitch).toBeGreaterThanOrEqual(size * TEXT_BOX_RATIO)
        expect(pitch).toBeGreaterThanOrEqual(
          danmakuTrackHeight(size - 1, ratio)
        )
      }
    }
  })

  it('keeps a positive pitch for degenerate input', () => {
    // fontSize 0 falls back to 1px, so the pitch is the box ratio, ceiled.
    expect(danmakuTrackHeight(0, 1.45)).toBe(2)
    expect(danmakuTrackHeight(Number.NaN, 1.45)).toBe(2)
    expect(danmakuTrackHeight(26, 0)).toBe(Math.ceil(26 * TEXT_BOX_RATIO))
    expect(danmakuTrackHeight(26, Number.NaN)).toBe(
      Math.ceil(26 * TEXT_BOX_RATIO)
    )
  })

  it('spans a sane slider range', () => {
    expect(LINE_HEIGHT_MIN).toBeLessThan(DEFAULT_LINE_HEIGHT)
    expect(DEFAULT_LINE_HEIGHT).toBeLessThan(LINE_HEIGHT_MAX)
    // 26px at the defaults: ~38px rows, i.e. noticeably airier than the 32px
    // fixed pitch that used to overlap.
    expect(danmakuTrackHeight(26, DEFAULT_LINE_HEIGHT)).toBe(38)
  })
})

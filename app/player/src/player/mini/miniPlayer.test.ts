import { describe, expect, it } from 'vitest'
import { DEFAULT_DANMAKU, DEFAULT_SUBTITLE } from '@/store/settings'
import {
  effectiveDanmakuSettings,
  effectiveSubtitleSettings,
  MINI_WIDTH,
  miniWindowSize,
} from './miniPlayer'

describe('miniWindowSize', () => {
  it('follows the source aspect ratio', () => {
    expect(miniWindowSize(1920, 1080)).toEqual({
      width: MINI_WIDTH,
      height: 270,
    })
    expect(miniWindowSize(1440, 1080)).toEqual({
      width: MINI_WIDTH,
      height: 360,
    })
  })

  it('falls back to 16:9 before the video reports a size', () => {
    expect(miniWindowSize(0, 0)).toEqual({ width: MINI_WIDTH, height: 270 })
  })

  it('keeps extreme aspect ratios usable', () => {
    expect(miniWindowSize(1080, 1920).height).toBe(400)
    expect(miniWindowSize(4000, 1000).height).toBe(200)
  })
})

describe('effective text settings', () => {
  it('shrinks text only while mini, leaving everything else alone', () => {
    const danmaku = effectiveDanmakuSettings(DEFAULT_DANMAKU, true)
    expect(danmaku.fontSize).toBe(16)
    expect({ ...danmaku, fontSize: DEFAULT_DANMAKU.fontSize }).toEqual(
      DEFAULT_DANMAKU
    )
    expect(effectiveSubtitleSettings(DEFAULT_SUBTITLE, true).fontSize).toBe(18)
  })

  it('returns the very same settings object when not mini', () => {
    // Identity matters: effects keyed on it must not re-run on every render.
    expect(effectiveDanmakuSettings(DEFAULT_DANMAKU, false)).toBe(
      DEFAULT_DANMAKU
    )
    expect(effectiveSubtitleSettings(DEFAULT_SUBTITLE, false)).toBe(
      DEFAULT_SUBTITLE
    )
  })

  it('never shrinks below a readable size', () => {
    const tiny = { ...DEFAULT_DANMAKU, fontSize: 12 }
    expect(effectiveDanmakuSettings(tiny, true).fontSize).toBe(12)
  })
})

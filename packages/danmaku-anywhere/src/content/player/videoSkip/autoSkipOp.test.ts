import { describe, expect, it } from 'vitest'
import { shouldAutoSkipOp } from '@/content/player/videoSkip/autoSkipOp'
import { SkipTarget } from '@/content/player/videoSkip/SkipTarget'

describe('shouldAutoSkipOp', () => {
  it('should return true for early reasonable ranges', () => {
    const target = new SkipTarget({ startTime: 10, endTime: 90 })
    expect(shouldAutoSkipOp(target, 10, false)).toBe(true)
  })

  it('should return false when the target starts too late', () => {
    const target = new SkipTarget({ startTime: 200, endTime: 260 })
    expect(shouldAutoSkipOp(target, 200, false)).toBe(false)
  })

  it('should return false when the range is too short', () => {
    const target = new SkipTarget({ startTime: 10, endTime: 20 })
    expect(shouldAutoSkipOp(target, 10, false)).toBe(false)
  })

  it('should return false when the range is too long', () => {
    const target = new SkipTarget({ startTime: 10, endTime: 250 })
    expect(shouldAutoSkipOp(target, 10, false)).toBe(false)
  })

  it('should return false when closed', () => {
    const target = new SkipTarget({ startTime: 10, endTime: 90 })
    target.close()
    expect(shouldAutoSkipOp(target, 10, false)).toBe(false)
  })

  it('should return false when already auto skipped', () => {
    const target = new SkipTarget({ startTime: 10, endTime: 90 })
    expect(shouldAutoSkipOp(target, 10, true)).toBe(false)
  })

  it('should return false when current time equals end time', () => {
    const target = new SkipTarget({ startTime: 10, endTime: 90 })
    expect(shouldAutoSkipOp(target, 90, false)).toBe(false)
  })
})

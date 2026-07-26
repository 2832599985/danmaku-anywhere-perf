import { describe, expect, it } from 'vitest'
import {
  calculateFrameProcessingDelay,
  calculateInterpolationDimensions,
  classifyDifferenceStats,
  computeMaxInterpolationFactor,
  isMediaTimelineDiscontinuity,
  resolveInterpolationFactor,
  shouldInterpolateInterval,
} from './frame-interpolator'

describe('frame interpolation helpers', () => {
  it('fits common sources to the selected 16-pixel-aligned model size', () => {
    expect(
      calculateInterpolationDimensions({ width: 1920, height: 1080 }, '720p')
    ).toEqual({ width: 1280, height: 720 })
    expect(
      calculateInterpolationDimensions({ width: 854, height: 480 }, '480p')
    ).toEqual({ width: 848, height: 480 })
  })

  it('does not upscale a source before interpolation', () => {
    expect(
      calculateInterpolationDimensions({ width: 640, height: 360 }, '720p')
    ).toEqual({ width: 640, height: 352 })
  })

  it('detects repeated frames and scene cuts using Framegen thresholds', () => {
    expect(classifyDifferenceStats(1000, 20, 1296)).toMatchObject({
      duplicate: true,
      sceneCut: false,
    })
    expect(classifyDifferenceStats(1296 * 100, 300, 1296)).toMatchObject({
      duplicate: false,
      sceneCut: true,
    })
  })

  it('targets 24-30 fps sources and bypasses already-high frame rates', () => {
    expect(shouldInterpolateInterval(1000 / 24)).toBe(true)
    expect(shouldInterpolateInterval(1000 / 30)).toBe(true)
    expect(shouldInterpolateInterval(1000 / 60)).toBe(false)
  })

  it('keeps the processing lead near one source-frame of visible latency', () => {
    expect(calculateFrameProcessingDelay(1000 / 30)).toBeCloseTo(24.67, 1)
    expect(calculateFrameProcessingDelay(1000 / 24)).toBeCloseTo(28.83, 1)
  })

  it('detects seeks without treating ordinary dropped frames as a seek', () => {
    const sample = {
      previousMediaTime: 10,
      mediaTime: 10 + 3 / 30,
      previousExpectedDisplayTime: 1_000,
      expectedDisplayTime: 1_100,
      intervalMs: 1000 / 30,
      playbackRate: 1,
    }
    expect(
      isMediaTimelineDiscontinuity({
        ...sample,
        previousMediaTime: null,
      })
    ).toBe(false)
    expect(isMediaTimelineDiscontinuity(sample)).toBe(false)
    expect(isMediaTimelineDiscontinuity({ ...sample, mediaTime: 9 })).toBe(true)
    expect(isMediaTimelineDiscontinuity({ ...sample, mediaTime: 11 })).toBe(
      true
    )
    expect(
      isMediaTimelineDiscontinuity({
        ...sample,
        expectedDisplayTime: 999,
      })
    ).toBe(true)
  })

  it('normalizes media-time continuity for playback speed', () => {
    const base = {
      previousMediaTime: 10,
      previousExpectedDisplayTime: 1_000,
      intervalMs: 1000 / 30,
    }
    expect(
      isMediaTimelineDiscontinuity({
        ...base,
        mediaTime: 10 + 2 / 30,
        expectedDisplayTime: 1_000 + 1_000 / 30,
        playbackRate: 2,
      })
    ).toBe(false)
    expect(
      isMediaTimelineDiscontinuity({
        ...base,
        mediaTime: 10 + 0.5 / 30,
        expectedDisplayTime: 1_000 + 1_000 / 30,
        playbackRate: 0.5,
      })
    ).toBe(false)
  })
})

describe('interpolation factor selection', () => {
  it('defaults to 2x when neither multiplier nor targetFps is set', () => {
    expect(resolveInterpolationFactor({}, 24)).toBe(2)
    expect(computeMaxInterpolationFactor({})).toBe(2)
  })

  it('uses an explicit multiplier verbatim, clamped to [2, cap]', () => {
    expect(resolveInterpolationFactor({ multiplier: 3 }, 24)).toBe(3)
    expect(resolveInterpolationFactor({ multiplier: 4 }, 30)).toBe(4)
    expect(resolveInterpolationFactor({ multiplier: 1 }, 24)).toBe(2)
    expect(resolveInterpolationFactor({ multiplier: 99 }, 24, 4)).toBe(4)
  })

  it('derives the factor from targetFps and the live source fps', () => {
    // 24fps source -> 60fps ~ 2.5 -> rounds to 3; -> 120 -> 5
    expect(resolveInterpolationFactor({ targetFps: 60 }, 24)).toBe(3)
    expect(resolveInterpolationFactor({ targetFps: 120 }, 24)).toBe(5)
    // 30fps source -> 60 -> exactly 2
    expect(resolveInterpolationFactor({ targetFps: 60 }, 30)).toBe(2)
    // 170Hz target on a 24fps source approaches 7x
    expect(resolveInterpolationFactor({ targetFps: 170 }, 24)).toBe(7)
  })

  it('never returns less than 2 and respects the cap for targetFps', () => {
    expect(resolveInterpolationFactor({ targetFps: 60 }, 120)).toBe(2)
    expect(resolveInterpolationFactor({ targetFps: 170 }, 24, 4)).toBe(4)
  })

  it('sizes the max factor against the lowest expected source fps', () => {
    // targetFps sizing assumes a 20fps floor -> 170/20 = 8.5 -> ceil 9 -> cap 8
    expect(computeMaxInterpolationFactor({ targetFps: 170 })).toBe(8)
    expect(computeMaxInterpolationFactor({ targetFps: 60 })).toBe(3)
    expect(computeMaxInterpolationFactor({ multiplier: 4 })).toBe(4)
  })
})

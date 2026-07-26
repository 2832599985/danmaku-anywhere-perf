import { describe, expect, it } from 'vitest'
import {
  calculateFrameProcessingDelay,
  calculateInterpolationDimensions,
  classifyDifferenceStats,
  computeMaxInterpolationFactor,
  computeResolutionFactorCap,
  type InterpolationOverloadState,
  isMediaTimelineDiscontinuity,
  resolveInterpolationFactor,
  shouldInterpolateInterval,
  updateInterpolationOverload,
} from './frame-interpolator'

describe('frame interpolation helpers', () => {
  it('fits common sources to the selected 16-pixel-aligned model size', () => {
    expect(
      calculateInterpolationDimensions({ width: 1920, height: 1080 }, '720p')
    ).toEqual({ width: 1280, height: 720 })
    expect(
      calculateInterpolationDimensions({ width: 854, height: 480 }, '480p')
    ).toEqual({ width: 848, height: 480 })
    expect(
      calculateInterpolationDimensions({ width: 1920, height: 1080 }, '1080p')
    ).toEqual({ width: 1904, height: 1072 })
    expect(
      calculateInterpolationDimensions({ width: 3840, height: 2160 }, '1080p')
    ).toEqual({ width: 1904, height: 1072 })
  })

  it('picks the 16-aligned width that best preserves the source aspect', () => {
    // 360 floors to 352; keeping width at 640 would squash the picture by 2.2%.
    const dims = calculateInterpolationDimensions(
      { width: 640, height: 360 },
      '720p'
    )
    expect(dims).toEqual({ width: 624, height: 352 })
    const sourceAspect = 640 / 360
    expect(Math.abs(dims.width / dims.height - sourceAspect)).toBeLessThan(
      Math.abs(640 / dims.height - sourceAspect)
    )
  })

  it('does not upscale a source before interpolation', () => {
    const dims = calculateInterpolationDimensions(
      { width: 640, height: 360 },
      '720p'
    )
    expect(dims.height).toBeLessThanOrEqual(360)
    expect(dims.width).toBeLessThanOrEqual(640)
  })

  it('caps the interpolation factor by processing resolution', () => {
    // (factor - 1) x pixels is the real cost: 720p sustains the full 8x,
    // 1080p must fall back to 4x, and 480p is never the limiting factor.
    expect(computeResolutionFactorCap({ width: 1280, height: 720 })).toBe(8)
    expect(computeResolutionFactorCap({ width: 1904, height: 1072 })).toBe(4)
    expect(computeResolutionFactorCap({ width: 848, height: 480 })).toBe(8)
    // never below 2 (interpolation would be pointless) even for huge frames
    expect(computeResolutionFactorCap({ width: 7680, height: 4320 })).toBe(2)
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

describe('interpolation overload guard', () => {
  const idle: InterpolationOverloadState = { lateSamples: 0, bypassUntil: 0 }
  const runLate = (
    state: InterpolationOverloadState,
    times: number,
    startAt = 0
  ) => {
    let next = state
    for (let i = 0; i < times; i++) {
      next = updateInterpolationOverload(next, 'late', startAt + i * 10)
    }
    return next
  }

  it('bypasses interpolation only after three consecutive late pairs', () => {
    let state = updateInterpolationOverload(idle, 'late', 1_000)
    expect(state).toEqual({ lateSamples: 1, bypassUntil: 0 })
    state = updateInterpolationOverload(state, 'late', 1_010)
    expect(state).toEqual({ lateSamples: 2, bypassUntil: 0 })
    state = updateInterpolationOverload(state, 'late', 1_020)
    expect(state).toEqual({ lateSamples: 0, bypassUntil: 3_020 })
  })

  it('lets a timely pair decay the accumulated evidence', () => {
    let state = runLate(idle, 2)
    state = updateInterpolationOverload(state, 'timely', 30)
    expect(state.lateSamples).toBe(1)
    // one more late pair is not enough — the decay really counted
    state = updateInterpolationOverload(state, 'late', 40)
    expect(state.bypassUntil).toBe(0)
    state = updateInterpolationOverload(state, 'late', 50)
    expect(state.bypassUntil).toBe(2_050)
  })

  it('never drops the late counter below zero', () => {
    let state = idle
    for (let i = 0; i < 5; i++) {
      state = updateInterpolationOverload(state, 'timely', i)
    }
    expect(state.lateSamples).toBe(0)
  })

  it('does not latch: one hitch cannot keep interpolation bypassed', () => {
    // Regression for the decaying cost average, which was still above the
    // threshold when the bypass expired and so re-armed after ~3 pairs,
    // leaving interpolation effectively off for the rest of the session.
    let state = runLate(idle, 3)
    const firstBypass = state.bypassUntil
    expect(firstBypass).toBe(2_020)
    // arming must clear the evidence, not carry it into the next window
    expect(state.lateSamples).toBe(0)

    // after the window, a single late pair must not re-arm the bypass
    state = updateInterpolationOverload(state, 'late', 3_000)
    expect(state.bypassUntil).toBe(firstBypass)

    // and a healthy stream keeps it off for good
    for (let i = 0; i < 10; i++) {
      state = updateInterpolationOverload(state, 'timely', 3_100 + i)
    }
    expect(state).toEqual({ lateSamples: 0, bypassUntil: firstBypass })
  })

  it('honours a custom threshold and bypass window', () => {
    expect(
      updateInterpolationOverload(idle, 'late', 500, {
        threshold: 1,
        bypassMs: 50,
      })
    ).toEqual({ lateSamples: 0, bypassUntil: 550 })
  })
})

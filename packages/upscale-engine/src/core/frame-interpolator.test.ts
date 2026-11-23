import { describe, expect, it } from 'vitest'
import {
  calculateFrameProcessingDelay,
  calculateInterpolationDimensions,
  classifyThumbnailDifference,
  computeMaxInterpolationFactor,
  computeResolutionFactorCap,
  createInterpolationOverloadState,
  type InterpolationOverloadState,
  isMediaTimelineDiscontinuity,
  resolveInterpolationFactor,
  shouldInterpolateInterval,
  updateInterpolationOverload,
} from './frame-interpolator'

/** Build a 160x90 RGBA thumbnail filled with one grey level. */
const flatThumbnail = (value: number) => {
  const data = new Uint8ClampedArray(160 * 90 * 4)
  data.fill(value)
  return data
}

/** Same, but with `changed` pixels set to a different level. */
const thumbnailWithChange = (
  base: number,
  changed: number,
  count: number,
  step = 3
) => {
  const data = flatThumbnail(base)
  for (let i = 0; i < count; i++) {
    const offset = (i * step * 4) % data.length
    data[offset] = changed
    data[offset + 1] = changed
    data[offset + 2] = changed
  }
  return data
}

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

  it('targets 24-30 fps sources and bypasses already-high frame rates', () => {
    expect(shouldInterpolateInterval(1000 / 24)).toBe(true)
    expect(shouldInterpolateInterval(1000 / 30)).toBe(true)
    expect(shouldInterpolateInterval(1000 / 60)).toBe(false)
  })

  it('leaves room for the first sub-frame of every factor', () => {
    // The first sub-frame sits (1 - 1/factor) of a source interval before the
    // current frame's slot, so a factor-3 request needs two thirds of an
    // interval of budget. The old flat interval/2 left 3x and 4x permanently
    // late — measured slack at 3x was -0.7 ms.
    expect(calculateFrameProcessingDelay(1000 / 30, 2)).toBeCloseTo(28.67, 1)
    expect(calculateFrameProcessingDelay(1000 / 24, 2)).toBeCloseTo(32.83, 1)
    expect(calculateFrameProcessingDelay(1000 / 24, 3)).toBeCloseTo(39.78, 1)
    expect(calculateFrameProcessingDelay(1000 / 24, 4)).toBeCloseTo(43.25, 1)
    // ...and stays within the display-latency budget at every factor
    for (const factor of [2, 3, 4, 6, 8]) {
      const delay = calculateFrameProcessingDelay(1000 / 24, factor)
      expect(delay).toBeGreaterThanOrEqual(20)
      expect(delay).toBeLessThanOrEqual(50)
      expect(delay).toBeGreaterThanOrEqual(
        calculateFrameProcessingDelay(1000 / 24, Math.max(2, factor - 1))
      )
    }
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

describe('repeat and scene-cut classification', () => {
  it('calls an unchanged drawing a repeat', () => {
    const previous = flatThumbnail(120)
    expect(classifyThumbnailDifference(previous, flatThumbnail(120))).toEqual({
      duplicate: true,
      sceneCut: false,
      mean: 0,
      maximum: 0,
    })
  })

  it('tolerates codec noise and film grain on a held drawing', () => {
    // Measured on 1080p anime in the real WebView2: a held pair never exceeded
    // 7 (summed over RGB), while any real drawing change started at 189.
    expect(
      classifyThumbnailDifference(flatThumbnail(120), flatThumbnail(122))
        .duplicate
    ).toBe(true)
    // A few hundred pixels drifting by +-2 per channel is still the same
    // drawing; the same pixels moving by 40 are not.
    const grain = thumbnailWithChange(120, 122, 400)
    expect(
      classifyThumbnailDifference(flatThumbnail(120), grain).duplicate
    ).toBe(true)
  })

  it('does not call a real drawing change a repeat', () => {
    const previous = flatThumbnail(120)
    // A mouth opening: a handful of pixels moving a long way.
    const changed = thumbnailWithChange(120, 160, 60)
    const result = classifyThumbnailDifference(previous, changed)
    expect(result.duplicate).toBe(false)
    expect(result.maximum).toBe(120)
    expect(result.sceneCut).toBe(false)
  })

  it('flags a cut between shots, where the whole frame changes at once', () => {
    const previous = flatThumbnail(10)
    const next = flatThumbnail(200)
    const result = classifyThumbnailDifference(previous, next)
    expect(result.duplicate).toBe(false)
    expect(result.sceneCut).toBe(true)
    expect(result.mean).toBeCloseTo(190, 0)
  })

  it('treats a missing thumbnail or a length mismatch as a change', () => {
    // A false "changed" only costs GPU work; a false "held" would freeze a
    // frame, so every unknown must fall on the changed side.
    const previous = flatThumbnail(120)
    const mismatched = new Uint8ClampedArray(16)
    expect(classifyThumbnailDifference(previous, mismatched)).toMatchObject({
      duplicate: false,
      sceneCut: false,
    })
    expect(classifyThumbnailDifference(previous, previous)).toMatchObject({
      duplicate: true,
    })
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
  const run = (
    state: InterpolationOverloadState,
    outcome: 'late' | 'timely',
    times: number,
    startAt = 0,
    maxFactor = 4
  ) => {
    let next = state
    for (let i = 0; i < times; i++) {
      next = updateInterpolationOverload(next, outcome, startAt + i * 10, {
        maxFactor,
      })
    }
    return next
  }

  it('starts at the configured factor ceiling', () => {
    expect(createInterpolationOverloadState(4)).toEqual({
      lateSamples: 0,
      timelySamples: 0,
      factorCeiling: 4,
      bypassUntil: 0,
    })
    expect(createInterpolationOverloadState(1).factorCeiling).toBe(2)
  })

  it('degrades one factor step at a time instead of switching off', () => {
    // The old guard armed a 2-second full bypass after three late pairs, which
    // on a loaded-but-idle GPU burned 86 of 204 pairs interpolating nothing.
    let state = createInterpolationOverloadState(4)
    state = run(state, 'late', 2)
    expect(state.factorCeiling).toBe(4)
    state = run(state, 'late', 1, 20)
    expect(state.factorCeiling).toBe(3)
    expect(state.bypassUntil).toBe(0)
    state = run(state, 'late', 3, 40)
    expect(state.factorCeiling).toBe(2)
    expect(state.bypassUntil).toBe(0)
  })

  it('bypasses only when even 2x cannot keep up', () => {
    let state = run(createInterpolationOverloadState(4), 'late', 6)
    expect(state.factorCeiling).toBe(2)
    state = run(state, 'late', 3, 100)
    expect(state.bypassUntil).toBe(100 + 20 + 600)
  })

  it('gives the factor back after a sustained healthy stretch', () => {
    let state = run(createInterpolationOverloadState(4), 'late', 3)
    expect(state.factorCeiling).toBe(3)
    // A single timely pair must not immediately restore the request — that is
    // the oscillation the ceiling exists to prevent.
    state = updateInterpolationOverload(state, 'timely', 100, { maxFactor: 4 })
    expect(state.factorCeiling).toBe(3)
    state = run(state, 'timely', 58, 200)
    expect(state.factorCeiling).toBe(3)
    state = updateInterpolationOverload(state, 'timely', 900, { maxFactor: 4 })
    expect(state.factorCeiling).toBe(4)
    expect(state.timelySamples).toBe(0)
  })

  it('never climbs past the configured ceiling or below 2x', () => {
    let state = createInterpolationOverloadState(2)
    state = run(state, 'timely', 500, 0, 2)
    expect(state.factorCeiling).toBe(2)
    state = run(state, 'late', 500, 0, 2)
    expect(state.factorCeiling).toBe(2)
    // every 3rd late pair re-arms the bypass, so the ceiling never moves below 2
    expect(state.bypassUntil).toBeGreaterThan(0)
  })

  it('never drops the late counter below zero', () => {
    let state = createInterpolationOverloadState(2)
    for (let i = 0; i < 5; i++) {
      state = updateInterpolationOverload(state, 'timely', i, { maxFactor: 2 })
    }
    expect(state.lateSamples).toBe(0)
  })

  it('lets one timely pair decay the accumulated late evidence', () => {
    let state = run(createInterpolationOverloadState(4), 'late', 2)
    expect(state.lateSamples).toBe(2)
    state = updateInterpolationOverload(state, 'timely', 30, { maxFactor: 4 })
    expect(state.lateSamples).toBe(1)
    expect(state.factorCeiling).toBe(4)
  })
})

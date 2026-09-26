import { describe, expect, it } from 'vitest'
import { computeOutputRate } from './outputRate'

/**
 * These cases are the measured behaviour of the real exe (24fps source,
 * 2560x1440 @ 170Hz display). The HUD must report the rate the user SEES, so
 * interpolation off must read ~24 and 2x must read ~47 — never 170, which is
 * the canvas swap cadence.
 */
describe('computeOutputRate', () => {
  const window = { seconds: 1 }

  it('reports the source rate when interpolation is off', () => {
    // Interpolation off: 24 source frames, nothing generated, ~170 presents.
    const rate = computeOutputRate({
      ...window,
      sourceFrames: 24,
      generatedFrames: 0,
      presentedFrames: 170,
    })
    expect(rate).toEqual({ fps: 24, sourceFps: 24, generatedFps: 0 })
  })

  it('adds the generated frames for 2x interpolation', () => {
    const rate = computeOutputRate({
      ...window,
      sourceFrames: 24,
      generatedFrames: 23,
      presentedFrames: 176,
    })
    expect(rate).toEqual({ fps: 47, sourceFps: 24, generatedFps: 23 })
  })

  it('adds the generated frames for 4x interpolation', () => {
    const rate = computeOutputRate({
      ...window,
      sourceFrames: 24,
      generatedFrames: 36,
      presentedFrames: 175,
    })
    expect(rate).toEqual({ fps: 60, sourceFps: 24, generatedFps: 36 })
  })

  it('never reports the present cadence as the frame rate', () => {
    // The regression this guards: presentedFrames alone (170) was the HUD.
    const rate = computeOutputRate({
      ...window,
      sourceFrames: 24,
      generatedFrames: 0,
      presentedFrames: 170,
    })
    expect(rate.fps).toBeLessThan(170)
  })

  it('caps the total at the present rate', () => {
    // A 4x request on a 24fps source wants 96/s, but the canvas is only
    // presented 60 times a second, so 60 distinct frames is all that can show.
    const rate = computeOutputRate({
      ...window,
      sourceFrames: 24,
      generatedFrames: 72,
      presentedFrames: 60,
    })
    expect(rate.fps).toBe(60)
    // The breakdown still reports what was produced, so a user can see the cap.
    expect(rate.sourceFps).toBe(24)
    expect(rate.generatedFps).toBe(72)
  })

  it('falls back to the computed total when no presents are recorded', () => {
    // The rVFC path never runs the presentation loop, so presentedFrames is 0.
    const rate = computeOutputRate({
      ...window,
      sourceFrames: 24,
      generatedFrames: 23,
      presentedFrames: 0,
    })
    expect(rate.fps).toBe(47)
  })

  it('reports nothing rather than NaN for an empty window', () => {
    const rate = computeOutputRate({
      seconds: 0,
      sourceFrames: 0,
      generatedFrames: 0,
      presentedFrames: 0,
    })
    expect(rate).toEqual({ fps: 0, sourceFps: 0, generatedFps: 0 })
  })

  it('scales with a window longer than a second', () => {
    const rate = computeOutputRate({
      seconds: 2,
      sourceFrames: 48,
      generatedFrames: 46,
      presentedFrames: 352,
    })
    expect(rate).toEqual({ fps: 47, sourceFps: 24, generatedFps: 23 })
  })
})

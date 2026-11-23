import { describe, expect, it } from 'vitest'
import { computeOutputRate } from './outputRate'

/**
 * These cases are the measured behaviour of the real exe: a 24 fps anime source
 * drawn on twos (so ~12 distinct drawings a second) on a 170 Hz display, at
 * 2560x1440. The HUD must report the rate the user SEES — never 170, which was
 * the canvas swap cadence when the presentation loop re-submitted the same
 * texture every rAF turn.
 */
describe('computeOutputRate', () => {
  const window = { seconds: 1 }

  it('reports the source rate when interpolation is off', () => {
    // Anime on twos, interpolation off: 24 captured frames, 12 distinct
    // drawings, all 12 presented, nothing generated.
    const rate = computeOutputRate({
      ...window,
      presentedFrames: 12,
      presentedGeneratedFrames: 0,
    })
    expect(rate).toEqual({ fps: 12, sourceFps: 12, generatedFps: 0 })
  })

  it('adds the generated frames for 2x interpolation', () => {
    const rate = computeOutputRate({
      ...window,
      presentedFrames: 24,
      presentedGeneratedFrames: 12,
    })
    expect(rate).toEqual({ fps: 24, sourceFps: 12, generatedFps: 12 })
  })

  it('adds the generated frames for 4x interpolation', () => {
    const rate = computeOutputRate({
      ...window,
      presentedFrames: 48,
      presentedGeneratedFrames: 36,
    })
    expect(rate).toEqual({ fps: 48, sourceFps: 12, generatedFps: 36 })
  })

  it('never reports the display refresh as the frame rate', () => {
    // The regression this guards: the canvas used to be re-submitted on every
    // rAF turn, so the present counter read 170 whether anything was rendering
    // or not. The engine now only submits distinct frames, and this is the
    // number that would have been shown.
    const rate = computeOutputRate({
      ...window,
      presentedFrames: 12,
      presentedGeneratedFrames: 0,
    })
    expect(rate.fps).toBeLessThan(170)
  })

  it('breaks the total down so the parts add up to it', () => {
    const rate = computeOutputRate({
      ...window,
      presentedFrames: 47,
      presentedGeneratedFrames: 23,
    })
    expect(rate.fps).toBe(47)
    expect(rate.sourceFps + rate.generatedFps).toBe(rate.fps)
  })

  it('clamps a generated split that exceeds the total', () => {
    // A renderer rebuilt mid-window can report a generated count larger than
    // the presents it belongs to. The breakdown must stay a breakdown.
    const rate = computeOutputRate({
      ...window,
      presentedFrames: 10,
      presentedGeneratedFrames: 40,
    })
    expect(rate).toEqual({ fps: 10, sourceFps: 0, generatedFps: 10 })
  })

  it('reports nothing rather than NaN for an empty window', () => {
    const rate = computeOutputRate({
      seconds: 0,
      presentedFrames: 0,
      presentedGeneratedFrames: 0,
    })
    expect(rate).toEqual({ fps: 0, sourceFps: 0, generatedFps: 0 })
  })

  it('reports zero for a stalled renderer', () => {
    const rate = computeOutputRate({
      ...window,
      presentedFrames: 0,
      presentedGeneratedFrames: 0,
    })
    expect(rate).toEqual({ fps: 0, sourceFps: 0, generatedFps: 0 })
  })

  it('scales with a window longer than a second', () => {
    const rate = computeOutputRate({
      seconds: 2,
      presentedFrames: 94,
      presentedGeneratedFrames: 46,
    })
    expect(rate).toEqual({ fps: 47, sourceFps: 24, generatedFps: 23 })
  })

  it('reports the drawings shown, not the frames captured', () => {
    // Measured on the real exe, anime on twos with held frames elided: 202
    // frames captured in 8s, but only 61 distinct drawings were presented plus
    // 61 generated sub-frames. The captured count (25/s) must not be reported
    // as the source rate — the viewer never saw those frames.
    const rate = computeOutputRate({
      seconds: 8,
      presentedFrames: 122,
      presentedGeneratedFrames: 61,
    })
    expect(rate.fps).toBe(15)
    expect(rate.generatedFps).toBe(8)
    expect(rate.sourceFps).toBe(7)
    expect(rate.sourceFps + rate.generatedFps).toBe(rate.fps)
  })
})

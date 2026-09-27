/**
 * The frame-rate arithmetic behind the upscale HUD.
 *
 * Kept pure and separate because this is where the HUD went wrong before: it
 * used the engine's `presentedFrames` counter, which at the time incremented on
 * every rAF turn that re-submitted the same texture. That is a *swap cadence*,
 * so it tracked the display refresh (170 on the dev machine) and read the same
 * whether interpolation was on, off, or failing — it was not a frame rate at
 * all.
 *
 * What the viewer sees is the frames the engine actually swapped onto the
 * canvas, and the engine reports those split by origin: `presentedFrames` is
 * the total and `presentedGeneratedFrames` the part that came out of the model.
 * Deriving the split from the *captured* counts instead would be wrong on real
 * anime — 50-70% of source frames are repeats of the drawing already on screen
 * and are never presented, so a 24 fps file shows about 12 distinct drawings a
 * second and the captured frame count says nothing about the shown rate.
 */

export interface OutputRateInput {
  /** Distinct frames the engine swapped onto the canvas in the window. */
  presentedFrames: number
  /** Of those, the ones the interpolation model synthesized. */
  presentedGeneratedFrames: number
  /** Length of the window in seconds. */
  seconds: number
}

export interface OutputRate {
  /** True on-screen frame rate: the distinct frames actually shown. */
  fps: number
  /**
   * The base rate the interpolation multiplies: distinct source *drawings*
   * shown per second. On anime drawn on twos a 24 fps file reads ~12 here, and
   * that is the number the 2x/3x factor applies to.
   */
  sourceFps: number
  /** Interpolated frames per second (0 when interpolation is off). */
  generatedFps: number
}

export const computeOutputRate = ({
  presentedFrames,
  presentedGeneratedFrames,
  seconds,
}: OutputRateInput): OutputRate => {
  // A zero/negative window would divide by zero; report nothing rather than NaN.
  if (!(seconds > 0)) return { fps: 0, sourceFps: 0, generatedFps: 0 }
  const fps = presentedFrames / seconds
  // Clamp: the split can never exceed the total it is a part of, whatever the
  // counters say after a renderer rebuild mid-window.
  const generatedFps = Math.min(presentedGeneratedFrames / seconds, fps)
  const roundedGenerated = Math.round(generatedFps)
  const roundedFps = Math.round(fps)
  return {
    fps: roundedFps,
    // Derived by subtraction so the breakdown always adds up to the total.
    sourceFps: Math.max(0, roundedFps - roundedGenerated),
    generatedFps: roundedGenerated,
  }
}

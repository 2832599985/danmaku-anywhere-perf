/**
 * The frame-rate arithmetic behind the upscale HUD.
 *
 * Kept pure and separate because this is where the HUD went wrong before: it
 * used the engine's `presentedFrames` counter, which increments on every rAF
 * turn that swaps the canvas. That is a *swap cadence*, so it tracks the
 * display refresh (170 on the dev machine) and reads the same whether
 * interpolation is on, off, or failing — it is not a frame rate at all.
 *
 * The number a user reads must be the rate they SEE: the source frames plus
 * the interpolated sub-frames the engine produced. That total can never exceed
 * how often the canvas was actually presented, hence the cap.
 */

export interface OutputRateInput {
  /** Source-video frames counted in the window (rVFC callbacks). */
  sourceFrames: number
  /** Interpolated frames the engine produced in the window. */
  generatedFrames: number
  /** Canvas presents in the window (the swap cadence, = refresh rate). */
  presentedFrames: number
  /** Length of the window in seconds. */
  seconds: number
}

export interface OutputRate {
  /** True on-screen frame rate: source + generated, capped by presents. */
  fps: number
  /** Source-video rate on its own (what the file carries). */
  sourceFps: number
  /** Interpolated frames per second (0 when interpolation is off). */
  generatedFps: number
}

export const computeOutputRate = ({
  sourceFrames,
  generatedFrames,
  presentedFrames,
  seconds,
}: OutputRateInput): OutputRate => {
  // A zero/negative window would divide by zero; report nothing rather than NaN.
  if (!(seconds > 0)) return { fps: 0, sourceFps: 0, generatedFps: 0 }
  const sourceFps = sourceFrames / seconds
  const generatedFps = generatedFrames / seconds
  const outputFps = sourceFps + generatedFps
  const presentedFps = presentedFrames / seconds
  // No presents recorded (the rVFC path never runs the presentation loop) —
  // the computed total is all we know.
  const fps = presentedFps > 0 ? Math.min(outputFps, presentedFps) : outputFps
  return {
    fps: Math.round(fps),
    sourceFps: Math.round(sourceFps),
    generatedFps: Math.round(generatedFps),
  }
}

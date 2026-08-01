import {
  type Dimensions,
  type EnhancementEffect,
  type FrameInterpolationOptions,
  Renderer,
  resolveEffectChain,
  waitForVideoReady,
} from '@danmaku-anywhere/upscale-engine'
import {
  MODE_ID_TO_BASE_MODE,
  type TargetResolution,
  type UpscaleSettings,
} from '@/store/settings'

// The weights are served as `.dat`, not `.bin`: some Windows security/web
// filters silently block in-browser downloads of `.bin` files (returning an
// empty 204), which would starve Framegen. The bytes are identical.
const FRAMEGEN_BIN_URL = `${import.meta.env.BASE_URL}assets/framegen/rt_v7s.dat`
const FRAMEGEN_MANIFEST_URL = `${import.meta.env.BASE_URL}assets/framegen/rt_v7s.json`

export type UpscaleStatus = 'idle' | 'initializing' | 'active' | 'error'
export type InterpolationStatus = 'off' | 'active' | 'fallback'

/** Per-report HUD numbers derived from the engine's diagnostics summary. */
export interface UpscaleStatsReport {
  fps: number
  cpuFrameMs: number
  generatedFps: number
}

export interface UpscaleControllerCallbacks {
  onStatus?: (status: UpscaleStatus, error?: string | null) => void
  onInterpolationStatus?: (status: InterpolationStatus) => void
  /** ~1s cadence while rendering; called with null when the renderer stops. */
  onStats?: (stats: UpscaleStatsReport | null) => void
}

/** diagnostics report interval — 1 report/second is plenty for a HUD. */
const DIAGNOSTICS_INTERVAL_MS = 1000

const computeTargetDimensions = (
  video: HTMLVideoElement,
  target: TargetResolution
): Dimensions => {
  const srcW = Math.max(1, video.videoWidth || video.clientWidth || 1)
  const srcH = Math.max(1, video.videoHeight || video.clientHeight || 1)
  switch (target) {
    case 'x2':
      return { width: srcW * 2, height: srcH * 2 }
    case 'x4':
      return { width: srcW * 4, height: srcH * 4 }
    case 'x8':
      return { width: srcW * 8, height: srcH * 8 }
    case '720p':
      return { width: 1280, height: 720 }
    case '1080p':
      return { width: 1920, height: 1080 }
    case '2k':
      return { width: 2560, height: 1440 }
    case '4k':
      return { width: 3840, height: 2160 }
    case 'native':
      return { width: srcW, height: srcH }
    default:
      return { width: srcW * 2, height: srcH * 2 }
  }
}

/** Cap the render target at the physical display size (never upsize past it). */
const clampToDisplayBounds = (dims: Dimensions): Dimensions => {
  const dpr = window.devicePixelRatio || 1
  const maxW = Math.round(window.screen.width * dpr)
  const maxH = Math.round(window.screen.height * dpr)
  if (!maxW || !maxH) return dims
  const scale = Math.min(maxW / dims.width, maxH / dims.height)
  if (scale >= 1) return dims
  return {
    width: Math.max(1, Math.round(dims.width * scale)),
    height: Math.max(1, Math.round(dims.height * scale)),
  }
}

const buildEffects = (settings: UpscaleSettings): EnhancementEffect[] =>
  resolveEffectChain(
    MODE_ID_TO_BASE_MODE[settings.modeId],
    settings.performanceTier
  )

const buildFrameInterpolation = (
  settings: UpscaleSettings
): FrameInterpolationOptions => {
  const fi = settings.frameInterpolation
  return {
    enabled: fi.enabled,
    resolution: fi.resolution,
    weightsBinUrl: FRAMEGEN_BIN_URL,
    weightsManifestUrl: FRAMEGEN_MANIFEST_URL,
    // Send only the field the chosen mode uses; the engine prefers `multiplier`
    // when both are present.
    ...(fi.mode === 'targetFps'
      ? { targetFps: fi.targetFps }
      : { multiplier: fi.multiplier }),
  }
}

/**
 * Owns the overlay <canvas> and the upscale-engine Renderer (Anime4K super
 * resolution + optional Framegen 2× interpolation). Ports the extension's
 * Upscale.service.ts glue: target-dimension math, display clamp, canvas overlay,
 * and hide-the-video-behind-the-canvas behavior. Simplified because our <video>
 * fills a known container box, so the canvas can mirror it with plain CSS.
 */
export class UpscaleController {
  private readonly video: HTMLVideoElement
  private readonly container: HTMLElement
  private readonly callbacks: UpscaleControllerCallbacks
  private canvas: HTMLCanvasElement | null = null
  private renderer: Renderer | null = null
  private originalVideoOpacity = ''
  /** monotonic guard so stale async enable/update calls abort */
  private epoch = 0
  private destroyed = false
  /**
   * Serialises apply() calls. Two enables racing on the same canvas is fatal:
   * a canvas's WebGPU context is a singleton, so the loser's destroy()
   * (context.unconfigure()) unconfigures the winner's live context too,
   * crashing its presentation loop ("context is not configured") and nulling
   * the HUD. This happens in practice when persisted upscale.enabled=true meets
   * a fresh open: the open effect and the async HDR-detect effect both fire
   * apply() while this.renderer is still null. Chaining every apply behind this
   * promise means the second call always finds the first's renderer already
   * installed and takes the in-place update path instead of a second create.
   */
  private serial: Promise<void> = Promise.resolve()
  /** cumulative generated-frame count at the last diagnostics report. */
  private lastGeneratedCount = 0
  /** current A/B split ratio, null = compare off. */
  private compareRatio: number | null = null

  constructor(
    video: HTMLVideoElement,
    container: HTMLElement,
    callbacks: UpscaleControllerCallbacks = {}
  ) {
    this.video = video
    this.container = container
    this.callbacks = callbacks
  }

  private supported(): boolean {
    return (
      typeof navigator !== 'undefined' && 'gpu' in navigator && !!navigator.gpu
    )
  }

  private ensureCanvas(): HTMLCanvasElement {
    if (this.canvas) return this.canvas
    const canvas = document.createElement('canvas')
    canvas.dataset.danmakuAnywhereUpscale = 'true'
    canvas.style.position = 'absolute'
    canvas.style.inset = '0'
    canvas.style.width = '100%'
    canvas.style.height = '100%'
    canvas.style.objectFit = 'contain'
    canvas.style.pointerEvents = 'none'
    canvas.style.visibility = 'hidden'
    canvas.style.zIndex = '1'
    this.container.appendChild(canvas)
    this.canvas = canvas
    return canvas
  }

  private showCanvas(): void {
    if (!this.canvas) return
    this.canvas.style.visibility = 'visible'
    this.originalVideoOpacity = this.video.style.opacity
    this.video.style.opacity = '0'
    this.applyCompareSplit()
  }

  /**
   * A/B split: clip the enhanced canvas to the left `ratio` of the frame and
   * let the untouched <video> underneath show through on the right. Purely
   * cosmetic — the renderer keeps running full-frame.
   */
  setCompareRatio(ratio: number | null): void {
    this.compareRatio = ratio
    this.applyCompareSplit()
  }

  private applyCompareSplit(): void {
    if (!this.canvas || this.canvas.style.visibility !== 'visible') return
    if (this.compareRatio === null) {
      this.canvas.style.clipPath = ''
      this.video.style.opacity = '0'
    } else {
      const pct = Math.min(100, Math.max(0, this.compareRatio * 100))
      this.canvas.style.clipPath = `inset(0 ${100 - pct}% 0 0)`
      this.video.style.opacity = this.originalVideoOpacity || '1'
    }
  }

  /** Translate the engine's diagnostics summary into HUD numbers. */
  private reportStats(summary: {
    frames: number
    presentedFrames: number
    averageCpuFrameMs: number
  }): void {
    const seconds = DIAGNOSTICS_INTERVAL_MS / 1000
    const generatedAttr =
      this.canvas?.dataset.danmakuAnywhereFrameInterpolationGenerated
    const generatedTotal = generatedAttr ? Number(generatedAttr) || 0 : 0
    const generatedDelta = Math.max(0, generatedTotal - this.lastGeneratedCount)
    this.lastGeneratedCount = generatedTotal
    // `presentedFrames` counts every frame swapped onto the canvas (rAF-paced,
    // real + interpolated sub-frames) — i.e. the true on-screen rate after
    // interpolation. `frames` only counts source-video rVFC callbacks, so it
    // would report the SOURCE rate (~24) even when we present 120. Fall back
    // to `frames` for the rvfc path where the presentation loop never runs.
    const presented = summary.presentedFrames || summary.frames
    this.callbacks.onStats?.({
      fps: Math.round(presented / seconds),
      cpuFrameMs: summary.averageCpuFrameMs,
      generatedFps: Math.round(generatedDelta / seconds),
    })
  }

  private reportInterpolation(settings: UpscaleSettings): void {
    if (!settings.frameInterpolation.enabled) {
      this.callbacks.onInterpolationStatus?.('off')
      return
    }
    const attr = this.canvas?.getAttribute(
      'data-danmaku-anywhere-frame-interpolation'
    )
    this.callbacks.onInterpolationStatus?.(
      attr === 'fallback' ? 'fallback' : 'active'
    )
  }

  /** Enable / update / disable the renderer according to settings.enabled. */
  async apply(settings: UpscaleSettings): Promise<void> {
    if (this.destroyed) return
    // Disable is synchronous and stays OUT of the queue: it must stop the live
    // renderer immediately and bump the epoch so any in-flight enable aborts.
    if (!settings.enabled) {
      this.disable()
      return
    }
    if (!this.supported()) {
      this.callbacks.onStatus?.('error', 'WebGPU is not available')
      return
    }
    // Chain behind the previous apply so two enables can never run their
    // Renderer.create() concurrently on the same canvas (see `serial`). When
    // the previous call was an enable, this.renderer is installed by the time
    // we run and we take the in-place update path instead of a second create.
    const run = this.serial.then(async () => {
      if (this.destroyed || !settings.enabled) return
      if (this.renderer) await this.update(settings)
      else await this.enable(settings)
    })
    // Keep the chain alive even if a step throws, so later applies aren't
    // stranded behind a rejected promise.
    this.serial = run.catch(() => undefined)
    await run
  }

  private async enable(settings: UpscaleSettings): Promise<void> {
    const epoch = ++this.epoch
    this.callbacks.onStatus?.('initializing')
    try {
      await waitForVideoReady(this.video, this.video.HAVE_METADATA)
      if (this.destroyed || epoch !== this.epoch) return

      const canvas = this.ensureCanvas()
      const targetDimensions = clampToDisplayBounds(
        computeTargetDimensions(this.video, settings.targetResolution)
      )
      canvas.width = targetDimensions.width
      canvas.height = targetDimensions.height

      const renderer = await Renderer.create({
        video: this.video,
        canvas,
        effects: buildEffects(settings),
        targetDimensions,
        frameInterpolation: buildFrameInterpolation(settings),
        presentationMode: 'raf',
        diagnostics: { reportIntervalMs: DIAGNOSTICS_INTERVAL_MS },
        onDiagnostics: (summary) => {
          // Guard on renderer IDENTITY, not the operation epoch. update()
          // bumps this.epoch (to discard stale async update results) but keeps
          // the very same Renderer alive, so an epoch guard here would silently
          // kill the diagnostics stream after the first settings update — the
          // HUD froze / vanished until the next video rebuilt the closure.
          // Identity stays true across updates and only goes false once a fresh
          // enable() replaces this renderer (or it is torn down).
          if (this.renderer === renderer) this.reportStats(summary)
        },
        onFirstFrameRendered: () => {
          if (this.renderer === renderer) this.showCanvas()
        },
        onFrameInterpolationFallback: () => {
          if (this.renderer === renderer) {
            this.callbacks.onInterpolationStatus?.('fallback')
          }
        },
        onError: (error) => {
          // A late error from a renderer that has already been replaced must
          // not disable the live one.
          if (this.renderer !== renderer) return
          this.callbacks.onStatus?.('error', error.message)
          this.disable()
        },
      })

      if (this.destroyed || epoch !== this.epoch) {
        renderer.destroy()
        return
      }
      this.renderer = renderer
      this.callbacks.onStatus?.('active')
      this.reportInterpolation(settings)
    } catch (error) {
      if (epoch !== this.epoch) return
      const message = error instanceof Error ? error.message : String(error)
      this.callbacks.onStatus?.('error', message)
      this.teardown()
    }
  }

  private async update(settings: UpscaleSettings): Promise<void> {
    if (!this.renderer) return
    const epoch = ++this.epoch
    try {
      const targetDimensions = clampToDisplayBounds(
        computeTargetDimensions(this.video, settings.targetResolution)
      )
      if (this.canvas) {
        this.canvas.width = targetDimensions.width
        this.canvas.height = targetDimensions.height
      }
      await this.renderer.updateConfiguration({
        effects: buildEffects(settings),
        targetDimensions,
        frameInterpolation: buildFrameInterpolation(settings),
      })
      if (this.destroyed || epoch !== this.epoch) return
      this.callbacks.onStatus?.('active')
      this.reportInterpolation(settings)
    } catch (error) {
      if (epoch !== this.epoch) return
      const message = error instanceof Error ? error.message : String(error)
      this.callbacks.onStatus?.('error', message)
    }
  }

  private teardown(): void {
    this.renderer?.destroy()
    this.renderer = null
    if (this.canvas) {
      this.canvas.remove()
      this.canvas = null
    }
    this.video.style.opacity = this.originalVideoOpacity
    this.lastGeneratedCount = 0
    this.callbacks.onStats?.(null)
  }

  /** Turn upscaling off but keep the controller reusable. */
  disable(): void {
    this.epoch++
    this.teardown()
    this.callbacks.onStatus?.('idle')
    this.callbacks.onInterpolationStatus?.('off')
  }

  /** Drop the renderer so the next apply() rebuilds against fresh media. */
  reset(): void {
    this.epoch++
    this.teardown()
  }

  destroy(): void {
    this.destroyed = true
    this.epoch++
    this.teardown()
  }
}

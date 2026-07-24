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

export interface UpscaleControllerCallbacks {
  onStatus?: (status: UpscaleStatus, error?: string | null) => void
  onInterpolationStatus?: (status: InterpolationStatus) => void
}

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
): FrameInterpolationOptions => ({
  enabled: settings.frameInterpolation.enabled,
  resolution: settings.frameInterpolation.resolution,
  weightsBinUrl: FRAMEGEN_BIN_URL,
  weightsManifestUrl: FRAMEGEN_MANIFEST_URL,
})

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
    if (!settings.enabled) {
      this.disable()
      return
    }
    if (!this.supported()) {
      this.callbacks.onStatus?.('error', 'WebGPU is not available')
      return
    }
    if (this.renderer) {
      await this.update(settings)
    } else {
      await this.enable(settings)
    }
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
        onFirstFrameRendered: () => {
          if (epoch === this.epoch) this.showCanvas()
        },
        onFrameInterpolationFallback: () => {
          this.callbacks.onInterpolationStatus?.('fallback')
        },
        onError: (error) => {
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

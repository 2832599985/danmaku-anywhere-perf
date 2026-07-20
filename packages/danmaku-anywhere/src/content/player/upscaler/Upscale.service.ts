import {
  type Dimensions,
  type EnhancementEffect,
  Renderer,
  type RendererDiagnosticMode,
  type RendererDiagnosticsOptions,
  RendererInitializationError,
  type RendererPresentationMode,
  resolveEffectChain,
  waitForVideoReady,
} from '@danmaku-anywhere/upscale-engine'
import { inject, injectable } from 'inversify'
import { type ILogger, LoggerSymbol } from '@/common/Logger'
import { ExtensionOptionsService } from '@/common/options/extensionOptions/service'
import { chromeRpcClient } from '@/common/rpcClient/background/client'
import { VideoNodeObserverService } from '@/content/player/videoObserver/VideoNodeObserver.service'
import { UpscaleCanvas } from './UpscaleCanvas'

export interface UpscaleOptions {
  enabled: boolean
  targetResolution: number
  targetDimensions?: Dimensions
  effects: EnhancementEffect[]
}

type UpscaleDiagnosticConfig = {
  renderer?: RendererDiagnosticsOptions
  presentationMode: RendererPresentationMode
  showProcessedCanvas: boolean
}

type StoredUpscaleOptions = {
  enabled: boolean
  modeId:
    | 'builtin-mode-a'
    | 'builtin-mode-b'
    | 'builtin-mode-c'
    | 'builtin-mode-aa'
    | 'builtin-mode-bb'
    | 'builtin-mode-ca'
  performanceTier: 'performance' | 'balanced' | 'quality' | 'ultra'
  targetResolution:
    | 'x2'
    | 'x4'
    | 'x8'
    | '720p'
    | '1080p'
    | '2k'
    | '4k'
    | 'native'
  enableCrossOriginFix: boolean
}

const defaultOptions: UpscaleOptions = {
  enabled: false,
  targetResolution: 2,
  effects: [],
}

/**
 * The CORS-mode reload of a cross-origin video was rejected — typically the
 * CDN 403s the anonymous re-request (hotlink protection, cookie-bound or
 * single-use signed URLs). WebGPU cannot read tainted video pixels, so
 * upscaling is impossible on this source.
 */
export class CrossOriginReloadError extends RendererInitializationError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'CrossOriginReloadError'
  }
}

export type UpscaleFailureKind = 'cross-origin' | 'error'

@injectable('Singleton')
export class UpscaleService {
  private renderer: Renderer | undefined
  private canvas: UpscaleCanvas | undefined
  private video: HTMLVideoElement | undefined
  private options = defaultOptions
  private restoreHostTopLayer: (() => void) | undefined
  // Monotonic operation epoch: disable() and applyOptions() bump it, async
  // paths capture it at entry and abort after any await if it moved on. This
  // prevents a stale enable from resurrecting after a rapid toggle-off and
  // an older Renderer.create from clobbering a newer renderer.
  private opEpoch = 0
  private rendererUpdateTail: Promise<void> = Promise.resolve()
  private suspended = false
  private corsRuleActive = false
  private corsFix:
    | { video: HTMLVideoElement; previous: string | null }
    | undefined
  private requestedOptions: StoredUpscaleOptions = {
    enabled: false,
    modeId: 'builtin-mode-a',
    performanceTier: 'balanced',
    targetResolution: 'x2',
    enableCrossOriginFix: false,
  }
  private notifyFailure: ((kind: UpscaleFailureKind) => void) | undefined
  private readonly logger: ILogger

  constructor(
    @inject(VideoNodeObserverService)
    private readonly videoObserver: VideoNodeObserverService,
    @inject(ExtensionOptionsService)
    private readonly extensionOptions: ExtensionOptionsService,
    @inject(LoggerSymbol) logger: ILogger
  ) {
    this.logger = logger.sub('[UpscaleService]')
    this.videoObserver.addEventListener('videoNodeChange', (video) => {
      if (!this.options.enabled) return
      if (this.video === video && this.renderer) {
        void this.renderer.handleSourceResize().catch(() => this.disable())
        return
      }
      void this.applyOptions(this.requestedOptions).catch(() => this.disable())
    })
    this.videoObserver.addEventListener('videoNodeRemove', () => {
      if (this.video && this.video !== this.videoObserver.activeVideo)
        this.disable()
    })
  }

  async enable(
    video = this.videoObserver.activeVideo,
    options: Partial<UpscaleOptions> = {}
  ) {
    return this.enableInternal(++this.opEpoch, video, options)
  }

  /**
   * Cap the render target at the physical screen size (device pixels, aspect
   * preserved). Pixels beyond the display can never be shown — a 2x target on
   * a 1080p source against a 1080p monitor would otherwise compute 4x the
   * pixels for zero visible gain, and that waste is the bulk of the "page
   * feels sluggish while upscaling" cost. Screen size is re-read on every
   * enable/applyOptions/resolution change, so moving the window to a larger
   * monitor picks up the new bound on the next reconfiguration.
   */
  private clampToDisplayBounds(dims: Dimensions): Dimensions {
    const dpr = window.devicePixelRatio || 1
    const maxWidth = Math.round((window.screen?.width ?? 0) * dpr)
    const maxHeight = Math.round((window.screen?.height ?? 0) * dpr)
    // jsdom and exotic embeds report 0 — no reliable bound, leave untouched
    if (!maxWidth || !maxHeight) return dims
    const scale = Math.min(maxWidth / dims.width, maxHeight / dims.height)
    if (scale >= 1) return dims
    return {
      width: Math.max(1, Math.round(dims.width * scale)),
      height: Math.max(1, Math.round(dims.height * scale)),
    }
  }

  private getDiagnosticConfig(): UpscaleDiagnosticConfig {
    const params = new URLSearchParams(location.search)
    const requestedMode = params.get('daUpscaleMode')
    const enabled =
      requestedMode !== null ||
      params.has('daUpscaleFormat') ||
      params.has('daUpscaleEarly') ||
      params.has('daUpscalePresentation') ||
      params.has('daUpscaleView')
    const modes: RendererDiagnosticMode[] = [
      'full',
      'copy-only',
      'canvas-only',
      'freeze-input',
    ]
    const mode = modes.includes(requestedMode as RendererDiagnosticMode)
      ? (requestedMode as RendererDiagnosticMode)
      : 'full'
    return {
      renderer: enabled
        ? {
            mode,
            inputTextureFormat:
              params.get('daUpscaleFormat') === 'rgba8unorm'
                ? 'rgba8unorm'
                : 'rgba16float',
            earlyResubscribe: params.get('daUpscaleEarly') === '1',
          }
        : undefined,
      presentationMode:
        params.get('daUpscalePresentation') === 'rvfc' ? 'rvfc' : 'raf',
      showProcessedCanvas: params.get('daUpscaleView') !== 'video',
    }
  }

  private async enableInternal(
    epoch: number,
    video: HTMLVideoElement | null | undefined,
    options: Partial<UpscaleOptions> = {}
  ) {
    if (epoch !== this.opEpoch || this.suspended) return
    if (!video) throw new RendererInitializationError('No active video element')
    if (!('gpu' in navigator) || !navigator.gpu) {
      throw new RendererInitializationError(
        'WebGPU is not supported by this browser'
      )
    }
    const nextOptions = { ...this.options, ...options, enabled: true }
    if (this.video === video && this.renderer && this.canvas) {
      const renderer = this.renderer
      const canvas = this.canvas
      const width = Math.max(1, video.videoWidth || video.clientWidth)
      const height = Math.max(1, video.videoHeight || video.clientHeight)
      const targetDimensions = this.clampToDisplayBounds(
        nextOptions.targetDimensions ?? {
          width: width * nextOptions.targetResolution,
          height: height * nextOptions.targetResolution,
        }
      )
      await this.queueRendererUpdate(
        epoch,
        renderer,
        canvas,
        nextOptions,
        targetDimensions
      )
      return
    }
    this.teardown()
    this.options = nextOptions
    this.video = video
    const canvas = new UpscaleCanvas(video, this.restoreHostTopLayer)
    this.canvas = canvas
    const width = Math.max(1, video.videoWidth || video.clientWidth)
    const height = Math.max(1, video.videoHeight || video.clientHeight)
    const targetDimensions = this.clampToDisplayBounds(
      this.options.targetDimensions ?? {
        width: width * this.options.targetResolution,
        height: height * this.options.targetResolution,
      }
    )
    canvas.setBufferSize(targetDimensions.width, targetDimensions.height)
    const diagnosticConfig = this.getDiagnosticConfig()
    const renderer = await Renderer.create({
      video,
      canvas: canvas.element,
      effects: this.options.effects,
      targetDimensions,
      presentationMode: diagnosticConfig.presentationMode,
      onFirstFrameRendered: () => {
        if (this.canvas === canvas && diagnosticConfig.showProcessedCanvas)
          canvas.show()
      },
      diagnostics: diagnosticConfig.renderer,
      onDiagnostics: diagnosticConfig.renderer
        ? (summary) => {
            if (this.canvas !== canvas) return
            canvas.element.dataset.danmakuAnywhereUpscaleDiagnostics =
              JSON.stringify(summary)
          }
        : undefined,
      onError: (error) => void this.handleRuntimeError(error),
      onProgress: () => undefined,
    })
    if (epoch !== this.opEpoch) {
      // A disable() or newer applyOptions() won while we were creating —
      // destroy the orphan instead of clobbering the current state.
      renderer.destroy()
      canvas.cleanup()
      if (this.canvas === canvas) this.canvas = undefined
      if (this.video === video && !this.renderer) this.video = undefined
      return
    }
    this.renderer = renderer
  }

  private async queueRendererUpdate(
    epoch: number,
    renderer: Renderer,
    canvas: UpscaleCanvas,
    nextOptions: UpscaleOptions,
    targetDimensions: Dimensions
  ) {
    const update = this.rendererUpdateTail.then(async () => {
      if (
        epoch !== this.opEpoch ||
        this.suspended ||
        this.renderer !== renderer ||
        this.canvas !== canvas
      ) {
        return
      }

      this.options = nextOptions
      canvas.setBufferSize(targetDimensions.width, targetDimensions.height)

      try {
        await renderer.updateConfiguration({
          effects: nextOptions.effects,
          targetDimensions,
        })
      } catch (error) {
        if (
          epoch !== this.opEpoch ||
          this.suspended ||
          this.renderer !== renderer ||
          this.canvas !== canvas
        ) {
          return
        }
        throw error
      }
    })

    this.rendererUpdateTail = update.catch(() => undefined)
    await update
  }

  disable(options: { keepCorsFix?: boolean } = {}) {
    this.opEpoch++
    this.teardown()
    this.options = { ...this.options, enabled: false }
    // During suspension (e.g. PiP) the video keeps playing, so both the
    // crossOrigin attribute and the DNR rule must stay — pulling either one
    // mid-stream turns every later media request into a CORS failure.
    if (options.keepCorsFix) return
    this.restoreCrossOriginFix()
    if (this.corsRuleActive) {
      this.corsRuleActive = false
      void chromeRpcClient.upscaleRemoveCorsRule().catch(() => undefined)
    }
  }

  private teardown() {
    this.renderer?.destroy()
    this.renderer = undefined
    this.canvas?.cleanup()
    this.canvas = undefined
    this.video = undefined
    // Updates for the destroyed renderer still settle in the background, but
    // a new renderer must not wait behind them.
    this.rendererUpdateTail = Promise.resolve()
  }

  get isEnabled() {
    return this.renderer !== undefined
  }

  suspend() {
    if (this.suspended) return
    this.suspended = true
    this.disable({ keepCorsFix: true })
  }

  async resume() {
    if (!this.suspended) return
    this.suspended = false
    await this.reapply()
  }

  setTopLayerRestore(callback: () => void) {
    this.restoreHostTopLayer = callback
  }

  /** Called whenever upscaling fails to start or dies at runtime, so the
   * controller can surface it to the user instead of failing silently. */
  setFailureNotifier(callback: (kind: UpscaleFailureKind) => void) {
    this.notifyFailure = callback
  }

  /** Re-applies the last requested options, e.g. after PiP restores the video */
  reapply() {
    return this.applyOptions(this.requestedOptions)
  }

  async applyOptions(options: StoredUpscaleOptions) {
    this.requestedOptions = options
    if (this.suspended) {
      this.disable()
      return
    }
    if (!options.enabled) {
      this.disable()
      return
    }
    const epoch = ++this.opEpoch
    const baseModeById = {
      'builtin-mode-a': 'A',
      'builtin-mode-b': 'B',
      'builtin-mode-c': 'C',
      'builtin-mode-aa': 'A+A',
      'builtin-mode-bb': 'B+B',
      'builtin-mode-ca': 'C+A',
    } as const
    const baseMode = baseModeById[options.modeId]
    const video = this.videoObserver.activeVideo
    if (!video) {
      this.options = { ...this.options, enabled: true }
      return
    }
    try {
      if (options.enableCrossOriginFix) await this.fixCrossOrigin(video, epoch)
      if (epoch !== this.opEpoch) return
      // videoWidth/videoHeight are 0 until HAVE_METADATA, which would base the
      // buffer size on the element's placeholder CSS box instead of the media.
      await waitForVideoReady(video, HTMLMediaElement.HAVE_METADATA)
      if (epoch !== this.opEpoch) return
      if (this.videoObserver.activeVideo !== video) return
      const sourceWidth = Math.max(1, video.videoWidth || video.clientWidth)
      const sourceHeight = Math.max(1, video.videoHeight || video.clientHeight)
      const targetDimensions = (() => {
        switch (options.targetResolution) {
          case 'x2':
            return { width: sourceWidth * 2, height: sourceHeight * 2 }
          case 'x4':
            return { width: sourceWidth * 4, height: sourceHeight * 4 }
          case 'x8':
            return { width: sourceWidth * 8, height: sourceHeight * 8 }
          case '720p':
            return { width: 1280, height: 720 }
          case '1080p':
            return { width: 1920, height: 1080 }
          case '2k':
            return { width: 2560, height: 1440 }
          case '4k':
            return { width: 3840, height: 2160 }
          case 'native':
            return { width: sourceWidth, height: sourceHeight }
        }
      })()
      await this.enableInternal(epoch, this.videoObserver.activeVideo, {
        enabled: true,
        targetResolution: targetDimensions.width / sourceWidth,
        targetDimensions,
        effects: resolveEffectChain(baseMode, options.performanceTier),
      })
    } catch (error) {
      // A newer operation superseded this attempt while it was in flight —
      // its outcome is the one that matters, so stay silent here.
      if (epoch !== this.opEpoch) throw error
      // Clean up the half-built state (orphan canvas, CORS rule) and make
      // the failure visible: without this the panel toggle stays on while
      // nothing renders, which reads as "upscaling has no effect".
      this.disable()
      await this.reportEnableFailure(error)
      throw error
    }
  }

  /**
   * Surfaces an enable failure to the controller (toast) and flips the
   * stored option off so the UI stops claiming upscaling is active.
   * Never throws — the original enable error must propagate unchanged.
   */
  private async reportEnableFailure(error: unknown) {
    const kind: UpscaleFailureKind =
      error instanceof CrossOriginReloadError ? 'cross-origin' : 'error'
    try {
      this.notifyFailure?.(kind)
    } catch {
      // the notifier must not mask the enable error
    }
    try {
      const options = await this.extensionOptions.get()
      if (!options.playerOptions.upscale.enabled) return
      await this.extensionOptions.update({
        playerOptions: {
          ...options.playerOptions,
          upscale: { ...options.playerOptions.upscale, enabled: false },
        },
      })
    } catch (updateError) {
      this.logger.warn(
        'Failed to reset upscale option after enable failure',
        updateError
      )
    }
  }

  private async fixCrossOrigin(video: HTMLVideoElement, epoch: number) {
    const source = video.currentSrc || video.src
    if (!source || source.startsWith('blob:') || source.startsWith('data:'))
      return
    let sourceUrl: URL
    try {
      sourceUrl = new URL(source, location.href)
    } catch {
      return
    }
    if (
      !sourceUrl.protocol.startsWith('http') ||
      sourceUrl.origin === location.origin
    )
      return
    // Ask the background to install a tab-scoped DNR session rule for this
    // video's host before any anonymous request. The rule intentionally
    // outlives the reload (later seek/segment requests need it) and is
    // removed in disable() or when the tab closes — so it must be
    // (re)applied even when crossOrigin is already 'anonymous' from a
    // previous enable cycle. The background call is idempotent per tab+host.
    await chromeRpcClient.upscaleApplyCorsRule({ videoUrl: sourceUrl.href })
    this.corsRuleActive = true
    if (epoch !== this.opEpoch) return

    if (video.crossOrigin === 'anonymous') return

    const currentTime = video.currentTime
    const wasPaused = video.paused
    this.corsFix = { video, previous: video.crossOrigin }
    video.crossOrigin = 'anonymous'
    try {
      await new Promise<void>((resolve, reject) => {
        const timeout = window.setTimeout(() => {
          cleanup()
          reject(
            new CrossOriginReloadError('Timed out reloading cross-origin video')
          )
        }, 20_000)
        const cleanup = () => {
          window.clearTimeout(timeout)
          video.removeEventListener('loadedmetadata', onLoaded)
          video.removeEventListener('error', onError)
        }
        const onLoaded = () => {
          cleanup()
          resolve()
        }
        const onError = () => {
          cleanup()
          reject(
            new CrossOriginReloadError('Failed to reload cross-origin video')
          )
        }
        video.addEventListener('loadedmetadata', onLoaded, { once: true })
        video.addEventListener('error', onError, { once: true })
        video.load()
      })
    } catch (error) {
      // The anonymous reload failed, so the element can no longer stream —
      // put it back the way the site had it or playback stays broken.
      this.restoreCrossOriginFix()
      throw error
    }
    if (epoch !== this.opEpoch) return
    if (Number.isFinite(currentTime)) video.currentTime = currentTime
    if (!wasPaused) await video.play()
  }

  /**
   * Reverts a crossOrigin='anonymous' switch made by fixCrossOrigin and
   * reloads the video so it can stream again without the DNR rule.
   */
  private restoreCrossOriginFix() {
    const fix = this.corsFix
    this.corsFix = undefined
    if (!fix) return
    const { video, previous } = fix
    // The site changed it after us — leave it alone.
    if (video.crossOrigin !== 'anonymous') return
    video.crossOrigin = previous
    if (!video.isConnected) return
    const currentTime = video.currentTime
    const wasPaused = video.paused
    video.addEventListener(
      'loadedmetadata',
      () => {
        if (Number.isFinite(currentTime)) video.currentTime = currentTime
        if (!wasPaused) void video.play().catch(() => undefined)
      },
      { once: true }
    )
    video.load()
  }

  private async handleRuntimeError(error: Error) {
    this.logger.error('Anime4K rendering stopped', error)
    this.disable()
    try {
      this.notifyFailure?.('error')
    } catch {
      // notifier failures must not break the shutdown path
    }
    const options = await this.extensionOptions.get()
    if (!options.playerOptions.upscale.enabled) return
    await this.extensionOptions.update({
      playerOptions: {
        ...options.playerOptions,
        upscale: { ...options.playerOptions.upscale, enabled: false },
      },
    })
  }
}

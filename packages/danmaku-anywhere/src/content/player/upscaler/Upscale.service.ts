import {
  type Dimensions,
  type EnhancementEffect,
  Renderer,
  RendererInitializationError,
  resolveEffectChain,
  waitForVideoReady,
} from '@danmaku-anywhere/upscale-engine'
import { inject, injectable } from 'inversify'
import { type ILogger, LoggerSymbol } from '@/common/Logger'
import { ExtensionOptionsService } from '@/common/options/extensionOptions/service'
import { VideoNodeObserverService } from '@/content/player/videoObserver/VideoNodeObserver.service'
import { UpscaleCanvas } from './UpscaleCanvas'

export interface UpscaleOptions {
  enabled: boolean
  targetResolution: number
  targetDimensions?: Dimensions
  effects: EnhancementEffect[]
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

@injectable('Singleton')
export class UpscaleService {
  private renderer: Renderer | undefined
  private canvas: UpscaleCanvas | undefined
  private video: HTMLVideoElement | undefined
  private options = defaultOptions
  private restoreHostTopLayer: (() => void) | undefined
  private requestedOptions: StoredUpscaleOptions = {
    enabled: false,
    modeId: 'builtin-mode-a',
    performanceTier: 'balanced',
    targetResolution: 'x2',
    enableCrossOriginFix: false,
  }
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
    if (!video) throw new RendererInitializationError('No active video element')
    if (!('gpu' in navigator) || !navigator.gpu) {
      throw new RendererInitializationError(
        'WebGPU is not supported by this browser'
      )
    }
    const nextOptions = { ...this.options, ...options, enabled: true }
    if (this.video === video && this.renderer && this.canvas) {
      const width = Math.max(1, video.videoWidth || video.clientWidth)
      const height = Math.max(1, video.videoHeight || video.clientHeight)
      const targetDimensions = nextOptions.targetDimensions ?? {
        width: width * nextOptions.targetResolution,
        height: height * nextOptions.targetResolution,
      }
      this.options = nextOptions
      this.canvas.setBufferSize(targetDimensions.width, targetDimensions.height)
      await this.renderer.updateConfiguration({
        effects: nextOptions.effects,
        targetDimensions,
      })
      return
    }
    this.disable()
    this.options = nextOptions
    this.video = video
    this.canvas = new UpscaleCanvas(video, this.restoreHostTopLayer)
    const width = Math.max(1, video.videoWidth || video.clientWidth)
    const height = Math.max(1, video.videoHeight || video.clientHeight)
    const targetDimensions = this.options.targetDimensions ?? {
      width: width * this.options.targetResolution,
      height: height * this.options.targetResolution,
    }
    this.canvas.setBufferSize(targetDimensions.width, targetDimensions.height)
    this.renderer = await Renderer.create({
      video,
      canvas: this.canvas.element,
      effects: this.options.effects,
      targetDimensions,
      onFirstFrameRendered: () => this.canvas?.show(),
      onError: (error) => void this.handleRuntimeError(error),
      onProgress: () => undefined,
    })
  }

  disable() {
    this.renderer?.destroy()
    this.renderer = undefined
    this.canvas?.cleanup()
    this.canvas = undefined
    this.video = undefined
    this.options = { ...this.options, enabled: false }
  }

  get isEnabled() {
    return this.renderer !== undefined
  }

  setTopLayerRestore(callback: () => void) {
    this.restoreHostTopLayer = callback
  }

  async applyOptions(options: StoredUpscaleOptions) {
    this.requestedOptions = options
    if (!options.enabled) {
      this.disable()
      return
    }
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
    if (options.enableCrossOriginFix) await this.fixCrossOrigin(video)
    // videoWidth/videoHeight are 0 until HAVE_METADATA, which would base the
    // buffer size on the element's placeholder CSS box instead of the media.
    await waitForVideoReady(video, HTMLMediaElement.HAVE_METADATA)
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
    await this.enable(this.videoObserver.activeVideo, {
      enabled: true,
      targetResolution: targetDimensions.width / sourceWidth,
      targetDimensions,
      effects: resolveEffectChain(baseMode, options.performanceTier),
    })
  }

  private async fixCrossOrigin(video: HTMLVideoElement) {
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
    if (video.crossOrigin === 'anonymous') return

    const currentTime = video.currentTime
    const wasPaused = video.paused
    video.crossOrigin = 'anonymous'
    await new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        cleanup()
        reject(
          new RendererInitializationError(
            'Timed out reloading cross-origin video'
          )
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
          new RendererInitializationError('Failed to reload cross-origin video')
        )
      }
      video.addEventListener('loadedmetadata', onLoaded, { once: true })
      video.addEventListener('error', onError, { once: true })
      video.load()
    })
    if (Number.isFinite(currentTime)) video.currentTime = currentTime
    if (!wasPaused) await video.play()
  }

  private async handleRuntimeError(error: Error) {
    this.logger.error('Anime4K rendering stopped', error)
    this.disable()
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

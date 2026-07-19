// @vitest-environment jsdom
import type { EnhancementEffect } from '@danmaku-anywhere/upscale-engine'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  rendererCreate: vi.fn(),
  resolveEffectChain: vi.fn(),
  waitForVideoReady: vi.fn(),
  upscaleApplyCorsRule: vi.fn(),
  upscaleRemoveCorsRule: vi.fn(),
  canvasInstances: [] as Array<{
    element: HTMLCanvasElement
    setBufferSize: ReturnType<typeof vi.fn>
    cleanup: ReturnType<typeof vi.fn>
    show: ReturnType<typeof vi.fn>
  }>,
}))

vi.mock('@/common/rpcClient/background/client', () => ({
  chromeRpcClient: {
    upscaleApplyCorsRule: mocks.upscaleApplyCorsRule,
    upscaleRemoveCorsRule: mocks.upscaleRemoveCorsRule,
  },
}))

vi.mock('@danmaku-anywhere/upscale-engine', () => ({
  Renderer: {
    create: mocks.rendererCreate,
  },
  RendererInitializationError: class extends Error {},
  resolveEffectChain: mocks.resolveEffectChain,
  waitForVideoReady: mocks.waitForVideoReady,
}))

vi.mock('./UpscaleCanvas', () => ({
  UpscaleCanvas: class {
    element = document.createElement('canvas')
    setBufferSize = vi.fn()
    cleanup = vi.fn()
    show = vi.fn()

    constructor() {
      mocks.canvasInstances.push(this)
    }
  },
}))

import { UpscaleService } from './Upscale.service'

const createDeferred = <T>() => {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const createVideo = () => {
  const video = document.createElement('video')
  Object.defineProperties(video, {
    videoWidth: { configurable: true, value: 640 },
    videoHeight: { configurable: true, value: 360 },
  })
  return video
}

const createStoredOptions = (
  overrides: Partial<Parameters<UpscaleService['applyOptions']>[0]> = {}
) => ({
  enabled: true,
  modeId: 'builtin-mode-a' as const,
  performanceTier: 'balanced' as const,
  targetResolution: 'x2' as const,
  enableCrossOriginFix: false,
  ...overrides,
})

const createService = (video: HTMLVideoElement) => {
  const videoObserver = {
    activeVideo: video,
    addEventListener: vi.fn(),
  }
  const extensionOptions = {
    get: vi.fn(),
    update: vi.fn(),
  }
  const logger = {
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    sub: vi.fn(),
  }
  logger.sub.mockReturnValue(logger)

  return new UpscaleService(
    videoObserver as never,
    extensionOptions as never,
    logger as never
  )
}

describe('UpscaleService operation coordination', () => {
  beforeEach(() => {
    mocks.canvasInstances.length = 0
    mocks.rendererCreate.mockReset()
    mocks.resolveEffectChain.mockReset()
    mocks.waitForVideoReady.mockReset()
    mocks.upscaleApplyCorsRule.mockReset()
    mocks.upscaleRemoveCorsRule.mockReset()
    mocks.waitForVideoReady.mockResolvedValue(undefined)
    mocks.upscaleApplyCorsRule.mockResolvedValue(undefined)
    mocks.upscaleRemoveCorsRule.mockResolvedValue(undefined)
    mocks.resolveEffectChain.mockImplementation(
      (mode: string, tier: string): EnhancementEffect[] => [
        { className: `${mode}-${tier}` },
      ]
    )
    Object.defineProperty(navigator, 'gpu', {
      configurable: true,
      value: {},
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('serializes configuration rebuilds and leaves the newest options last', async () => {
    const video = createVideo()
    const firstUpdate = createDeferred<void>()
    const renderer = {
      destroy: vi.fn(),
      handleSourceResize: vi.fn(),
      updateConfiguration: vi
        .fn()
        .mockImplementationOnce(() => firstUpdate.promise)
        .mockResolvedValue(undefined),
    }
    mocks.rendererCreate.mockResolvedValue(renderer)
    const service = createService(video)

    await service.applyOptions(createStoredOptions())

    const older = service.applyOptions(
      createStoredOptions({ modeId: 'builtin-mode-b', targetResolution: 'x4' })
    )
    await vi.waitFor(() => {
      expect(renderer.updateConfiguration).toHaveBeenCalledTimes(1)
    })

    const newer = service.applyOptions(
      createStoredOptions({ modeId: 'builtin-mode-c', targetResolution: 'x8' })
    )
    await Promise.resolve()
    expect(renderer.updateConfiguration).toHaveBeenCalledTimes(1)

    firstUpdate.resolve()
    await older
    await newer

    expect(renderer.updateConfiguration).toHaveBeenCalledTimes(2)
    expect(renderer.updateConfiguration).toHaveBeenLastCalledWith({
      effects: [{ className: 'C-balanced' }],
      targetDimensions: { width: 5120, height: 2880 },
    })
  })

  it('ignores a stale renderer update failure after disable', async () => {
    const video = createVideo()
    const update = createDeferred<void>()
    const renderer = {
      destroy: vi.fn(),
      handleSourceResize: vi.fn(),
      updateConfiguration: vi.fn(() => update.promise),
    }
    mocks.rendererCreate.mockResolvedValue(renderer)
    const service = createService(video)

    await service.applyOptions(createStoredOptions())
    const applying = service.applyOptions(
      createStoredOptions({ modeId: 'builtin-mode-b' })
    )
    await vi.waitFor(() => {
      expect(renderer.updateConfiguration).toHaveBeenCalledTimes(1)
    })

    service.disable()
    update.reject(new Error('renderer was destroyed'))

    await expect(applying).resolves.toBeUndefined()
    expect(renderer.destroy).toHaveBeenCalledTimes(1)
  })

  it('records option changes while suspended and initializes only on resume', async () => {
    const video = createVideo()
    const renderer = {
      destroy: vi.fn(),
      handleSourceResize: vi.fn(),
      updateConfiguration: vi.fn(),
    }
    mocks.rendererCreate.mockResolvedValue(renderer)
    const service = createService(video)

    service.suspend()
    await service.applyOptions(
      createStoredOptions({ modeId: 'builtin-mode-c', targetResolution: 'x4' })
    )

    expect(mocks.rendererCreate).not.toHaveBeenCalled()

    await service.resume()

    expect(mocks.rendererCreate).toHaveBeenCalledTimes(1)
    expect(mocks.rendererCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        effects: [{ className: 'C-balanced' }],
        targetDimensions: { width: 2560, height: 1440 },
      })
    )
  })

  describe('cross-origin fix lifecycle', () => {
    const enableWithCorsFix = async (
      service: UpscaleService,
      video: HTMLVideoElement
    ) => {
      const applying = service.applyOptions(
        createStoredOptions({ enableCrossOriginFix: true })
      )
      await vi.waitFor(() => expect(video.crossOrigin).toBe('anonymous'))
      video.dispatchEvent(new Event('loadedmetadata'))
      await applying
    }

    it('restores crossOrigin and removes the CORS rule on disable', async () => {
      const video = createVideo()
      video.src = 'https://cdn.example.com/video.mp4'
      const renderer = {
        destroy: vi.fn(),
        handleSourceResize: vi.fn(),
        updateConfiguration: vi.fn(),
      }
      mocks.rendererCreate.mockResolvedValue(renderer)
      const service = createService(video)

      await enableWithCorsFix(service, video)
      expect(mocks.upscaleApplyCorsRule).toHaveBeenCalledWith({
        videoUrl: 'https://cdn.example.com/video.mp4',
      })

      service.disable()

      expect(video.crossOrigin).toBe(null)
      expect(mocks.upscaleRemoveCorsRule).toHaveBeenCalledTimes(1)
    })

    it('keeps the CORS fix while suspended so playback continues', async () => {
      const video = createVideo()
      video.src = 'https://cdn.example.com/video.mp4'
      const renderer = {
        destroy: vi.fn(),
        handleSourceResize: vi.fn(),
        updateConfiguration: vi.fn(),
      }
      mocks.rendererCreate.mockResolvedValue(renderer)
      const service = createService(video)

      await enableWithCorsFix(service, video)

      service.suspend()

      expect(video.crossOrigin).toBe('anonymous')
      expect(mocks.upscaleRemoveCorsRule).not.toHaveBeenCalled()
    })

    it('restores crossOrigin when the anonymous reload fails', async () => {
      const video = createVideo()
      video.src = 'https://cdn.example.com/video.mp4'
      const service = createService(video)

      const applying = service.applyOptions(
        createStoredOptions({ enableCrossOriginFix: true })
      )
      await vi.waitFor(() => expect(video.crossOrigin).toBe('anonymous'))
      video.dispatchEvent(new Event('error'))

      await expect(applying).rejects.toThrow(
        'Failed to reload cross-origin video'
      )
      expect(video.crossOrigin).toBe(null)
    })
  })

  describe('display bounds clamping', () => {
    afterEach(() => {
      vi.unstubAllGlobals()
    })

    const setupRenderer = () => {
      const renderer = {
        destroy: vi.fn(),
        handleSourceResize: vi.fn(),
        updateConfiguration: vi.fn(),
      }
      mocks.rendererCreate.mockResolvedValue(renderer)
      return renderer
    }

    it('caps the render target at the physical screen size', async () => {
      vi.stubGlobal('screen', { width: 1920, height: 1080 })
      vi.stubGlobal('devicePixelRatio', 1)
      setupRenderer()
      const video = createVideo()
      const service = createService(video)

      // x8 of 640×360 requests 5120×2880 — far beyond a 1080p display
      await service.applyOptions(
        createStoredOptions({ targetResolution: 'x8' })
      )

      expect(mocks.rendererCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          targetDimensions: { width: 1920, height: 1080 },
        })
      )
    })

    it('multiplies the screen bound by devicePixelRatio', async () => {
      vi.stubGlobal('screen', { width: 1280, height: 720 })
      vi.stubGlobal('devicePixelRatio', 2)
      setupRenderer()
      const video = createVideo()
      const service = createService(video)

      // bound = 1280×2 by 720×2 = 2560×1440; x8 (5120×2880) halves to fit
      await service.applyOptions(
        createStoredOptions({ targetResolution: 'x8' })
      )

      expect(mocks.rendererCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          targetDimensions: { width: 2560, height: 1440 },
        })
      )
    })

    it('leaves the target untouched when it already fits the display', async () => {
      vi.stubGlobal('screen', { width: 3840, height: 2160 })
      vi.stubGlobal('devicePixelRatio', 1)
      setupRenderer()
      const video = createVideo()
      const service = createService(video)

      // x2 of 640×360 = 1280×720, well within a 4K display
      await service.applyOptions(
        createStoredOptions({ targetResolution: 'x2' })
      )

      expect(mocks.rendererCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          targetDimensions: { width: 1280, height: 720 },
        })
      )
    })
  })
})

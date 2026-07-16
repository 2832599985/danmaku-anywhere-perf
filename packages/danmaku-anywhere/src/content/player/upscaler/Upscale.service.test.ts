// @vitest-environment jsdom
import type { EnhancementEffect } from '@danmaku-anywhere/upscale-engine'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  rendererCreate: vi.fn(),
  resolveEffectChain: vi.fn(),
  waitForVideoReady: vi.fn(),
  canvasInstances: [] as Array<{
    element: HTMLCanvasElement
    setBufferSize: ReturnType<typeof vi.fn>
    cleanup: ReturnType<typeof vi.fn>
    show: ReturnType<typeof vi.fn>
  }>,
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
    mocks.waitForVideoReady.mockResolvedValue(undefined)
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
})

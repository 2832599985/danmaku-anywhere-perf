// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const pipMocks = vi.hoisted(() => ({
  createPipWindow: vi.fn(),
  moveElement: vi.fn(),
}))

vi.mock('@/content/player/pipUtils', () => ({
  createPipWindow: pipMocks.createPipWindow,
  moveElement: pipMocks.moveElement,
}))

import { PlayerCommandHandler } from './PlayerCommandHandler.service'

describe('PlayerCommandHandler PiP upscale lifecycle', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    pipMocks.createPipWindow.mockReset()
    pipMocks.moveElement.mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('suspends in-flight upscale before moving the video and resumes on pagehide', async () => {
    const pipDocument = document.implementation.createHTMLDocument('PiP')
    let pagehideListener: EventListener | undefined
    const pipWindow = {
      document: pipDocument,
      addEventListener: vi.fn(
        (
          type: string,
          listener: EventListener,
          options?: AddEventListenerOptions
        ) => {
          if (type === 'pagehide') pagehideListener = listener
          expect(options).toEqual({ once: true })
        }
      ),
    }
    pipMocks.createPipWindow.mockResolvedValue(pipWindow)

    const restoreWrapper = vi.fn()
    const restoreVideo = vi.fn()
    pipMocks.moveElement
      .mockReturnValueOnce(restoreWrapper)
      .mockReturnValueOnce(restoreVideo)

    const wrapper = document.createElement('div')
    const video = document.createElement('video')
    const manager = {
      getWrapper: vi.fn(() => wrapper),
      video,
      resize: vi.fn(),
    }
    const upscale = {
      suspend: vi.fn(),
      resume: vi.fn().mockResolvedValue(undefined),
    }
    const handler = Object.create(
      PlayerCommandHandler.prototype
    ) as unknown as {
      manager: typeof manager
      upscale: typeof upscale
      enterPip: () => Promise<void>
    }
    handler.manager = manager
    handler.upscale = upscale

    await handler.enterPip()

    expect(upscale.suspend).toHaveBeenCalledTimes(1)
    expect(pipMocks.moveElement).toHaveBeenNthCalledWith(
      1,
      wrapper,
      expect.any(HTMLDivElement)
    )
    expect(pipMocks.moveElement).toHaveBeenNthCalledWith(
      2,
      video,
      pipDocument.body
    )
    expect(upscale.suspend.mock.invocationCallOrder[0]).toBeLessThan(
      pipMocks.moveElement.mock.invocationCallOrder[0]
    )

    expect(pagehideListener).toBeDefined()
    pagehideListener?.(new Event('pagehide'))
    await Promise.resolve()
    vi.runAllTimers()

    expect(restoreVideo).toHaveBeenCalledTimes(1)
    expect(restoreWrapper).toHaveBeenCalledTimes(1)
    expect(upscale.resume).toHaveBeenCalledTimes(1)
    expect(manager.resize).toHaveBeenCalledTimes(2)
  })
})

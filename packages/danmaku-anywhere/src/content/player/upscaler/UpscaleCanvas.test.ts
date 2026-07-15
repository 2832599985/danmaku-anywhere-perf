// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { UpscaleCanvas } from './UpscaleCanvas'

class ResizeObserverMock {
  observe = vi.fn()
  disconnect = vi.fn()
}

describe('UpscaleCanvas', () => {
  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', ResizeObserverMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    document.body.replaceChildren()
  })

  it('is inserted after the video and copies its slot', () => {
    const video = document.createElement('video')
    video.slot = 'media'
    document.body.appendChild(video)
    const canvas = new UpscaleCanvas(video)

    expect(video.nextElementSibling).toBe(canvas.element)
    expect(canvas.element.slot).toBe('media')
    expect(canvas.element.dataset.danmakuAnywhereUpscale).toBe('true')
    // A closed popover is display:none !important per the UA stylesheet, so
    // the attribute must only exist while the video itself is fullscreen.
    expect(canvas.element.hasAttribute('popover')).toBe(false)
    canvas.cleanup()
  })

  it('keeps the CSS display size separate from the enlarged buffer', () => {
    const video = document.createElement('video')
    vi.spyOn(video, 'getBoundingClientRect').mockReturnValue({
      x: 10,
      y: 20,
      left: 10,
      top: 20,
      right: 650,
      bottom: 380,
      width: 640,
      height: 360,
      toJSON: () => ({}),
    })
    document.body.appendChild(video)
    const canvas = new UpscaleCanvas(video)
    canvas.setBufferSize(1280, 720)

    expect(canvas.element.width).toBe(1280)
    expect(canvas.element.height).toBe(720)
    expect(canvas.element.style.width).toBe('640px')
    expect(canvas.element.style.height).toBe('360px')
    canvas.cleanup()
  })

  it('restores the original video when cleaned up', () => {
    const video = document.createElement('video')
    video.style.opacity = '0.75'
    document.body.appendChild(video)
    const canvas = new UpscaleCanvas(video)
    canvas.show()
    expect(video.style.opacity).toBe('0')

    canvas.cleanup()
    expect(video.style.opacity).toBe('0.75')
    expect(canvas.element.isConnected).toBe(false)
  })
})

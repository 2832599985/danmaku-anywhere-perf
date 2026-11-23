import { describe, expect, it, vi } from 'vitest'
import { VideoSrcObserver } from './VideoSrcObserver'

const makeVideo = (src: string) => {
  const video = document.createElement('video')
  video.src = src
  return video
}

describe('VideoSrcObserver', () => {
  it('detaches the previous element listeners when observing a new one', () => {
    const first = makeVideo('https://example.com/a.mp4')
    const removeSpy = vi.spyOn(first, 'removeEventListener')
    const observer = new VideoSrcObserver()

    observer.observe(first)
    observer.observe(makeVideo('https://example.com/b.mp4'))

    expect(removeSpy).toHaveBeenCalledWith('loadstart', expect.any(Function))
    expect(removeSpy).toHaveBeenCalledWith('loadeddata', expect.any(Function))

    observer.cleanup()
  })

  it('ignores media events from an element it no longer observes', () => {
    const first = makeVideo('https://example.com/a.mp4')
    const second = makeVideo('https://example.com/b.mp4')
    const listener = vi.fn()
    const observer = new VideoSrcObserver()
    observer.onSrcChange(listener)

    observer.observe(first)
    // Keep the stale listeners reachable so a leaked handler would still fire.
    const staleHandlers: EventListener[] = []
    vi.spyOn(first, 'removeEventListener').mockImplementation(
      (_type, handler) => {
        staleHandlers.push(handler as EventListener)
      }
    )
    observer.observe(second)

    // The second element's source moves on, but only the stale element fires.
    second.src = 'https://example.com/c.mp4'
    for (const handler of staleHandlers) {
      handler.call(first, new Event('loadstart'))
    }

    expect(listener).not.toHaveBeenCalled()

    observer.cleanup()
  })
})

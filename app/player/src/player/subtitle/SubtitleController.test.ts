import { describe, expect, it } from 'vitest'
import type { SubtitleCue } from '@/subtitle/types'
import { SubtitleController } from './SubtitleController'

/**
 * Minimal stand-in for a Chromium <video>: an EventTarget with the fields the
 * controller reads, and frame callbacks that fire only when the test
 * "presents" a frame — exactly like the real element, where a paused video
 * presents nothing and a seek while paused presents exactly one frame.
 */
class FakeVideo extends EventTarget {
  currentTime = 0
  paused = true
  seeking = false
  private nextHandle = 1
  private callbacks = new Map<
    number,
    (now: number, meta: { mediaTime: number }) => void
  >()

  requestVideoFrameCallback(
    cb: (now: number, meta: { mediaTime: number }) => void
  ): number {
    const handle = this.nextHandle++
    this.callbacks.set(handle, cb)
    return handle
  }

  cancelVideoFrameCallback(handle: number): void {
    this.callbacks.delete(handle)
  }

  /** Callbacks currently registered (a healthy controller keeps exactly one). */
  get pendingCallbacks(): number {
    return this.callbacks.size
  }

  /** A frame reaches the compositor: run (and consume) every pending callback. */
  present(mediaTime = this.currentTime): void {
    const pending = [...this.callbacks.values()]
    this.callbacks.clear()
    for (const cb of pending) cb(performance.now(), { mediaTime })
  }

  play(): void {
    this.paused = false
    this.dispatchEvent(new Event('play'))
    this.dispatchEvent(new Event('playing'))
  }

  pause(): void {
    this.paused = true
    this.dispatchEvent(new Event('pause'))
  }

  /** Begin a seek: the clock jumps, the decoder has not caught up yet. */
  startSeek(time: number): void {
    this.currentTime = time
    this.seeking = true
    this.dispatchEvent(new Event('seeking'))
  }

  /** Finish it: the new frame is presented, then `seeked`. */
  finishSeek(): void {
    this.seeking = false
    this.present(this.currentTime)
    this.dispatchEvent(new Event('seeked'))
  }

  seek(time: number): void {
    this.startSeek(time)
    this.finishSeek()
  }

  /** Normal playback: frames at 24 fps up to `until`. */
  playTo(until: number): void {
    for (let t = this.currentTime; t <= until + 1e-9; t += 1 / 24) {
      this.currentTime = t
      this.present(t)
    }
  }
}

const cue = (start: number, end: number, text: string): SubtitleCue => ({
  start,
  end,
  text,
})

const setup = (cues: SubtitleCue[]) => {
  const video = new FakeVideo()
  const seen: string[][] = []
  let shown: string[] = []
  const ctrl = new SubtitleController({
    onActiveChange: (active) => {
      shown = active.map((c) => c.text)
      seen.push(shown)
    },
  })
  return {
    video,
    ctrl,
    shown: () => shown,
    seen,
    mount: () => ctrl.setCues(video as unknown as HTMLVideoElement, cues),
  }
}

describe('SubtitleController timing', () => {
  const cues = [
    cue(1, 2, 'one'),
    cue(3, 4, 'three'),
    cue(6, 7, 'six'),
    cue(9, 10, 'nine'),
  ]

  it('follows playback frame by frame', () => {
    const t = setup(cues)
    t.video.play()
    t.mount()
    t.video.playTo(1.5)
    expect(t.shown()).toEqual(['one'])
    t.video.playTo(2.5)
    expect(t.shown()).toEqual([])
    t.video.playTo(3.2)
    expect(t.shown()).toEqual(['three'])
  })

  it('keeps following after pause → seek → play (arrow keys while paused)', () => {
    // Regression: the frame presented by a seek while paused used to end the
    // tick chain, and `play` only refreshed once — the line then froze until
    // the next seek ("按左右键…有概率字幕没出来").
    const t = setup(cues)
    t.video.play()
    t.mount()
    t.video.playTo(1.5)
    t.video.pause()
    t.video.seek(3.5)
    expect(t.shown()).toEqual(['three'])
    t.video.play()
    t.video.playTo(6.5)
    expect(t.shown()).toEqual(['six'])
    t.video.playTo(9.2)
    expect(t.shown()).toEqual(['nine'])
  })

  it('starts following when cues are mounted while paused', () => {
    // Regression: mounting while paused never started the tick chain, and
    // `play` refreshed exactly once.
    const t = setup(cues)
    t.mount()
    t.video.play()
    t.video.playTo(1.2)
    expect(t.shown()).toEqual(['one'])
    t.video.playTo(3.1)
    expect(t.shown()).toEqual(['three'])
  })

  it('never stacks frame callbacks', () => {
    const t = setup(cues)
    t.mount()
    t.video.play()
    t.video.pause()
    t.video.seek(3.5)
    t.ctrl.refresh()
    t.ctrl.updateStyle({ offset: 100 })
    t.video.play()
    expect(t.video.pendingCallbacks).toBe(1)
    t.video.playTo(4)
    expect(t.video.pendingCallbacks).toBe(1)
  })

  it('shows the target line the moment a seek starts', () => {
    const t = setup(cues)
    t.video.play()
    t.mount()
    t.video.playTo(1.5)
    t.video.startSeek(6.4)
    expect(t.shown()).toEqual(['six'])
    // A stale frame from before the seek must not flip it back.
    t.video.present(1.55)
    expect(t.shown()).toEqual(['six'])
    t.video.finishSeek()
    expect(t.shown()).toEqual(['six'])
  })

  it('answers a seek command before the element reports it', () => {
    // `seeking` arrives a task later; the arrow-key handler calls seekTo().
    const t = setup(cues)
    t.video.play()
    t.mount()
    t.video.playTo(1.5)
    t.video.currentTime = 9.5
    t.ctrl.seekTo(9.5)
    expect(t.shown()).toEqual(['nine'])
    expect(t.video.pendingCallbacks).toBe(1)
  })

  it('still updates from timeupdate when no frames are presented', async () => {
    // Occluded/minimised window: no compositor frames, the clock keeps going.
    const t = setup(cues)
    t.video.play()
    t.mount()
    t.video.playTo(0.5)
    await new Promise((resolve) => setTimeout(resolve, 400))
    t.video.currentTime = 6.2
    t.video.dispatchEvent(new Event('timeupdate'))
    expect(t.shown()).toEqual(['six'])
  })

  it('uses the presented frame time, not the clock', () => {
    const t = setup(cues)
    t.video.play()
    t.mount()
    // The clock has run past the cue start; the frame on screen has not.
    t.video.currentTime = 1.02
    t.video.present(0.98)
    expect(t.shown()).toEqual([])
    t.video.present(1.01)
    expect(t.shown()).toEqual(['one'])
  })

  it('applies the offset (positive = later)', () => {
    const t = setup(cues)
    t.video.play()
    t.mount()
    t.ctrl.updateStyle({ offset: 500 })
    t.video.playTo(1.2)
    expect(t.shown()).toEqual([])
    t.video.playTo(1.6)
    expect(t.shown()).toEqual(['one'])
  })

  it('reports changes only', () => {
    const t = setup(cues)
    t.video.play()
    t.mount()
    t.video.playTo(4.5)
    expect(t.seen).toEqual([['one'], [], ['three'], []])
  })

  it('goes quiet after clear and destroy', () => {
    const t = setup(cues)
    t.video.play()
    t.mount()
    t.video.playTo(1.5)
    t.ctrl.clear()
    expect(t.shown()).toEqual([])
    expect(t.video.pendingCallbacks).toBe(0)
    t.mount()
    t.ctrl.destroy()
    const before = t.seen.length
    t.video.playTo(3.5)
    t.video.seek(6.5)
    expect(t.seen.length).toBe(before)
    expect(t.video.pendingCallbacks).toBe(0)
  })
})

describe('SubtitleController overlapping cues', () => {
  it('shows every cue that covers the playhead', () => {
    // Bilingual fansub tracks carry the Chinese and the Japanese line as two
    // events with identical timing; only the later one used to be shown.
    const t = setup([
      cue(1, 4, '中文台词'),
      cue(1, 4, '日本語のセリフ'),
      cue(2, 3, '招牌'),
    ])
    t.video.play()
    t.mount()
    t.video.playTo(1.5)
    expect(t.shown()).toEqual(['中文台词', '日本語のセリフ'])
    t.video.playTo(2.5)
    expect(t.shown()).toEqual(['中文台词', '日本語のセリフ', '招牌'])
    t.video.playTo(3.5)
    expect(t.shown()).toEqual(['中文台词', '日本語のセリフ'])
  })

  it('keeps a long cue after a shorter one inside it ends', () => {
    // Regression: after the inner cue ended, NOTHING was shown for the rest
    // of the outer cue (only the latest-starting cue was ever checked).
    const t = setup([cue(1, 5, 'outer'), cue(2, 3, 'inner')])
    t.video.play()
    t.mount()
    t.video.playTo(3.5)
    expect(t.shown()).toEqual(['outer'])
  })

  it('finds a long cue that started far earlier', () => {
    const cues = [cue(0, 100, 'banner')]
    for (let i = 0; i < 50; i += 1) cues.push(cue(i + 1, i + 1.5, `line ${i}`))
    const t = setup(cues)
    t.video.play()
    t.mount()
    t.video.seek(40.8)
    expect(t.shown()).toEqual(['banner'])
    t.video.seek(40.2)
    expect(t.shown()).toEqual(['banner', 'line 39'])
  })

  it('accepts unsorted cues', () => {
    const t = setup([cue(3, 4, 'b'), cue(1, 2, 'a')])
    t.video.play()
    t.mount()
    t.video.playTo(1.5)
    expect(t.shown()).toEqual(['a'])
    t.video.playTo(3.5)
    expect(t.shown()).toEqual(['b'])
  })
})

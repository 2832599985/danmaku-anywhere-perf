import type { SubtitleCue } from '@/subtitle/types'

/**
 * Render style for the subtitle layer; owned by SubtitleSettings and forwarded
 * by PlayerHost whenever the persisted settings change.
 */
export interface SubtitleStyle {
  /** timing offset in ms (same sign convention as the danmaku offset: positive
   * values show cues LATER, i.e. lookup time = video.currentTime - offset). */
  offset: number
}

export interface SubtitleControllerCallbacks {
  /**
   * Fired when the on-screen cue changes (binary-searched cue index, -1 = no
   * active cue). Called at most once per cue boundary — never per frame — so
   * the consumer can safely mirror it into the store and let React render.
   */
  onCueChange: (index: number) => void
}

type RVFCVideo = HTMLVideoElement & {
  requestVideoFrameCallback?: (cb: () => void) => number
  cancelVideoFrameCallback?: (handle: number) => void
}

/**
 * Subtitle timing engine. Driven by requestVideoFrameCallback (frame-exact
 * while playing; `timeupdate` alone fires at ~4 Hz which visibly jitters cue
 * in/out), with a rAF fallback and a one-shot refresh on `seeked` so cues are
 * correct while paused. Cue lookup is a binary search over the start-sorted
 * array with a binary-search re-anchoring on every lookup — the same cursor
 * shape the danmaku engine's bindVideo plugin uses, minus the emit queue.
 */
export class SubtitleController {
  private video: RVFCVideo | null = null
  private cues: SubtitleCue[] = []
  /** active cue index, -1 = none (mirrors the store's subtitleCueIndex). */
  private index = -1
  private rafId = 0
  private style: SubtitleStyle = { offset: 0 }
  private readonly callbacks: SubtitleControllerCallbacks
  private destroyed = false

  constructor(callbacks: SubtitleControllerCallbacks) {
    this.callbacks = callbacks
  }

  /** Mount cues for the given video element (replacing any previous set). */
  setCues(video: HTMLVideoElement, cues: SubtitleCue[]): void {
    if (this.destroyed) return
    this.detachVideo()
    this.video = video as RVFCVideo
    this.cues = cues
    this.setIndex(-1)
    video.addEventListener('seeked', this.refreshOnce)
    video.addEventListener('play', this.refreshOnce)
    // Align immediately (e.g. cues mounted mid-playback) and keep ticking.
    this.refreshOnce()
    this.scheduleTick()
  }

  updateStyle(style: SubtitleStyle): void {
    if (this.destroyed) return
    this.style = style
    // An offset change can flip which cue is on screen.
    this.refreshOnce()
  }

  clear(): void {
    if (this.destroyed) return
    this.cues = []
    this.setIndex(-1)
    this.stopTick()
  }

  destroy(): void {
    this.destroyed = true
    this.detachVideo()
    this.stopTick()
  }

  private setIndex(next: number): void {
    if (this.index === next) return
    this.index = next
    this.callbacks.onCueChange(next)
  }

  /** Re-evaluate the active cue once (seek, play edge, settings change). */
  private refreshOnce = (): void => {
    if (this.destroyed || !this.video) return
    const time = this.video.currentTime - this.style.offset / 1000
    this.setIndex(findCueIndex(this.cues, time))
  }

  private scheduleTick = (): void => {
    if (this.destroyed || !this.video) return
    const v = this.video
    if (v.paused) return // paused: no frames present; `seeked` drives updates
    this.stopTick()
    if (typeof v.requestVideoFrameCallback === 'function') {
      this.rafId = v.requestVideoFrameCallback(this.onFrame)
    } else {
      this.rafId = requestAnimationFrame(this.onFrame)
    }
  }

  private onFrame = (): void => {
    if (this.destroyed) return
    this.refreshOnce()
    this.scheduleTick()
  }

  private stopTick(): void {
    if (!this.rafId) return
    const v = this.video as RVFCVideo | null
    if (typeof v?.cancelVideoFrameCallback === 'function') {
      v.cancelVideoFrameCallback(this.rafId)
    } else {
      cancelAnimationFrame(this.rafId)
    }
    this.rafId = 0
  }

  private detachVideo(): void {
    this.stopTick()
    if (this.video) {
      this.video.removeEventListener('seeked', this.refreshOnce)
      this.video.removeEventListener('play', this.refreshOnce)
      this.video = null
    }
  }
}

/**
 * Index of the cue covering `time`, or -1. Binary search for the last cue
 * starting at or before `time`, then verify it hasn't ended (overlapping cues
 * resolve to the later-starting one, which matches player conventions).
 */
export const findCueIndex = (cues: SubtitleCue[], time: number): number => {
  let low = 0
  let high = cues.length - 1
  let candidate = -1
  while (low <= high) {
    const mid = (low + high) >> 1
    if (cues[mid].start <= time) {
      candidate = mid
      low = mid + 1
    } else {
      high = mid - 1
    }
  }
  return candidate >= 0 && time < cues[candidate].end ? candidate : -1
}

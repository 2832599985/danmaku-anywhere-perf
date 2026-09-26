import type { SubtitleCue } from '@/subtitle/types'

/**
 * Timing settings the controller needs; forwarded by PlayerHost whenever the
 * persisted subtitle settings change.
 */
export interface SubtitleStyle {
  /** timing offset in ms (same sign convention as the danmaku offset: positive
   * values show cues LATER, i.e. lookup time = video time - offset). */
  offset: number
}

export interface SubtitleControllerCallbacks {
  /**
   * Fired when the set of on-screen cues changes — never per frame. `active`
   * lists every cue covering the playhead, in cue (start-time) order: bilingual
   * tracks carry two lines with the same timing, and a long cue can contain a
   * shorter one.
   */
  onActiveChange: (active: readonly SubtitleCue[]) => void
}

type FrameMetadata = { mediaTime: number }

type RVFCVideo = HTMLVideoElement & {
  requestVideoFrameCallback?: (
    cb: (now: number, metadata: FrameMetadata) => void
  ) => number
  cancelVideoFrameCallback?: (handle: number) => void
}

/**
 * How long `timeupdate` stays muted after a presented frame. While frames are
 * flowing they are the authority (they carry the exact media time of what is
 * on screen); `timeupdate` only steps in when none arrive — an occluded or
 * minimized window presents nothing, but the clock keeps running.
 */
const FRAME_AUTHORITY_MS = 350

/** Events that can move the playhead or restart frame delivery. */
const EDGE_EVENTS = ['play', 'playing', 'loadeddata', 'emptied'] as const

/**
 * Subtitle timing engine.
 *
 * Frame-exact: while playing, the active cues are evaluated against the media
 * time of each PRESENTED frame (`requestVideoFrameCallback` metadata), so a
 * line appears with the first frame it belongs to — the clock (`currentTime`)
 * runs a little ahead of the picture.
 *
 * Never stalls: one frame callback stays registered for as long as cues are
 * mounted — paused or not. The previous engine stopped re-registering while
 * paused, so a seek made while paused (one presented frame, callback consumed)
 * ended the chain for good, and `play` only refreshed once: the line froze
 * until the next seek ("按左右键…有概率字幕没出来"). Every edge (play, seeking,
 * new source) re-arms the callback as well, in case the browser dropped it.
 *
 * Instant seeks: `seekTo` (called by the seek commands) and `seeking` evaluate
 * the TARGET time right away instead of waiting for the decoder; frames
 * presented while the seek is in flight still show the old position and are
 * ignored.
 *
 * Cheap: cues are start-sorted with a prefix maximum of end times, so a lookup
 * is a binary search plus a short backward scan; between cue boundaries a
 * cached validity window answers without searching at all.
 */
export class SubtitleController {
  private video: RVFCVideo | null = null
  private cues: SubtitleCue[] = []
  /** maxEnd[i] = latest end among cues[0..i] (bounds the backward scan). */
  private maxEnd: Float64Array = new Float64Array(0)
  private active: SubtitleCue[] = []
  /** The active set is known to hold for media times in [validFrom, validTo). */
  private validFrom = Number.POSITIVE_INFINITY
  private validTo = Number.NEGATIVE_INFINITY
  private offsetSec = 0
  private frameHandle = 0
  private rafHandle = 0
  private lastFrameAt = Number.NEGATIVE_INFINITY
  /** Media time of the latest evaluation (what the screen shows right now). */
  private shownTime = 0
  /**
   * Target of the latest seek until a frame at or past it is presented. A seek
   * lands on the frame at or before the target, and that frame stands for the
   * target — see `frameTime`.
   */
  private seekFloor = Number.NEGATIVE_INFINITY
  private readonly callbacks: SubtitleControllerCallbacks
  private destroyed = false

  constructor(callbacks: SubtitleControllerCallbacks) {
    this.callbacks = callbacks
  }

  /**
   * Mount cues for the given video element (replacing any previous set).
   * Listeners are kept when the element is unchanged — the generated-subtitle
   * pipeline re-mounts every few segments, and an embedded track is mounted
   * twice (the minutes around the playhead first, then the whole track).
   */
  setCues(video: HTMLVideoElement, cues: SubtitleCue[]): void {
    if (this.destroyed) return
    this.attach(video as RVFCVideo)
    this.cues = isSorted(cues)
      ? cues
      : [...cues].sort((a, b) => a.start - b.start)
    this.maxEnd = prefixMaxEnd(this.cues)
    this.invalidate()
    this.evaluate(this.displayTime())
    this.armFrames()
  }

  /** Re-evaluate now (the layer was shown again, a setting changed). */
  refresh(): void {
    if (this.destroyed || !this.video) return
    this.invalidate()
    this.evaluate(this.displayTime())
    this.armFrames()
  }

  /**
   * A seek was just requested (arrow key, progress bar). The element reports
   * `seeking` only in a later task, so the seek commands call this to put the
   * target's lines up within the same keypress.
   */
  seekTo(time: number): void {
    if (this.destroyed || !this.video || !Number.isFinite(time)) return
    this.seekFloor = time
    this.evaluate(time)
    this.armFrames()
  }

  updateStyle(style: SubtitleStyle): void {
    if (this.destroyed) return
    this.offsetSec = style.offset / 1000
    // An offset change can flip which cues are on screen.
    this.refresh()
  }

  clear(): void {
    if (this.destroyed) return
    this.cues = []
    this.maxEnd = new Float64Array(0)
    this.invalidate()
    this.setActive([])
    this.stopFrames()
  }

  destroy(): void {
    this.destroyed = true
    this.detach()
  }

  // --- wiring -------------------------------------------------------------

  private attach(video: RVFCVideo): void {
    if (this.video === video) return
    this.detach()
    this.video = video
    video.addEventListener('seeking', this.onSeeking)
    video.addEventListener('seeked', this.onSeeked)
    video.addEventListener('timeupdate', this.onTimeUpdate)
    video.addEventListener('pause', this.onPause)
    for (const type of EDGE_EVENTS) {
      video.addEventListener(type, this.onEdge)
    }
  }

  private detach(): void {
    this.stopFrames()
    const video = this.video
    if (!video) return
    video.removeEventListener('seeking', this.onSeeking)
    video.removeEventListener('seeked', this.onSeeked)
    video.removeEventListener('timeupdate', this.onTimeUpdate)
    video.removeEventListener('pause', this.onPause)
    for (const type of EDGE_EVENTS) {
      video.removeEventListener(type, this.onEdge)
    }
    this.video = null
  }

  /**
   * (Re-)register the frame callback. Cancel-then-request is idempotent, and
   * it also recovers a callback the browser silently dropped.
   */
  private armFrames(): void {
    const video = this.video
    if (this.destroyed || !video || this.cues.length === 0) return
    if (typeof video.requestVideoFrameCallback === 'function') {
      if (this.frameHandle) video.cancelVideoFrameCallback?.(this.frameHandle)
      this.frameHandle = video.requestVideoFrameCallback(this.onFrame)
      return
    }
    // No rVFC (not the case in WebView2): follow the display while playing.
    if (!this.rafHandle && !video.paused) {
      this.rafHandle = requestAnimationFrame(this.onAnimationFrame)
    }
  }

  private stopFrames(): void {
    if (this.frameHandle) {
      this.video?.cancelVideoFrameCallback?.(this.frameHandle)
      this.frameHandle = 0
    }
    if (this.rafHandle) {
      cancelAnimationFrame(this.rafHandle)
      this.rafHandle = 0
    }
  }

  private onFrame = (_now: number, metadata: FrameMetadata): void => {
    this.frameHandle = 0
    const video = this.video
    if (this.destroyed || !video) return
    this.lastFrameAt = performance.now()
    // A frame presented mid-seek still shows the OLD position; the lines for
    // the target are already up.
    if (!video.seeking) this.evaluate(this.frameTime(video, metadata))
    this.armFrames()
  }

  private onAnimationFrame = (): void => {
    this.rafHandle = 0
    const video = this.video
    if (this.destroyed || !video) return
    if (!video.seeking) this.evaluate(video.currentTime)
    if (!video.paused) this.armFrames()
  }

  /**
   * The media time a presented frame stands for. While playing that is the
   * frame's own timestamp. While paused, and for frames between a seek's
   * landing frame and its target, it is the target: a seek lands on the frame
   * at or before the time asked for, and that frame's earlier timestamp would
   * blink off a line that starts in between.
   */
  private frameTime(video: RVFCVideo, metadata: FrameMetadata): number {
    const clock = video.currentTime
    if (video.paused) return clock
    const media = Number.isFinite(metadata?.mediaTime)
      ? metadata.mediaTime
      : clock
    if (media < this.seekFloor) return this.seekFloor
    this.seekFloor = Number.NEGATIVE_INFINITY
    return media
  }

  /**
   * Best time for an evaluation that does not come with a frame: the time on
   * screen while frames are flowing (re-evaluating at the clock, which runs
   * ahead, could show a line one frame early and then take it back), the
   * clock otherwise.
   */
  private displayTime(): number {
    const video = this.video
    if (!video) return 0
    const flowing =
      !video.paused &&
      !video.seeking &&
      performance.now() - this.lastFrameAt < FRAME_AUTHORITY_MS
    return flowing ? this.shownTime : video.currentTime
  }

  private onSeeking = (): void => {
    const target = this.video?.currentTime ?? 0
    this.seekFloor = target
    this.evaluate(target)
    this.armFrames()
  }

  private onSeeked = (): void => {
    this.evaluate(this.video?.currentTime ?? 0)
    this.armFrames()
  }

  private onTimeUpdate = (): void => {
    if (performance.now() - this.lastFrameAt < FRAME_AUTHORITY_MS) return
    const video = this.video
    if (!video || video.seeking) return
    this.evaluate(video.currentTime)
  }

  private onPause = (): void => {
    // The frame on screen was already evaluated when it was presented; only
    // fall back to the clock when no frames have been arriving.
    if (performance.now() - this.lastFrameAt < FRAME_AUTHORITY_MS) return
    this.evaluate(this.video?.currentTime ?? 0)
  }

  private onEdge = (event: Event): void => {
    // A new source starts a new timeline; an old seek target means nothing.
    if (event.type === 'emptied' || event.type === 'loadeddata') {
      this.seekFloor = Number.NEGATIVE_INFINITY
    }
    this.invalidate()
    const video = this.video
    if (video && !video.seeking) this.evaluate(video.currentTime)
    this.armFrames()
  }

  // --- lookup -------------------------------------------------------------

  private invalidate(): void {
    this.validFrom = Number.POSITIVE_INFINITY
    this.validTo = Number.NEGATIVE_INFINITY
  }

  /** Evaluate the active cues at media time `videoTime` (offset applied). */
  private evaluate(videoTime: number): void {
    if (this.destroyed || !Number.isFinite(videoTime)) return
    this.shownTime = videoTime
    const time = videoTime - this.offsetSec
    if (time >= this.validFrom && time < this.validTo) return
    const { active, from, to } = findActiveCues(this.cues, this.maxEnd, time)
    this.validFrom = from
    this.validTo = to
    this.setActive(active)
  }

  private setActive(next: SubtitleCue[]): void {
    const current = this.active
    if (
      next.length === current.length &&
      next.every((cue, index) => cue === current[index])
    ) {
      return
    }
    this.active = next
    this.callbacks.onActiveChange(next)
  }
}

const isSorted = (cues: SubtitleCue[]): boolean => {
  for (let i = 1; i < cues.length; i += 1) {
    if (cues[i].start < cues[i - 1].start) return false
  }
  return true
}

const prefixMaxEnd = (cues: SubtitleCue[]): Float64Array => {
  const out = new Float64Array(cues.length)
  let max = Number.NEGATIVE_INFINITY
  for (let i = 0; i < cues.length; i += 1) {
    max = Math.max(max, cues[i].end)
    out[i] = max
  }
  return out
}

/**
 * Every cue covering `time` (start <= time < end), in array order, plus the
 * window [from, to) around `time` in which that answer cannot change: it ends
 * at the next boundary (a cue starting, or an active cue ending) and begins at
 * the latest boundary at or before `time`. `cues` must be start-sorted and
 * `maxEnd` its prefix maximum of end times.
 */
export const findActiveCues = (
  cues: SubtitleCue[],
  maxEnd: Float64Array,
  time: number
): { active: SubtitleCue[]; from: number; to: number } => {
  // Last cue starting at or before `time`.
  let low = 0
  let high = cues.length - 1
  let last = -1
  while (low <= high) {
    const mid = (low + high) >> 1
    if (cues[mid].start <= time) {
      last = mid
      low = mid + 1
    } else {
      high = mid - 1
    }
  }
  let to =
    last + 1 < cues.length ? cues[last + 1].start : Number.POSITIVE_INFINITY
  let from = last >= 0 ? cues[last].start : Number.NEGATIVE_INFINITY
  const active: SubtitleCue[] = []
  // Walk back while an earlier cue can still be running; maxEnd bounds it.
  let i = last
  for (; i >= 0 && maxEnd[i] > time; i -= 1) {
    const cue = cues[i]
    if (cue.end > time) {
      active.push(cue)
      if (cue.end < to) to = cue.end
    } else if (cue.end > from) {
      // An earlier cue that ended after the latest start is a closer boundary.
      from = cue.end
    }
  }
  // Everything before the scan stopped ended by maxEnd[i] — also a boundary.
  if (i >= 0 && maxEnd[i] > from) from = maxEnd[i]
  active.reverse()
  return { active, from, to }
}

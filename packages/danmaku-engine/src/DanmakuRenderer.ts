import {
  type CommentEntity,
  parseCommentEntityTime,
} from '@danmaku-anywhere/danmaku-converter'
import { create, type Manager } from '@mr-quin/danmu'
import { type DanmakuOptions, DEFAULT_DANMAKU_OPTIONS } from './options'
import {
  applyFilter,
  type ParsedComment,
  type TimedComment,
  transformComment,
} from './parser'
import { bindVideo } from './plugins/bindVideo'
import { deepEqual } from './utils'
import { applyParsedChunk } from './worker/applyParsedChunk'
import type {
  ParseChunkMessage,
  ParseDoneMessage,
  ParseRequestMessage,
} from './worker/types'

const WORKER_THRESHOLD = 5000
// Smaller chunks reduce "time to first parsed batch", which helps keep playback
// timeline aligned (avoids main-thread on-demand parsing early in playback).
const WORKER_CHUNK_SIZE = 300
const IDLE_CHUNK_SIZE = 300
const IDLE_MIN_TIME_REMAINING = 4
const IDLE_POLYFILL_BUDGET_MS = 12
const WARMUP_BUDGET_MS = 6
const WARMUP_MAX_COMMENTS = 400

const requestIdle = (cb: IdleRequestCallback): number => {
  if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
    return window.requestIdleCallback(cb)
  }
  // Polyfill: give a small but non-zero budget so we don't degenerate into
  // "one item per tick" parsing on browsers without requestIdleCallback.
  return setTimeout(() => {
    cb({
      didTimeout: true,
      timeRemaining: () => IDLE_POLYFILL_BUDGET_MS,
    })
  }, 0) as unknown as number
}

const cancelIdle = (id: number) => {
  if (typeof window !== 'undefined' && 'cancelIdleCallback' in window) {
    window.cancelIdleCallback(id)
    return
  }
  clearTimeout(id as unknown as number)
}

export type DanmakuRenderProps = {
  text: string
  styles: Record<string, string>
  mode: ParsedComment['mode']
  color: string
  gradient?: ParsedComment['gradient']
}

export type PerfReporter = (
  label: string,
  durationMs: number,
  meta?: Record<string, unknown>
) => void

export type RemotePreparseRequest = {
  taskId: number
  comments: CommentEntity[]
  chunkSize: number
  startIndex: number
}

export type RemotePreparseChunk = {
  type: 'chunk'
  taskId: number
  startIndex: number
  parsed: Array<ParsedComment | undefined>
}

export type RemotePreparseDone = {
  type: 'done'
  taskId: number
  totalMs: number
}

export type RemotePreparseHandlers = {
  onChunk: (msg: RemotePreparseChunk) => void
  onDone: (msg: RemotePreparseDone) => void
  onError: (error: unknown) => void
}

export type RemotePreparseJob = {
  cancel: () => void
}

export type RemotePreparseTransport = {
  start: (
    req: RemotePreparseRequest,
    handlers: RemotePreparseHandlers
  ) => RemotePreparseJob
}

export class DanmakuRenderer {
  manager?: Manager<ParsedComment>
  container?: HTMLElement
  media?: HTMLMediaElement
  comments: CommentEntity[] = []
  config: DanmakuOptions = DEFAULT_DANMAKU_OPTIONS
  created = false
  private perfReporter?: PerfReporter
  private preparseTaskId = 0
  private idleHandle: number | null = null
  private visibilityHandle: number | null = null
  private worker?: Worker
  private workerDisabledReason: string | null = null
  private remotePreparseTransport?: RemotePreparseTransport
  private remoteJob?: RemotePreparseJob

  constructor(
    public render: (node: HTMLElement, renderProps: DanmakuRenderProps) => void
  ) {}

  setPerfReporter(reporter?: PerfReporter) {
    this.perfReporter = reporter
  }

  setRemotePreparseTransport(transport?: RemotePreparseTransport) {
    this.remotePreparseTransport = transport
  }

  create(
    container: HTMLElement,
    media: HTMLMediaElement,
    comments: CommentEntity[],
    config?: Partial<DanmakuOptions>
  ): void {
    if (this.created) this.destroy()
    this.cancelPreparse()

    this.container = container
    this.media = media
    this.comments = comments
    this.config = this.mergeConfig(config)

    const mountStart = performance.now()

    const timeParseStart = performance.now()
    const timedComments: TimedComment[] = []
    let isSorted = true
    let lastTime = Number.NEGATIVE_INFINITY

    for (const comment of comments) {
      const time = parseCommentEntityTime(comment.p)
      if (!Number.isFinite(time)) {
        continue
      }
      if (time < lastTime) {
        isSorted = false
      }
      lastTime = time
      timedComments.push({ time, raw: comment })
    }
    const timeParseMs = performance.now() - timeParseStart
    this.perfReporter?.('time_parse_ms', timeParseMs, {
      total: comments.length,
      valid: timedComments.length,
    })

    let sortMs = 0
    if (!isSorted) {
      const sortStart = performance.now()
      timedComments.sort((a, b) => a.time - b.time)
      sortMs = performance.now() - sortStart
    }
    this.perfReporter?.('sort_ms', sortMs, {
      sorted: !isSorted,
      count: timedComments.length,
    })

    // Warm up parsing for the comments closest to the current playback cursor.
    // This reduces the chance of the timeupdate loop needing to synchronously
    // transform comments on the main thread (which makes some comments appear late).
    const preparseStartIndex = this.getPreparseStartIndex(timedComments)
    this.warmupPreparse(timedComments, preparseStartIndex)

    const managerStart = performance.now()
    const manager = create<ParsedComment>({
      trackHeight: this.config.trackHeight,
      rate: this.config.speed / 2,
      interval: this.config.interval,
      durationRange: [5000, 5000],
      mode: 'strict',
      distribution: this.config.distribution,
      overlap: this.config.overlap / 100,
      limits: {
        view: this.config.maxOnScreen,
        stash: this.config.maxOnScreen * 2,
      },
      plugin: {
        init: bindVideo(this.media, timedComments, () => this.config),
        $createNode: (danmaku, node) => {
          // font size and family are set here because it needs to be set BEFORE
          // size is calculated
          // Setting it using manager.setStyle applies the style AFTER size is calculated so it's too late
          node.style.fontSize = `${this.config.style.fontSize}px`
          node.style.fontFamily = this.config.style.fontFamily

          // apply the parser-generated styles
          Object.entries(danmaku.data.style).forEach(([key, value]) => {
            // biome-ignore lint/suspicious/noExplicitAny: key should be a valid css property
            node.style[key as any] = value
          })

          // force top/bottom comments to be on top
          if (danmaku.data.mode === 'top' || danmaku.data.mode === 'bottom') {
            node.style.zIndex = '9'
          }

          this.render(node, {
            text: danmaku.data.text,
            styles: { ...danmaku.data.style },
            mode: danmaku.data.mode,
            color: danmaku.data.color,
            gradient: danmaku.data.gradient,
          })
        },
        willRender: (ref) => {
          if (applyFilter(ref.danmaku.data.text, this.config.filters)) {
            ref.prevent = true
          }
          return ref
        },
      },
    })
    this.manager = manager

    manager.mount(container)

    this.setArea()
    this.updateOptions()

    if (!this.media.paused) {
      manager.startPlaying()
    }

    if (this.config.show) {
      void manager.show()
    } else {
      void manager.hide()
    }

    const managerMs = performance.now() - managerStart
    this.perfReporter?.('manager_create_ms', managerMs, {
      count: timedComments.length,
    })

    const mountTotalMs = performance.now() - mountStart
    this.perfReporter?.('mount_total_ms', mountTotalMs, {
      count: timedComments.length,
    })

    this.startPreparse(timedComments)
    this.created = true
  }

  updateConfig(config: Partial<DanmakuOptions>): void {
    const prevConfig = this.config
    this.config = this.mergeConfig(config)

    if (!this.manager) return

    if (!deepEqual(prevConfig.area, this.config.area)) {
      this.setArea()
    }

    this.updateOptions()
  }

  private updateOptions = () => {
    if (!this.manager) return

    this.manager.updateOptions({
      trackHeight: this.config.trackHeight,
      limits: {
        view: this.config.maxOnScreen,
        stash: this.config.maxOnScreen * 2,
      },
      rate: this.config.speed / 2,
      interval: this.config.interval,
      overlap: this.config.overlap / 100,
    })
    this.manager.setStyle('opacity', this.config.style.opacity.toString())
    this.manager.setStyle('pointerEvents', 'none')
    this.manager.setStyle('fontSize', `${this.config.style.fontSize}px`)
    this.manager.setStyle('fontFamily', this.config.style.fontFamily)
  }

  private setArea = () => {
    if (!this.manager) return

    this.manager.setArea({
      y: {
        start: `${this.config.area.yStart}%`,
        end: `${this.config.area.yEnd}%`,
      },
      x: {
        start: `${this.config.area.xStart}%`,
        end: `${this.config.area.xEnd}%`,
      },
    })
  }

  private mergeConfig = (config?: Partial<DanmakuOptions>): DanmakuOptions => {
    if (!config) return this.config

    // manually merge nested objects
    const style = { ...this.config.style, ...config.style }
    const area = { ...this.config.area, ...config.area }
    const specialComments = {
      ...this.config.specialComments,
      ...config.specialComments,
    }
    return { ...this.config, ...config, style, area, specialComments }
  }

  destroy(): void {
    this.cancelPreparse()
    this.manager?.stopPlaying()
    this.manager?.unmount()
    this.manager = undefined
    this.container = undefined
    this.media = undefined
    this.comments = []
    this.created = false
  }

  // Pass through methods
  show(): void {
    this.manager?.show()
  }

  hide(): void {
    this.manager?.hide()
  }

  clear(): void {
    this.manager?.clear()
  }

  resize(): void {
    if (!this.manager) return
    this.manager.format()
    if (!this.manager.isFreeze()) {
      // Freezing and unfreezing the manager to force danmaku position to be recalculated
      this.manager.freeze()
      this.manager.unfreeze()
    }
  }

  private getPreparseStartIndex(timedComments: TimedComment[]): number {
    // Match the bindVideo cursor logic: include a small "catch-up" window so we
    // prioritize parsing comments that may be emitted immediately.
    const CATCH_UP_WINDOW_S = 5

    const media = this.media
    if (!media) return 0
    const total = timedComments.length
    if (total === 0) return 0

    const offsetS = this.config.offset / 1000
    const base = media.currentTime - offsetS - CATCH_UP_WINDOW_S
    const targetTime = Math.max(0, Number.isFinite(base) ? base : 0)

    // Lower bound: first index with time >= targetTime.
    let low = 0
    let high = total - 1
    let ans = total

    while (low <= high) {
      const mid = Math.floor((low + high) / 2)
      const t = timedComments[mid].time
      if (t >= targetTime) {
        ans = mid
        high = mid - 1
      } else {
        low = mid + 1
      }
    }

    // If we're beyond the last comment time, just start from 0.
    return ans >= total ? 0 : ans
  }

  private warmupPreparse(timedComments: TimedComment[], startIndex: number) {
    const total = timedComments.length
    if (total === 0) return

    const safeStart = Number.isFinite(startIndex)
      ? Math.min(Math.max(Math.trunc(startIndex), 0), total)
      : 0

    const start = performance.now()
    let processed = 0
    let parsedOk = 0
    let parsedFail = 0

    for (let i = 0; i < total && processed < WARMUP_MAX_COMMENTS; i += 1) {
      const idx = (safeStart + i) % total
      const entry = timedComments[idx]
      if (entry.parsed || entry.parseError) continue

      try {
        entry.parsed = transformComment(entry.raw, 0)
        parsedOk += 1
      } catch {
        entry.parseError = true
        parsedFail += 1
      }

      processed += 1
      if (performance.now() - start >= WARMUP_BUDGET_MS) {
        break
      }
    }

    const totalMs = performance.now() - start
    if (processed > 0) {
      this.perfReporter?.('warmup_preparse_ms', totalMs, {
        processed,
        ok: parsedOk,
        fail: parsedFail,
      })
    }
  }

  private startPreparse(timedComments: TimedComment[]) {
    if (timedComments.length === 0) return

    this.preparseTaskId += 1
    const taskId = this.preparseTaskId

    const startIndex = this.getPreparseStartIndex(timedComments)

    const workerStarted = this.startWorkerParse(
      timedComments,
      taskId,
      startIndex
    )
    if (!workerStarted) {
      const remoteStarted = this.startRemoteParse(
        timedComments,
        taskId,
        startIndex
      )
      if (!remoteStarted) {
        this.scheduleIdlePreparse(timedComments, taskId, startIndex)
      }
    }
  }

  private startWorkerParse(
    timedComments: TimedComment[],
    taskId: number,
    startIndex: number
  ): boolean {
    if (timedComments.length < WORKER_THRESHOLD) {
      return false
    }
    if (typeof Worker === 'undefined') {
      return false
    }
    if (this.workerDisabledReason) {
      return false
    }

    this.terminateWorker()
    let worker: Worker
    try {
      // Content scripts can be subject to the page's CSP. Some sites disallow creating
      // workers from extension URLs (chrome-extension://...), which throws here.
      worker = new Worker(
        new URL('./worker/danmakuParse.worker.ts', import.meta.url),
        { type: 'module' }
      )
    } catch (e) {
      const message =
        e instanceof Error ? e.message : 'Worker construction failed'
      this.workerDisabledReason = message
      this.perfReporter?.('worker_unavailable', 0, { reason: message })
      return false
    }

    this.worker = worker
    // rawComments indices must match timedComments indices 1:1 since both are derived from the same filtered source.
    const rawComments = timedComments.map((item) => item.raw)
    this.perfReporter?.('worker_start', 0, { count: rawComments.length })

    worker.onmessage = (
      event: MessageEvent<ParseChunkMessage | ParseDoneMessage>
    ) => {
      const msg = event.data
      if (msg.taskId !== taskId) return
      if (msg.type === 'chunk') {
        applyParsedChunk(timedComments, msg.startIndex, msg.parsed)
      } else if (msg.type === 'done') {
        this.perfReporter?.('worker_done_ms', msg.totalMs, {
          count: rawComments.length,
        })
        this.terminateWorker()
      }
    }

    worker.onerror = () => {
      // Avoid retrying on subsequent mounts for sites that consistently block workers via CSP.
      this.workerDisabledReason = 'worker error event'
      this.terminateWorker()
      const remoteStarted = this.startRemoteParse(
        timedComments,
        taskId,
        startIndex
      )
      if (!remoteStarted) {
        this.scheduleIdlePreparse(timedComments, taskId, startIndex)
      }
    }

    const request: ParseRequestMessage = {
      type: 'parse',
      taskId,
      comments: rawComments,
      chunkSize: WORKER_CHUNK_SIZE,
      startIndex,
    }
    worker.postMessage(request)
    return true
  }

  private startRemoteParse(
    timedComments: TimedComment[],
    taskId: number,
    startIndex: number
  ): boolean {
    if (!this.remotePreparseTransport) {
      return false
    }
    if (timedComments.length < WORKER_THRESHOLD) {
      return false
    }

    this.terminateRemote()

    // rawComments indices must match timedComments indices 1:1 since both are derived from the same filtered source.
    const rawComments = timedComments.map((item) => item.raw)
    this.perfReporter?.('remote_parse_start', 0, { count: rawComments.length })

    let job: RemotePreparseJob
    try {
      job = this.remotePreparseTransport.start(
        {
          taskId,
          comments: rawComments,
          chunkSize: WORKER_CHUNK_SIZE,
          startIndex,
        },
        {
          onChunk: (msg) => {
            if (msg.taskId !== taskId) return
            if (taskId !== this.preparseTaskId) return
            applyParsedChunk(timedComments, msg.startIndex, msg.parsed)
          },
          onDone: (msg) => {
            if (msg.taskId !== taskId) return
            if (taskId !== this.preparseTaskId) return
            this.perfReporter?.('remote_parse_done_ms', msg.totalMs, {
              count: rawComments.length,
            })
            this.terminateRemote()
          },
          onError: (error) => {
            if (taskId !== this.preparseTaskId) return
            const message =
              error instanceof Error ? error.message : String(error)
            this.perfReporter?.('remote_parse_error', 0, { reason: message })
            this.terminateRemote()
            this.scheduleIdlePreparse(timedComments, taskId, startIndex)
          },
        }
      )
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      this.perfReporter?.('remote_parse_unavailable', 0, { reason: message })
      return false
    }

    this.remoteJob = job
    return true
  }

  private scheduleIdlePreparse(
    timedComments: TimedComment[],
    taskId: number,
    startIndex: number
  ) {
    const total = timedComments.length
    let index = Number.isFinite(startIndex)
      ? Math.min(Math.max(Math.trunc(startIndex), 0), total)
      : 0
    if (index >= total) index = 0
    let visited = 0
    let totalMs = 0

    const step = (deadline: IdleDeadline) => {
      if (taskId !== this.preparseTaskId) return
      if (
        typeof document !== 'undefined' &&
        document.visibilityState !== 'visible'
      ) {
        if (this.visibilityHandle !== null) {
          clearTimeout(this.visibilityHandle)
        }
        this.visibilityHandle = setTimeout(() => {
          this.visibilityHandle = null
          this.idleHandle = requestIdle(step)
        }, 1000) as unknown as number
        return
      }

      const start = performance.now()
      let processed = 0

      while (visited < total) {
        const entry = timedComments[index]
        if (!entry.parsed && !entry.parseError) {
          try {
            entry.parsed = transformComment(entry.raw, 0)
          } catch {
            entry.parseError = true
          }
          processed += 1
        }

        index += 1
        if (index >= total) index = 0
        visited += 1

        if (processed >= IDLE_CHUNK_SIZE) {
          break
        }
        if (deadline.timeRemaining() < IDLE_MIN_TIME_REMAINING) {
          break
        }
      }

      totalMs += performance.now() - start

      if (visited < total) {
        this.idleHandle = requestIdle(step)
      } else {
        this.perfReporter?.('idle_preparse_total_ms', totalMs, {
          count: total,
        })
      }
    }

    this.idleHandle = requestIdle(step)
  }

  private cancelPreparse() {
    this.preparseTaskId += 1
    if (this.idleHandle !== null) {
      cancelIdle(this.idleHandle)
      this.idleHandle = null
    }
    if (this.visibilityHandle !== null) {
      clearTimeout(this.visibilityHandle)
      this.visibilityHandle = null
    }
    this.terminateWorker()
    this.terminateRemote()
  }

  private terminateWorker() {
    if (!this.worker) return
    this.worker.terminate()
    this.worker = undefined
  }

  private terminateRemote() {
    if (!this.remoteJob) return
    this.remoteJob.cancel()
    this.remoteJob = undefined
  }
}

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
const WORKER_CHUNK_SIZE = 1000
const IDLE_CHUNK_SIZE = 300
const IDLE_MIN_TIME_REMAINING = 4
const IDLE_POLYFILL_BUDGET_MS = 12

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
}

export type PerfReporter = (
  label: string,
  durationMs: number,
  meta?: Record<string, unknown>
) => void

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

  constructor(
    public render: (node: HTMLElement, renderProps: DanmakuRenderProps) => void
  ) {}

  setPerfReporter(reporter?: PerfReporter) {
    this.perfReporter = reporter
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

    for (let i = 0; i < comments.length; i += 1) {
      const comment = comments[i]
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

    // manually merge styles
    const style = { ...this.config.style, ...config.style }
    return { ...this.config, ...config, style }
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

  private startPreparse(timedComments: TimedComment[]) {
    if (timedComments.length === 0) return

    this.preparseTaskId += 1
    const taskId = this.preparseTaskId

    const workerStarted = this.startWorkerParse(timedComments, taskId)
    if (!workerStarted) {
      this.scheduleIdlePreparse(timedComments, taskId)
    }
  }

  private startWorkerParse(
    timedComments: TimedComment[],
    taskId: number
  ): boolean {
    if (timedComments.length < WORKER_THRESHOLD) {
      return false
    }
    if (typeof Worker === 'undefined') {
      return false
    }

    this.terminateWorker()
    const worker = new Worker(
      new URL('./worker/danmakuParse.worker.ts', import.meta.url),
      { type: 'module' }
    )
    this.worker = worker
    const rawComments = timedComments.map((item) => item.raw)
    this.perfReporter?.('worker_start', 0, { count: rawComments.length })

    worker.onmessage = (event: MessageEvent<ParseChunkMessage | ParseDoneMessage>) => {
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
      this.terminateWorker()
      this.scheduleIdlePreparse(timedComments, taskId)
    }

    const request: ParseRequestMessage = {
      type: 'parse',
      taskId,
      comments: rawComments,
      chunkSize: WORKER_CHUNK_SIZE,
    }
    worker.postMessage(request)
    return true
  }

  private scheduleIdlePreparse(
    timedComments: TimedComment[],
    taskId: number
  ) {
    const total = timedComments.length
    let index = 0
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

      while (index < total) {
        const entry = timedComments[index]
        if (!entry.parsed) {
          entry.parsed = transformComment(entry.raw, 0)
          processed += 1
        }
        index += 1

        if (processed >= IDLE_CHUNK_SIZE) {
          break
        }
        if (deadline.timeRemaining() < IDLE_MIN_TIME_REMAINING) {
          break
        }
      }

      totalMs += performance.now() - start

      if (index < total) {
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
  }

  private terminateWorker() {
    if (!this.worker) return
    this.worker.terminate()
    this.worker = undefined
  }
}

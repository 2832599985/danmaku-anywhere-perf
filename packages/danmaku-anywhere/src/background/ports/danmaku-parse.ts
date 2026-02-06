import type { CommentEntity } from '@danmaku-anywhere/danmaku-converter'
import { transformComment } from '@danmaku-anywhere/danmaku-engine'
import type {
  DanmakuParseBgToClientMessage,
  DanmakuParseClientToBgMessage,
} from '@/common/ports/danmakuParsePort'
import { portNames } from '@/common/ports/portNames'

type AnyPort = chrome.runtime.Port

type YieldFn = () => Promise<void>

export const createDanmakuParsePortHandler = (deps?: {
  // For tests.
  transform?: (c: CommentEntity) => ReturnType<typeof transformComment>
  yieldBetweenChunks?: YieldFn
}) => {
  const doTransform =
    deps?.transform ?? ((c: CommentEntity) => transformComment(c, 0))
  const yieldBetweenChunks: YieldFn =
    deps?.yieldBetweenChunks ?? (() => new Promise((r) => setTimeout(r, 0)))

  return (port: AnyPort) => {
    let activeTaskId: number | null = null
    let ended = false
    let cancelled = false
    let totalMs = 0
    let session = 0

    const queue: Array<{
      taskId: number
      startIndex: number
      comments: CommentEntity[]
    }> = []
    let processing = false
    let processingSession = 0
    let pendingRun = false

    const post = (msg: DanmakuParseBgToClientMessage) => {
      try {
        port.postMessage(msg)
      } catch {
        // Port might already be gone.
      }
    }

    const reset = () => {
      activeTaskId = null
      ended = false
      cancelled = false
      totalMs = 0
      queue.length = 0
      processing = false
      session += 1
    }

    const processQueue = async () => {
      if (processing) {
        // If we're already draining the queue for the current session, don't start a concurrent loop.
        // Instead, remember that we should run again after the current loop exits (edge-case safety).
        if (processingSession === session) {
          pendingRun = true
          return
        }
      }
      processing = true
      processingSession = session
      const sid = session
      try {
        // eslint-disable-next-line no-constant-condition
        while (true) {
          if (sid !== session) return
          if (cancelled) return
          const item = queue.shift()
          if (!item) break
          if (activeTaskId === null || item.taskId !== activeTaskId) {
            continue
          }

          const start = performance.now()
          const parsed: Array<ReturnType<typeof transformComment> | undefined> =
            new Array(item.comments.length)

          for (let i = 0; i < item.comments.length; i += 1) {
            if (cancelled) return
            try {
              parsed[i] = doTransform(item.comments[i])
            } catch {
              parsed[i] = undefined
            }
          }
          totalMs += performance.now() - start

          post({
            type: 'chunk',
            taskId: item.taskId,
            startIndex: item.startIndex,
            parsed,
          })

          // Yield between chunks to avoid long monopolization.
          await yieldBetweenChunks()
        }

        if (
          !cancelled &&
          ended &&
          activeTaskId !== null &&
          queue.length === 0
        ) {
          post({ type: 'done', taskId: activeTaskId, totalMs })
          reset()
        }
      } catch (e) {
        const taskId = activeTaskId ?? -1
        post({
          type: 'error',
          taskId,
          message: e instanceof Error ? e.message : String(e),
        })
        reset()
      } finally {
        if (processingSession === sid) {
          processing = false
        }
        // If messages arrived while we were in-flight and asked for another drain, run once more.
        // This is session-agnostic: it will pick up whatever the current session state is now.
        if (pendingRun) {
          pendingRun = false
          // Avoid await recursion; schedule a follow-up drain.
          void processQueue()
        }
      }
    }

    port.onMessage.addListener((msg: DanmakuParseClientToBgMessage) => {
      if (!msg || typeof msg !== 'object') return

      switch (msg.type) {
        case 'begin': {
          session += 1
          activeTaskId = msg.taskId
          ended = false
          cancelled = false
          totalMs = 0
          queue.length = 0
          return
        }
        case 'comments': {
          if (activeTaskId === null || msg.taskId !== activeTaskId) return
          queue.push({
            taskId: msg.taskId,
            startIndex: msg.startIndex,
            comments: msg.comments,
          })
          void processQueue()
          return
        }
        case 'end': {
          if (activeTaskId === null || msg.taskId !== activeTaskId) return
          ended = true
          void processQueue()
          return
        }
        case 'cancel': {
          if (activeTaskId === null || msg.taskId !== activeTaskId) return
          cancelled = true
          session += 1
          activeTaskId = null
          ended = false
          totalMs = 0
          queue.length = 0
          return
        }
      }
    })

    port.onDisconnect.addListener(() => {
      cancelled = true
      session += 1
      activeTaskId = null
      ended = false
      totalMs = 0
      queue.length = 0
    })
  }
}

export const setupDanmakuParse = () => {
  const handlePort = createDanmakuParsePortHandler()

  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== portNames.danmakuParse) return
    handlePort(port)
  })
}

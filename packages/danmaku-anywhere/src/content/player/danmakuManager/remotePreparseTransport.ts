import type { CommentEntity } from '@danmaku-anywhere/danmaku-converter'
import type {
  RemotePreparseHandlers,
  RemotePreparseJob,
  RemotePreparseRequest,
  RemotePreparseTransport,
} from '@danmaku-anywhere/danmaku-engine'
import type {
  DanmakuParseBgToClientMessage,
  DanmakuParseClientToBgMessage,
} from '@/common/ports/danmakuParsePort'
import { portNames } from '@/common/ports/portNames'

export const createRemotePreparseTransport = (): RemotePreparseTransport => {
  return {
    start: (
      req: RemotePreparseRequest,
      handlers: RemotePreparseHandlers
    ): RemotePreparseJob => {
      const port = chrome.runtime.connect({ name: portNames.danmakuParse })

      let cancelled = false

      const send = (msg: DanmakuParseClientToBgMessage) => {
        if (cancelled) return
        port.postMessage(msg)
      }

      const onMessage = (msg: DanmakuParseBgToClientMessage) => {
        if (cancelled) return
        if (!msg || msg.taskId !== req.taskId) return
        if (msg.type === 'chunk') {
          handlers.onChunk(msg)
        } else if (msg.type === 'done') {
          handlers.onDone(msg)
        } else if (msg.type === 'error') {
          handlers.onError(new Error(msg.message))
        }
      }

      const onDisconnect = () => {
        if (cancelled) return
        handlers.onError(new Error('danmaku-parse port disconnected'))
      }

      port.onMessage.addListener(onMessage)
      port.onDisconnect.addListener(onDisconnect)

      const total = req.comments.length
      const chunkSize = Math.max(1, req.chunkSize)
      const safeStart = Number.isFinite(req.startIndex)
        ? Math.min(Math.max(Math.trunc(req.startIndex), 0), total)
        : 0

      send({ type: 'begin', taskId: req.taskId, chunkSize, total })

      const sendRange = (from: number, to: number) => {
        for (let startIndex = from; startIndex < to; startIndex += chunkSize) {
          const end = Math.min(startIndex + chunkSize, to)
          const slice: CommentEntity[] = req.comments.slice(startIndex, end)
          send({
            type: 'comments',
            taskId: req.taskId,
            startIndex,
            comments: slice,
          })
        }
      }

      // Prioritize parsing near the current playback cursor first.
      sendRange(safeStart, total)
      sendRange(0, safeStart)

      send({ type: 'end', taskId: req.taskId })

      return {
        cancel: () => {
          if (cancelled) return
          cancelled = true
          try {
            port.onMessage.removeListener(onMessage)
            port.onDisconnect.removeListener(onDisconnect)
          } catch {
            // ignore
          }
          try {
            port.postMessage({ type: 'cancel', taskId: req.taskId })
          } catch {
            // ignore
          }
          try {
            port.disconnect()
          } catch {
            // ignore
          }
        },
      }
    },
  }
}

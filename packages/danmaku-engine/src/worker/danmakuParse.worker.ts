/// <reference lib="webworker" />
import type { CommentEntity } from '@danmaku-anywhere/danmaku-converter'
import type { ParsedComment } from '../parser'
import { transformComment } from '../parser'
import type {
  ParseChunkMessage,
  ParseDoneMessage,
  ParseRequestMessage,
} from './types'

const ctx: DedicatedWorkerGlobalScope = self as DedicatedWorkerGlobalScope

const parseComments = (
  taskId: number,
  comments: CommentEntity[],
  chunkSize: number,
  startIndex?: number
) => {
  const safeChunkSize = Math.max(1, chunkSize)
  const total = comments.length
  const safeStart = Number.isFinite(startIndex)
    ? Math.min(Math.max(Math.trunc(startIndex as number), 0), total)
    : 0
  const start = performance.now()

  const parseRange = (rangeStart: number, rangeEnd: number) => {
    let index = rangeStart
    while (index < rangeEnd) {
      const end = Math.min(index + safeChunkSize, rangeEnd)
      const parsed: Array<ParsedComment | undefined> = []

      for (let i = index; i < end; i += 1) {
        try {
          parsed.push(transformComment(comments[i], 0))
        } catch {
          // Keep holes instead of crashing the whole worker.
          parsed.push(undefined)
        }
      }

      const chunkMessage: ParseChunkMessage = {
        type: 'chunk',
        taskId,
        startIndex: index,
        parsed,
      }
      ctx.postMessage(chunkMessage)

      index = end
    }
  }

  // Prioritize parsing comments near the playback cursor. This reduces the chance of
  // main-thread parsing causing visible timeline drift during playback.
  parseRange(safeStart, total)
  parseRange(0, safeStart)

  const doneMessage: ParseDoneMessage = {
    type: 'done',
    taskId,
    totalMs: performance.now() - start,
  }
  ctx.postMessage(doneMessage)
}

ctx.addEventListener('message', (event: MessageEvent<ParseRequestMessage>) => {
  const data = event.data
  if (!data || data.type !== 'parse') {
    return
  }
  parseComments(data.taskId, data.comments, data.chunkSize, data.startIndex)
})

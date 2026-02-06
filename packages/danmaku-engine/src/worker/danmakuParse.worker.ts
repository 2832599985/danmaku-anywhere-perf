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
  chunkSize: number
) => {
  const safeChunkSize = Math.max(1, chunkSize)
  const start = performance.now()

  let index = 0
  while (index < comments.length) {
    const end = Math.min(index + safeChunkSize, comments.length)
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
  parseComments(data.taskId, data.comments, data.chunkSize)
})

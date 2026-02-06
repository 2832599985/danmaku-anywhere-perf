import type { CommentEntity } from '@danmaku-anywhere/danmaku-converter'
import type { ParsedComment } from '../parser'

export type ParseRequestMessage = {
  type: 'parse'
  taskId: number
  comments: CommentEntity[]
  chunkSize: number
}

export type ParseChunkMessage = {
  type: 'chunk'
  taskId: number
  startIndex: number
  parsed: Array<ParsedComment | undefined>
}

export type ParseDoneMessage = {
  type: 'done'
  taskId: number
  totalMs: number
}

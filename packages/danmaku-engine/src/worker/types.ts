import type { CommentEntity } from '@danmaku-anywhere/danmaku-converter'
import type { ParsedComment } from '../parser'

export type ParseRequestMessage = {
  type: 'parse'
  taskId: number
  comments: CommentEntity[]
  chunkSize: number
  /**
   * Optional starting index to prioritize parsing comments near the current
   * playback cursor. The worker will parse `[startIndex..end)` first and then
   * wrap around to `[0..startIndex)`.
   */
  startIndex?: number
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

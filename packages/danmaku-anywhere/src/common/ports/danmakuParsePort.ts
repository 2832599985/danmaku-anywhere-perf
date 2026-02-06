import type { CommentEntity } from '@danmaku-anywhere/danmaku-converter'
import type { ParsedComment } from '@danmaku-anywhere/danmaku-engine'

export type DanmakuParseClientToBgMessage =
  | {
      type: 'begin'
      taskId: number
      chunkSize: number
      total: number
    }
  | {
      type: 'comments'
      taskId: number
      startIndex: number
      comments: CommentEntity[]
    }
  | {
      type: 'end'
      taskId: number
    }
  | {
      type: 'cancel'
      taskId: number
    }

export type DanmakuParseBgToClientMessage =
  | {
      type: 'chunk'
      taskId: number
      startIndex: number
      parsed: Array<ParsedComment | undefined>
    }
  | {
      type: 'done'
      taskId: number
      totalMs: number
    }
  | {
      type: 'error'
      taskId: number
      message: string
    }

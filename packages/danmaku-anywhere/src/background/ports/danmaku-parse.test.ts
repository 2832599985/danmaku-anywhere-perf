import type { CommentEntity } from '@danmaku-anywhere/danmaku-converter'
import type { ParsedComment } from '@danmaku-anywhere/danmaku-engine'
import { describe, expect, it } from 'vitest'
import type {
  DanmakuParseBgToClientMessage,
  DanmakuParseClientToBgMessage,
} from '@/common/ports/danmakuParsePort'
import { createDanmakuParsePortHandler } from './danmaku-parse'

class FakeEvent<TArgs extends any[]> {
  private listeners: Array<(...args: TArgs) => void> = []

  addListener = (cb: (...args: TArgs) => void) => {
    this.listeners.push(cb)
  }

  removeListener = (cb: (...args: TArgs) => void) => {
    this.listeners = this.listeners.filter((x) => x !== cb)
  }

  emit = (...args: TArgs) => {
    for (const cb of this.listeners) cb(...args)
  }
}

class FakePort {
  name = 'danmaku-parse'
  onMessage = new FakeEvent<[DanmakuParseClientToBgMessage]>()
  onDisconnect = new FakeEvent<[chrome.runtime.Port]>()

  sent: DanmakuParseBgToClientMessage[] = []

  postMessage = (msg: DanmakuParseBgToClientMessage) => {
    this.sent.push(msg)
  }

  disconnect = () => {
    this.onDisconnect.emit(this as unknown as chrome.runtime.Port)
  }
}

const makeComment = (i: number, m = 'hi'): CommentEntity => ({
  p: `${i},1,16777215,uid`,
  m,
})

describe('danmaku-parse port', () => {
  it('streams chunks and completes', async () => {
    const port = new FakePort()

    const handler = createDanmakuParsePortHandler({
      transform: (c) =>
        ({
          text: c.m,
          mode: 'rtl',
          time: 0,
          style: {},
          color: '#fff',
        }) satisfies ParsedComment,
      yieldBetweenChunks: async () => {},
    })

    handler(port as unknown as chrome.runtime.Port)

    port.onMessage.emit({ type: 'begin', taskId: 1, chunkSize: 2, total: 3 })
    port.onMessage.emit({
      type: 'comments',
      taskId: 1,
      startIndex: 0,
      comments: [makeComment(0, 'a'), makeComment(1, 'b')],
    })
    port.onMessage.emit({
      type: 'comments',
      taskId: 1,
      startIndex: 2,
      comments: [makeComment(2, 'c')],
    })
    port.onMessage.emit({ type: 'end', taskId: 1 })

    // allow async processing to complete
    await Promise.resolve()
    await Promise.resolve()

    const chunks = port.sent.filter((m) => m.type === 'chunk')
    const done = port.sent.find((m) => m.type === 'done')

    expect(chunks).toHaveLength(2)
    expect(chunks[0].startIndex).toBe(0)
    expect(chunks[1].startIndex).toBe(2)
    expect(done && done.type === 'done' && done.taskId).toBe(1)
  })

  it('returns undefined entries when parsing throws', async () => {
    const port = new FakePort()
    const handler = createDanmakuParsePortHandler({
      transform: (c) => {
        if (c.m === 'bad') throw new Error('boom')
        return {
          text: c.m,
          mode: 'rtl',
          time: 0,
          style: {},
          color: '#fff',
        }
      },
      yieldBetweenChunks: async () => {},
    })

    handler(port as unknown as chrome.runtime.Port)

    port.onMessage.emit({ type: 'begin', taskId: 7, chunkSize: 3, total: 3 })
    port.onMessage.emit({
      type: 'comments',
      taskId: 7,
      startIndex: 0,
      comments: [
        makeComment(0, 'ok'),
        makeComment(1, 'bad'),
        makeComment(2, 'ok2'),
      ],
    })
    port.onMessage.emit({ type: 'end', taskId: 7 })

    await Promise.resolve()
    await Promise.resolve()

    const chunk = port.sent.find((m) => m.type === 'chunk')
    expect(chunk && chunk.type === 'chunk' && chunk.parsed[1]).toBeUndefined()
  })

  it('cancel stops completion', async () => {
    const port = new FakePort()
    const handler = createDanmakuParsePortHandler({
      transform: (c) => ({
        text: c.m,
        mode: 'rtl',
        time: 0,
        style: {},
        color: '#fff',
      }),
      yieldBetweenChunks: async () => {},
    })

    handler(port as unknown as chrome.runtime.Port)

    port.onMessage.emit({ type: 'begin', taskId: 3, chunkSize: 2, total: 2 })
    port.onMessage.emit({
      type: 'comments',
      taskId: 3,
      startIndex: 0,
      comments: [makeComment(0, 'a'), makeComment(1, 'b')],
    })
    port.onMessage.emit({ type: 'cancel', taskId: 3 })
    port.onMessage.emit({ type: 'end', taskId: 3 })

    await Promise.resolve()
    await Promise.resolve()

    expect(port.sent.some((m) => m.type === 'done')).toBe(false)
  })
})

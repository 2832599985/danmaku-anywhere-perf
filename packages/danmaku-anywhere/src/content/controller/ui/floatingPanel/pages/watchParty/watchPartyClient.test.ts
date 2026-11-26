import { describe, expect, it } from 'vitest'
import { buildWatchRoomWsUrl, parseRoomCode } from './watchPartyClient'

describe('watchPartyClient helpers', () => {
  it('extracts clean room IDs from raw codes, watchparty: URIs, and share URLs', () => {
    expect(parseRoomCode('  9f3a12bc  ')).toBe('9f3a12bc')
    expect(parseRoomCode('watchparty:room-uuid-42')).toBe('room-uuid-42')
    expect(
      parseRoomCode('https://api.danmaku.weeblify.app/rooms/room-99?foo=1')
    ).toBe('room-99')
    expect(
      parseRoomCode('https://danmaku.weeblify.app/watch?room=abc-def')
    ).toBe('abc-def')
    expect(parseRoomCode('   ')).toBe('')
  })

  it('builds wss:// and ws:// upgrade URLs with query token authentication', () => {
    expect(
      buildWatchRoomWsUrl(
        'https://api.danmaku.weeblify.app/',
        'room-1',
        'jwt.tok'
      )
    ).toBe('wss://api.danmaku.weeblify.app/rooms/room-1/ws?token=jwt.tok')

    expect(buildWatchRoomWsUrl('http://localhost:8787', 'r2', '')).toBe(
      'ws://localhost:8787/rooms/r2/ws'
    )
  })
})

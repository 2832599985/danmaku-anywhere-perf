import { DurableObject } from 'cloudflare:workers'

interface RoomState {
  hostId: string
  animeTitle: string
  episode: string
}

interface UserAttachment {
  userId: string
  userName: string
}

interface WsMessage {
  type: 'danmaku' | 'sync' | 'join' | 'leave' | 'pause' | 'play' | 'seek'
  data?: unknown
  userId?: string
  userName?: string
}

const ROOM_STATE_KEY = 'room_state'

export class WatchRoom extends DurableObject {
  private state: RoomState | null = null

  private async getRoomState(): Promise<RoomState | null> {
    if (this.state !== null) return this.state
    const stored = await this.ctx.storage.get<RoomState>(ROOM_STATE_KEY)
    this.state = stored ?? null
    return this.state
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)

    if (url.pathname === '/ws') {
      const pair = new WebSocketPair()
      const [client, server] = Object.values(pair)

      const userId = url.searchParams.get('userId') ?? 'anonymous'
      const userName = url.searchParams.get('userName') ?? 'Anonymous'

      this.ctx.acceptWebSocket(server)
      server.serializeAttachment({ userId, userName } satisfies UserAttachment)

      this.broadcast({ type: 'join', userId, userName }, server)

      return new Response(null, { status: 101, webSocket: client })
    }

    if (url.pathname === '/info') {
      const state = await this.getRoomState()
      return Response.json({
        memberCount: this.ctx.getWebSockets().length,
        state,
      })
    }

    if (url.pathname === '/init' && request.method === 'POST') {
      try {
        const nextState = (await request.json()) as RoomState
        this.state = nextState
        await this.ctx.storage.put(ROOM_STATE_KEY, nextState)
        return Response.json({ success: true })
      } catch {
        return Response.json(
          { success: false, message: 'Invalid JSON body' },
          { status: 400 }
        )
      }
    }

    return new Response('Not found', { status: 404 })
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    if (typeof message !== 'string') return
    try {
      const msg: WsMessage = JSON.parse(message)
      this.broadcast(msg, ws)
    } catch {
      // Ignore malformed messages
    }
  }

  async webSocketClose(ws: WebSocket) {
    const attachment = ws.deserializeAttachment() as UserAttachment | null
    this.broadcast(
      {
        type: 'leave',
        userId: attachment?.userId,
        userName: attachment?.userName,
      },
      ws
    )
  }

  async webSocketError(ws: WebSocket) {
    await this.webSocketClose(ws)
  }

  private broadcast(msg: WsMessage, exclude?: WebSocket) {
    const sockets = this.ctx.getWebSockets()
    const payload = JSON.stringify(msg)
    for (const socket of sockets) {
      if (socket !== exclude && socket.readyState === WebSocket.OPEN) {
        socket.send(payload)
      }
    }
  }
}

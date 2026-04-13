import { DurableObject } from 'cloudflare:workers'

interface RoomState {
  hostId: string
  animeTitle: string
  episode: string
}

interface WsMessage {
  type: 'danmaku' | 'sync' | 'join' | 'leave' | 'pause' | 'play' | 'seek'
  data?: unknown
  userId?: string
  userName?: string
}

export class WatchRoom extends DurableObject {
  private state: RoomState | null = null

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)

    if (url.pathname === '/ws') {
      const pair = new WebSocketPair()
      const [client, server] = Object.values(pair)

      this.ctx.acceptWebSocket(server)

      const userId = url.searchParams.get('userId') ?? 'anonymous'
      const userName = url.searchParams.get('userName') ?? 'Anonymous'
      this.broadcast({ type: 'join', userId, userName }, server)

      return new Response(null, { status: 101, webSocket: client })
    }

    if (url.pathname === '/info') {
      return Response.json({
        memberCount: this.ctx.getWebSockets().length,
        state: this.state,
      })
    }

    if (url.pathname === '/init' && request.method === 'POST') {
      this.state = (await request.json()) as RoomState
      return Response.json({ success: true })
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
    this.broadcast({ type: 'leave' }, ws)
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

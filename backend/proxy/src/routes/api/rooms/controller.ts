import { HTTPException } from 'hono/http-exception'
import { validator } from 'hono-openapi'
import z from 'zod'
import { factory } from '@/factory'
import { requireAuth } from '@/middleware/requireAuth'

const createRoomBodySchema = z.object({
  animeTitle: z.string(),
  episode: z.string(),
})

const roomIdParamSchema = z.object({
  id: z.string().min(1),
})

export const roomsController = factory.createApp()

// POST /api/rooms/create - Auth required. Creates a room, returns roomId
roomsController.post(
  '/create',
  requireAuth(),
  validator('json', createRoomBodySchema),
  async (c) => {
    const user = c.get('authUser')
    if (!user) {
      return c.json({ message: 'Unauthorized', success: false }, 401)
    }

    const { animeTitle, episode } = c.req.valid('json')
    const roomId = crypto.randomUUID()

    const durableId = c.env.WATCH_ROOM.idFromName(roomId)
    const stub = c.env.WATCH_ROOM.get(durableId)

    const initRes = await stub.fetch(
      new Request('http://internal/init', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          hostId: user.id,
          animeTitle,
          episode,
        }),
      })
    )

    if (!initRes.ok) {
      throw new HTTPException(500, { message: 'Failed to initialize room' })
    }

    return c.json({ success: true, roomId }, 201)
  }
)

// GET /api/rooms/:id/info - Public. Returns room info
roomsController.get(
  '/:id/info',
  validator('param', roomIdParamSchema),
  async (c) => {
    const { id } = c.req.valid('param')

    const durableId = c.env.WATCH_ROOM.idFromName(id)
    const stub = c.env.WATCH_ROOM.get(durableId)

    const res = await stub.fetch(new Request('http://internal/info'))

    if (!res.ok) {
      throw new HTTPException(500, { message: 'Failed to get room info' })
    }

    const data = await res.json()
    return c.json({ success: true, data })
  }
)

// GET /api/rooms/:id/ws - Auth required. WebSocket upgrade (proxy to DO)
roomsController.get(
  '/:id/ws',
  requireAuth(),
  validator('param', roomIdParamSchema),
  async (c) => {
    const user = c.get('authUser')
    if (!user) {
      return c.json({ message: 'Unauthorized', success: false }, 401)
    }

    const upgradeHeader = c.req.header('Upgrade')
    if (upgradeHeader !== 'websocket') {
      return c.json(
        { message: 'Expected WebSocket upgrade', success: false },
        426
      )
    }

    const { id } = c.req.valid('param')
    const userId = encodeURIComponent(user.id)
    const userName = encodeURIComponent(user.name ?? 'Anonymous')

    const durableId = c.env.WATCH_ROOM.idFromName(id)
    const stub = c.env.WATCH_ROOM.get(durableId)

    return stub.fetch(
      new Request(`http://internal/ws?userId=${userId}&userName=${userName}`, {
        headers: c.req.raw.headers,
      })
    )
  }
)

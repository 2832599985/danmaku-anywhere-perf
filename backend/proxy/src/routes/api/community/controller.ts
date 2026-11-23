import { HTTPException } from 'hono/http-exception'
import { describeRoute, resolver, validator } from 'hono-openapi'
import z from 'zod'
import { factory } from '@/factory'
import { useCache } from '@/middleware/cache'
import { requireAuth } from '@/middleware/requireAuth'
import * as schemas from './schemas'
import * as service from './service'

export const communityRouter = factory.createApp()

communityRouter.get(
  '/comments',
  describeRoute({
    description: 'Fetch community comments for an episode',
    responses: {
      200: {
        description: 'Successful response',
        content: {
          'application/json': {
            schema: resolver(schemas.getCommentsResponseSchema),
          },
        },
      },
    },
  }),
  validator('query', schemas.getCommentsQuerySchema),
  useCache({ maxAge: 30 }),
  async (c) => {
    const { title, episode } = c.req.valid('query')
    const db = c.get('createDb')()

    try {
      const comments = await service.getComments(db, title, episode)
      return c.json({ success: true, data: comments })
    } catch (e) {
      throw new HTTPException(500, {
        cause: e,
        message: 'Failed to fetch comments',
      })
    }
  }
)

communityRouter.post(
  '/comment',
  describeRoute({
    description: 'Send a community comment',
    responses: {
      201: {
        description: 'Comment created',
        content: {
          'application/json': {
            schema: resolver(schemas.addCommentResponseSchema),
          },
        },
      },
      401: { description: 'Unauthorized' },
      429: { description: 'Rate limit exceeded' },
    },
  }),
  requireAuth(),
  validator('json', schemas.addCommentBodySchema),
  async (c) => {
    const user = c.get('authUser')
    if (!user) {
      return c.json({ message: 'Unauthorized', success: false }, 401)
    }

    const data = c.req.valid('json')
    const db = c.get('createDb')()

    try {
      const { id } = await service.addComment(db, {
        userId: user.id,
        ...data,
      })
      return c.json({ success: true, id }, 201)
    } catch (e) {
      throw new HTTPException(500, {
        cause: e,
        message: 'Failed to add comment',
      })
    }
  }
)

communityRouter.delete(
  '/comment/:id',
  describeRoute({
    description: 'Delete own community comment',
    responses: {
      200: {
        description: 'Comment deleted',
        content: {
          'application/json': {
            schema: resolver(schemas.deleteCommentResponseSchema),
          },
        },
      },
      401: { description: 'Unauthorized' },
      403: { description: 'Forbidden' },
      404: { description: 'Not found' },
    },
  }),
  requireAuth(),
  validator('param', z.object({ id: z.string() })),
  async (c) => {
    const user = c.get('authUser')
    if (!user) {
      return c.json({ message: 'Unauthorized', success: false }, 401)
    }

    const { id } = c.req.valid('param')
    const db = c.get('createDb')()

    try {
      const result = await service.deleteComment(db, id, user.id)

      if (!result.found) {
        return c.json({ message: 'Comment not found', success: false }, 404)
      }
      if (!result.deleted) {
        return c.json(
          { message: "Cannot delete another user's comment", success: false },
          403
        )
      }

      return c.json({ success: true })
    } catch (e) {
      throw new HTTPException(500, {
        cause: e,
        message: 'Failed to delete comment',
      })
    }
  }
)

import { describeRoute, resolver, validator } from 'hono-openapi'
import { z } from 'zod'
import { factory } from '@/factory'
import { useGeminiErrorHandler } from '@/routes/api/llm/middleware/geminiErrorHandler'
import { translateBatchSchema } from './schemas'
import { translateWithGemini } from './service'

export const translate = factory.createApp()

translate.use('*', useGeminiErrorHandler())

translate.post(
  '/batch',
  describeRoute({
    description: 'Translate a batch of danmaku comments',
    responses: {
      200: {
        description: 'Successful translation',
        content: {
          'application/json': {
            schema: resolver(
              z.object({
                success: z.boolean(),
                translations: z.array(z.string()),
              })
            ),
          },
        },
      },
      429: {
        description: 'Rate limit exceeded',
      },
    },
  }),
  validator('json', translateBatchSchema),
  async (c) => {
    const { texts, targetLang } = c.req.valid('json' as never) as z.infer<
      typeof translateBatchSchema
    >

    const translations = await translateWithGemini({
      env: c.env,
      texts,
      targetLang,
    })

    return c.json({ success: true, translations }, 200)
  }
)

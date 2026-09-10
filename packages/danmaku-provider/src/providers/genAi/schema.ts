import { z } from 'zod'

const zGeminiSuccessResponse = z.object({
  success: z.literal(true),
})

const zGeminiErrorResponse = z.object({
  success: z.literal(false),
  message: z.string(),
})

export const zExtractTitleSuccessResponse = zGeminiSuccessResponse.extend({
  success: z.literal(true),
  result: z.object({
    isShow: z.boolean(),
    title: z.string(),
    episode: z.number(),
    episodeTitle: z.string(),
    /**
     * Other titles the model found for the same show (romaji, English,
     * Chinese…). Optional: the v1 prompt/endpoint does not return it, and the
     * legacy proxy response omits the field entirely.
     */
    altTitles: z.array(z.string()).optional(),
  }),
})

export const zExtractTitleResponse = z.discriminatedUnion('success', [
  zExtractTitleSuccessResponse,
  zGeminiErrorResponse,
])

export type ExtractTitleResponse = z.infer<typeof zExtractTitleSuccessResponse>

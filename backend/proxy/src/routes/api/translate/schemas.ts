import { z } from 'zod'

export const translateBatchSchema = z.object({
  texts: z
    .array(z.string().max(500, 'Individual text too long'))
    .min(1, 'At least one text is required')
    .max(100, 'Too many texts in a single batch'),
  targetLang: z.enum(['en', 'ja', 'zh', 'ko']),
})

export type TranslateBatchInput = z.infer<typeof translateBatchSchema>

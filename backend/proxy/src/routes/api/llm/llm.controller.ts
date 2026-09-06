import type { GenerationConfig } from '@google/generative-ai'
import type { Context } from 'hono'
import { validator } from 'hono-openapi'
import { z } from 'zod'
import { extractTitleWithGemini, translateLinesWithGemini } from './llm.service'

const extractTitleSchema = z.object({
  input: z
    .string()
    .min(10, 'input is too short')
    .max(4096, 'input is too long'),
})

export const validateTitleInputOpenApi = validator('json', extractTitleSchema)

type ExtractTitleValidated = z.infer<typeof extractTitleSchema>

export function handleExtractTitle(prompt: string, config: GenerationConfig) {
  return async (c: Context<{ Bindings: Env }>) => {
    const { input } = c.req.valid('json' as never) as ExtractTitleValidated
    const result = await extractTitleWithGemini({
      env: c.env,
      input,
      systemInstruction: prompt,
      generationConfig: config,
    })
    return c.json({ result, success: true }, 200)
  }
}

export function handleExtractTitleLegacy(
  prompt: string,
  config: GenerationConfig
) {
  return async (c: Context<{ Bindings: Env }>) => {
    const { input } = await c.req.json<{ input: string }>()
    const result = await extractTitleWithGemini({
      env: c.env,
      input,
      systemInstruction: prompt,
      generationConfig: config,
    })
    return c.json({ result, success: true }, 200)
  }
}

const translateSchema = z.object({
  lines: z
    .array(z.string().min(1, 'line is empty').max(1000, 'line is too long'))
    .min(1, 'lines is empty')
    .max(40, 'too many lines per batch'),
})

export const validateTranslateInputOpenApi = validator('json', translateSchema)

type TranslateValidated = z.infer<typeof translateSchema>

export function handleTranslate(prompt: string, config: GenerationConfig) {
  return async (c: Context<{ Bindings: Env }>) => {
    const { lines } = c.req.valid('json' as never) as TranslateValidated
    // Numbered input keeps the model honest about line alignment; the
    // response schema already forces an array, but the count check is what
    // catches dropped/merged lines.
    const input = lines.map((line, index) => `${index + 1}. ${line}`).join('\n')
    const result = await translateLinesWithGemini({
      env: c.env,
      input,
      systemInstruction: prompt,
      generationConfig: config,
    })
    const translated: unknown = result?.lines
    if (
      !Array.isArray(translated) ||
      translated.length !== lines.length ||
      translated.some((line) => typeof line !== 'string')
    ) {
      return c.json(
        { success: false, message: 'Translation line count mismatch' },
        502
      )
    }
    return c.json({ result: { lines: translated }, success: true }, 200)
  }
}

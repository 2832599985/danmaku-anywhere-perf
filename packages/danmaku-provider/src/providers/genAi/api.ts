import { err, ok, type Result } from '@danmaku-anywhere/result'
import type { DanmakuProviderError } from '../../exceptions/BaseError.js'
import { getApiStore } from '../../shared/store.js'
import { fetchData } from '../utils/fetchData.js'
import type { ExtractTitleResponse, TranslateResponse } from './schema.js'
import { zExtractTitleResponse, zTranslateResponse } from './schema.js'

export const extractTitle = async (
  input: string
): Promise<Result<ExtractTitleResponse['result'], DanmakuProviderError>> => {
  const result = await fetchData({
    url: `${getApiStore().baseUrl}/llm/v1/extractTitle`,
    body: {
      input,
    },
    headers: {
      'Content-Type': 'application/json',
    },
    responseSchema: zExtractTitleResponse,
    method: 'POST',
    isDaRequest: true,
  })

  if (!result.success) {
    return result
  }

  const res = result.data

  if (!res.success) {
    return err(new Error(res.message))
  }

  if (res.result.title.trim().length === 0) {
    return err(new Error('No title found'))
  }

  return ok(res.result)
}

const TRANSLATE_MAX_LINES = 40

/**
 * Translate subtitle lines into Simplified Chinese through the proxy's
 * /llm/v1/translate endpoint (a Gemini-backed batch translator). The batch is
 * sent with line numbers and the server enforces a 1:1 line mapping, so
 * dropped/merged lines surface as an error instead of silent misalignment.
 *
 * Batches larger than TRANSLATE_MAX_LINES are rejected client-side — split
 * them before calling.
 */
export const translateLines = async (
  lines: string[]
): Promise<Result<TranslateResponse['result'], DanmakuProviderError>> => {
  if (lines.length > TRANSLATE_MAX_LINES) {
    return err(new Error(`Batch too large: ${lines.length} lines`))
  }
  const result = await fetchData({
    url: `${getApiStore().baseUrl}/llm/v1/translate`,
    body: {
      lines,
    },
    headers: {
      'Content-Type': 'application/json',
    },
    responseSchema: zTranslateResponse,
    method: 'POST',
    isDaRequest: true,
  })

  if (!result.success) {
    return result
  }

  const res = result.data

  if (!res.success) {
    return err(new Error(res.message))
  }

  return ok(res.result)
}

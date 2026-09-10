import { err, ok, type Result } from '@danmaku-anywhere/result'
import type { DanmakuProviderError } from '../../exceptions/BaseError.js'
import { getApiStore } from '../../shared/store.js'
import { fetchData } from '../utils/fetchData.js'
import type { ExtractTitleResponse } from './schema.js'
import { zExtractTitleResponse } from './schema.js'

/**
 * Which kind of input is being sent. `page` (default) is the extension's case:
 * the text is page metadata/HTML, and the proxy prompt is written for it.
 * `filename` is the desktop player's case: the input is a video file name, and
 * the proxy selects a filename-oriented prompt. Older proxies ignore the field.
 */
export type ExtractTitleInputType = 'page' | 'filename'

export const extractTitle = async (
  input: string,
  inputType: ExtractTitleInputType = 'page'
): Promise<Result<ExtractTitleResponse['result'], DanmakuProviderError>> => {
  const result = await fetchData({
    url: `${getApiStore().baseUrl}/llm/v1/extractTitle`,
    body: {
      input,
      inputType,
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

import {
  type CommentEntity,
  zGenericXml,
} from '@danmaku-anywhere/danmaku-converter'
import { err, ok, type Result } from '@danmaku-anywhere/result'
import type { DanmakuProviderError } from '../../exceptions/BaseError.js'
import { HttpException } from '../../exceptions/HttpException.js'
import { InputError } from '../../exceptions/InputError.js'
import { ResponseParseException } from '../../exceptions/ResponseParseException.js'
import { bilibili as bilibiliProto } from '../../protobuf/protobuf.js'
import { createThrottle } from '../utils/createThrottle.js'
import { fetchData } from '../utils/fetchData.js'
import type {
  BiliBiliSearchParams,
  BiliBiliSearchType,
  BilibiliBangumiInfo,
  BilibiliMedia,
  BilibiliUserInfo,
} from './schema.js'
import {
  zBilibiliBangumiInfoResponse,
  zBilibiliCommentProto,
  zBilibiliSearchResponse,
  zBilibiliUserInfo,
} from './schema.js'
import { ensureSelectData } from './utils.js'

const BILIBILI_API_URL_ROOT = 'https://api.bilibili.com'
const BILIBILI_FETCH_OPTIONS = {
  credentials: 'include' as const,
}

const throttle = createThrottle(200)

// Visit bilibili.com to set cookies
export const setCookies = async () => {
  await fetch('https://www.bilibili.com', BILIBILI_FETCH_OPTIONS)
}

export const getCurrentUser = async (): Promise<
  Result<BilibiliUserInfo, DanmakuProviderError>
> => {
  await throttle()

  const result = await fetchData({
    url: `${BILIBILI_API_URL_ROOT}/x/web-interface/nav`,
    responseSchema: zBilibiliUserInfo,
    ...BILIBILI_FETCH_OPTIONS,
  })

  if (!result.success) return result

  return ok(result.data.data)
}

const search = async (
  params: BiliBiliSearchParams,
  type: BiliBiliSearchType
): Promise<Result<BilibiliMedia[], DanmakuProviderError>> => {
  await throttle()

  const url = `${BILIBILI_API_URL_ROOT}/x/web-interface/search/type`

  const result = await fetchData({
    url,
    query: {
      keyword: params.keyword,
      search_type: type,
    },
    responseSchema: zBilibiliSearchResponse,
    ...BILIBILI_FETCH_OPTIONS,
  })

  if (!result.success) return result

  return ensureSelectData(result.data, 'data', (data) => data.result)
}

// search for media by keyword
export const searchMedia = async (
  params: BiliBiliSearchParams
): Promise<Result<BilibiliMedia[], DanmakuProviderError>> => {
  const results: BilibiliMedia[] = []
  const errors: DanmakuProviderError[] = []

  for (const type of [
    'media_bangumi',
    'media_ft',
  ] satisfies BiliBiliSearchType[]) {
    const result = await search(params, type)

    if (result.success) {
      results.push(...result.data)
    } else {
      errors.push(result.error)
    }
  }

  if (errors.length === 2) {
    return err(errors[0])
  }

  return ok(results)
}

// using season id, get a list of episodes
export const getBangumiInfo = async ({
  seasonId,
  episodeId,
}: {
  seasonId?: number
  episodeId?: number
}): Promise<Result<BilibiliBangumiInfo, DanmakuProviderError>> => {
  await throttle()

  if (!seasonId && !episodeId) {
    return err(new InputError('Either seasonId or episodeId must be provided'))
  }

  const url = `${BILIBILI_API_URL_ROOT}/pgc/view/web/season`
  const query = seasonId ? { season_id: seasonId } : { ep_id: episodeId }

  const result = await fetchData({
    url,
    query,
    responseSchema: zBilibiliBangumiInfoResponse,
    ...BILIBILI_FETCH_OPTIONS,
  })

  if (!result.success) return result

  return ensureSelectData(result.data, 'result', (data) => data)
}

export const getDanmakuXml = async (
  cid: number
): Promise<Result<CommentEntity[], DanmakuProviderError>> => {
  await throttle()

  const url = `${BILIBILI_API_URL_ROOT}/x/v1/dm/list.so?oid=${cid}`

  const response = await fetchData({
    url,
    responseType: 'text',
    responseSchema: zGenericXml,
    ...BILIBILI_FETCH_OPTIONS,
  })

  if (!response.success) return response

  return response
}

export async function* getDanmakuProtoSegment(
  oid: number,
  pid?: number
): AsyncGenerator<Result<CommentEntity[], DanmakuProviderError>> {
  const MAX_SEGMENT = 100 // arbitrary number

  let segmentIndex = 1

  const params = new URLSearchParams({
    type: '1', // 1 for video, 2 for comics
    oid: oid.toString(),
    segment_index: segmentIndex.toString(),
  })

  if (pid) {
    params.set('pid', pid.toString())
  }

  while (true) {
    await throttle()

    params.set('segment_index', segmentIndex.toString())

    const url = `${BILIBILI_API_URL_ROOT}/x/v2/dm/web/seg.so?${params}`

    try {
      const response = await fetch(url)

      if (response.status === 304) {
        return null
      }

      if (response.status >= 400) {
        yield err(
          new HttpException(
            'Bilibili API Error',
            response.status,
            response.statusText,
            url,
            await response.text()
          )
        )
        return
      }

      const buffer = await response.arrayBuffer()

      let parsed: bilibiliProto.community.service.dm.v1.IDmSegMobileReply

      try {
        parsed = bilibiliProto.community.service.dm.v1.DmSegMobileReply.decode(
          new Uint8Array(buffer)
        )
      } catch (e) {
        yield err(
          new ResponseParseException({
            message: 'Failed to decode protobuf',
            cause: e,
            url,
            responseBody: 'protobuf',
          })
        )
        return
      }

      try {
        const comments = await zBilibiliCommentProto.parseAsync(parsed)
        yield ok(comments.elems)
      } catch (e) {
        yield err(
          new ResponseParseException({
            cause: e,
            url,
            responseBody: 'protobuf',
          })
        )
        return
      }
    } catch (e) {
      yield err(
        new HttpException(
          e instanceof Error ? e.message : String(e),
          0,
          'Network Error',
          url
        )
      )
      return
    }

    segmentIndex++

    if (segmentIndex > MAX_SEGMENT) {
      return null
    }
  }
}

// Evenly pick a sample from an array up to a limit
const sample = <T>(arr: T[], limit: number): T[] => {
  if (arr.length <= limit) return arr

  const sample: T[] = []
  const step = Math.ceil(arr.length / limit)

  for (let i = 0; i < arr.length; i += step) {
    sample.push(arr[i])
  }

  return sample
}

// oid = cid, pid = avids
export const getDanmakuProto = async (
  oid: number,
  pid?: number,
  { limitPerMinute = 1000 }: { limitPerMinute?: number } = {}
): Promise<Result<CommentEntity[], DanmakuProviderError>> => {
  const segments = getDanmakuProtoSegment(oid, pid)
  const comments: CommentEntity[][] = []

  for await (const result of segments) {
    if (!result.success) {
      return result
    }
    comments.push(sample(result.data, limitPerMinute * 6)) // each segment is 6 minutes
  }

  return ok(comments.flat())
}

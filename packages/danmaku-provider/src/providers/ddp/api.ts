import {
  commentOptionsToString,
  parseCommentEntityP,
} from '@danmaku-anywhere/danmaku-converter'
import { err, ok, type Result } from '@danmaku-anywhere/result'
import type { output, ZodType } from 'zod'
import type { DanmakuProviderError } from '../../exceptions/BaseError.js'
import { InputError } from '../../exceptions/InputError.js'
import { getApiStore } from '../../shared/store.js'
import type { FetchOptions } from '../utils/fetchData.js'
import { fetchData } from '../utils/fetchData.js'
import { DanDanPlayApiException } from './exceptions.js'
import type {
  BangumiDetails,
  CommentData,
  FindMyIdRequestV2,
  GetCommentQuery,
  GetExtCommentQuery,
  LoginRequest,
  LoginResponse,
  RegisterRequestV2,
  RelatedItemV2,
  ResetPasswordRequestV2,
  SearchAnimeDetails,
  SearchEpisodesAnime,
  SearchEpisodesQuery,
  SendCommentRequest,
} from './schema.js'
import {
  zBangumiDetailsResponse,
  zCommentResponseV2,
  zFindMyIdRequestV2,
  zGetCommentQuery,
  zLoginRequest,
  zLoginResponse,
  zRegisterRequestV2,
  zRelatedResponseV2,
  zResetPasswordRequestV2,
  zResponseBase,
  zSearchAnimeResponse,
  zSearchEpisodeQuery,
  zSearchEpisodesResponse,
  zSendCommentRequest,
  zSendCommentResponseV2,
} from './schema.js'

export interface DanDanPlayQueryContext {
  // fallback to default if not provided
  baseUrl?: string
  isCustom?: boolean
  auth?: {
    token?: string
    headers?: Array<{
      key: string
      value: string
    }>
  }
}

const fetchDanDanPlay = async <T extends ZodType>(
  options: Omit<FetchOptions<T>, 'url' | 'headers' | 'isDaRequest'> & {
    path: string
  },
  context?: DanDanPlayQueryContext
): Promise<Result<output<T>, DanmakuProviderError>> => {
  const headers: Record<string, string> = {}

  const store = getApiStore()

  if (options.body) {
    headers['Content-Type'] = 'application/json'
  }

  // add custom headers from context
  if (context?.auth?.headers) {
    for (const header of context.auth.headers) {
      headers[header.key] = header.value
    }
  }

  // parse query early
  if (options.requestSchema?.query) {
    try {
      options.query = options.requestSchema.query.parse(options.query)
    } catch (e) {
      // schema validation throws, it must not escape the Result boundary
      return err(
        new InputError(
          `Invalid request for ${options.path}: ${
            e instanceof Error ? e.message : String(e)
          }`
        )
      )
    }
  }
  // append query to path
  let path = options.path
  if (options.query) {
    path += `?${new URLSearchParams(options.query as Record<string, string>).toString()}`
  }

  // use the custom baseUrl if isCustom is true
  if (context?.isCustom) {
    if (!context.baseUrl) {
      return err(
        new InputError('Custom baseUrl is required when isCustom is true')
      )
    }
    return fetchData<T>({
      url: `${context.baseUrl}${path}`,
      ...options,
      // query was already parsed and baked into `path`, clear to prevent
      // fetchData from double-appending query params or re-parsing
      query: undefined,
      requestSchema: undefined,
      headers,
    })
  }

  // otherwise use the default proxy
  return fetchData<T>({
    url: `${store.baseUrl}/ddp/v1`,
    ...options,
    query: {
      path,
    },
    // requestSchema.query was already applied above; clear it so fetchData's
    // validateRequest doesn't re-parse the proxy query and strip the `path` key
    requestSchema: undefined,
    headers,
    isDaRequest: true,
  })
}

export const searchSearchAnime = async (
  keyword: string,
  context?: DanDanPlayQueryContext
): Promise<Result<SearchAnimeDetails[], DanmakuProviderError>> => {
  const result = await fetchDanDanPlay(
    {
      path: '/v2/search/anime',
      query: {
        keyword,
      },
      responseSchema: zSearchAnimeResponse,
    },
    context
  )

  if (!result.success) return result

  const data = result.data
  if (!data.success) {
    return err(new DanDanPlayApiException(data.errorMessage, data.errorCode))
  }

  return ok(data.animes)
}

export const searchSearchEpisodes = async (
  query: SearchEpisodesQuery,
  context?: DanDanPlayQueryContext
): Promise<Result<SearchEpisodesAnime[], DanmakuProviderError>> => {
  const result = await fetchDanDanPlay(
    {
      path: '/v2/search/episodes',
      query,
      responseSchema: zSearchEpisodesResponse,
      requestSchema: {
        query: zSearchEpisodeQuery,
      },
    },
    context
  )

  if (!result.success) return result
  const data = result.data

  if (!data.success) {
    return err(new DanDanPlayApiException(data.errorMessage, data.errorCode))
  }

  return ok(data.animes)
}

export const commentGetComment = async (
  episodeId: number,
  query: GetCommentQuery = {},
  context?: DanDanPlayQueryContext
): Promise<Result<CommentData[], DanmakuProviderError>> => {
  const result = await fetchDanDanPlay(
    {
      path: `/v2/comment/${episodeId.toString()}`,
      query,
      responseSchema: zCommentResponseV2,
      requestSchema: { query: zGetCommentQuery },
    },
    context
  )

  if (!result.success) return result
  const data = result.data

  return ok(data.comments)
}

export const commentSendComment = async (
  episodeId: number,
  request: SendCommentRequest,
  context?: DanDanPlayQueryContext
): Promise<
  Result<output<typeof zSendCommentResponseV2>, DanmakuProviderError>
> => {
  const result = await fetchDanDanPlay(
    {
      path: `/v2/comment/${episodeId.toString()}`,
      body: request,
      responseSchema: zSendCommentResponseV2,
      requestSchema: {
        body: zSendCommentRequest,
      },
      method: 'POST',
    },
    context
  )

  if (!result.success) return result

  const data = result.data

  if (!data.success) {
    return err(new DanDanPlayApiException(data.errorMessage, data.errorCode))
  }

  return ok(data)
}

export const commentGetExtComment = async (
  query: GetExtCommentQuery,
  context?: DanDanPlayQueryContext
): Promise<Result<CommentData[], DanmakuProviderError>> => {
  const result = await fetchDanDanPlay(
    {
      path: '/v2/extcomment',
      query,
      responseSchema: zCommentResponseV2,
    },
    context
  )

  if (!result.success) return result
  return ok(result.data.comments)
}

export const commentGetCommentManualWithRelated = async (
  episodeId: number,
  params: GetCommentQuery = {},
  context?: DanDanPlayQueryContext
): Promise<Result<CommentData[], DanmakuProviderError>> => {
  const commentsResult = await commentGetComment(
    episodeId,
    {
      ...params,
      withRelated: false, // disable this flag to fetch related comments manually
    },
    context
  )

  if (!commentsResult.success) return commentsResult

  // De-dupe by a stable key. Some servers may return overlapping comments across
  // base/related sources or duplicated related URLs.
  const keyOf = (comment: CommentData) => {
    // `cid` is optional and may differ across endpoints for the same payload.
    // Using only `p`+`m` yields better de-dupe across base/related sources.
    return `${comment.p}\u0000${comment.m}`
  }

  const seen = new Set<string>()
  const baseComments: CommentData[] = []
  for (const comment of commentsResult.data) {
    const key = keyOf(comment)
    if (seen.has(key)) continue
    seen.add(key)
    baseComments.push(comment)
  }

  const comments = baseComments

  if (params.withRelated) {
    try {
      const relatedResult = await relatedGetRelated(episodeId, context)
      if (relatedResult.success) {
        const relatedData = relatedResult.data

        for (const entry of relatedData) {
          const additionalCommentsResult = await commentGetExtComment(
            {
              url: entry.url,
            },
            context
          )

          if (additionalCommentsResult.success) {
            additionalCommentsResult.data.forEach((comment) => {
              // if the shift is not 0, we need to adjust the time of the comments
              if (entry.shift !== 0) {
                const options = parseCommentEntityP(comment.p)
                options.time = Math.max(0, options.time + entry.shift)
                comment.p = commentOptionsToString(options)
              }

              const key = keyOf(comment)
              if (seen.has(key)) {
                return
              }
              seen.add(key)
              comments.push(comment)
            })
          }
        }
      }
    } catch (e: unknown) {
      console.error(e)
    }
  }

  return ok(comments)
}

export const relatedGetRelated = async (
  episodeId: number,
  context?: DanDanPlayQueryContext
): Promise<Result<RelatedItemV2[], DanmakuProviderError>> => {
  const result = await fetchDanDanPlay(
    {
      path: `/v2/related/${episodeId.toString()}`,
      responseSchema: zRelatedResponseV2,
    },
    context
  )

  if (!result.success) return result
  const data = result.data

  if (!data.success) {
    return err(new DanDanPlayApiException(data.errorMessage, data.errorCode))
  }

  return ok(data.relateds)
}

export const getBangumiAnime = async (
  bangumiId: string,
  context?: DanDanPlayQueryContext
): Promise<Result<BangumiDetails, DanmakuProviderError>> => {
  const result = await fetchDanDanPlay(
    {
      path: `/v2/bangumi/${bangumiId}`,
      responseSchema: zBangumiDetailsResponse,
    },
    context
  )

  if (!result.success) return result
  const data = result.data

  if (!data.success) {
    return err(new DanDanPlayApiException(data.errorMessage, data.errorCode))
  }

  return ok(data.bangumi)
}

export const registerRegisterMainUser = async (
  request: RegisterRequestV2,
  context?: DanDanPlayQueryContext
): Promise<Result<LoginResponse, DanmakuProviderError>> => {
  const result = await fetchDanDanPlay(
    {
      path: '/v2/register',
      responseSchema: zLoginResponse,
      requestSchema: {
        body: zRegisterRequestV2,
      },
      body: request,
      method: 'POST',
    },
    context
  )

  if (!result.success) return result
  const data = result.data

  if (!data.success) {
    return err(new DanDanPlayApiException(data.errorMessage, data.errorCode))
  }

  return ok(data)
}

export const registerResetPassword = async (
  request: ResetPasswordRequestV2,
  context?: DanDanPlayQueryContext
): Promise<Result<null, DanmakuProviderError>> => {
  const result = await fetchDanDanPlay(
    {
      path: '/v2/register/resetpassword',
      responseSchema: zResponseBase,
      requestSchema: {
        body: zResetPasswordRequestV2,
      },
      body: request,
      method: 'POST',
    },
    context
  )

  if (!result.success) return result
  const data = result.data

  if (!data.success) {
    return err(new DanDanPlayApiException(data.errorMessage, data.errorCode))
  }

  return ok(null)
}

export const registerFindMyId = async (
  request: FindMyIdRequestV2,
  context?: DanDanPlayQueryContext
): Promise<Result<null, DanmakuProviderError>> => {
  const result = await fetchDanDanPlay(
    {
      path: '/v2/register/findmyid',
      responseSchema: zResponseBase,
      requestSchema: {
        body: zFindMyIdRequestV2,
      },
      body: request,
      method: 'POST',
    },
    context
  )

  if (!result.success) return result
  const data = result.data

  if (!data.success) {
    return err(new DanDanPlayApiException(data.errorMessage, data.errorCode))
  }

  return ok(null)
}

export const loginLogin = async (
  request: LoginRequest,
  context?: DanDanPlayQueryContext
): Promise<Result<LoginResponse, DanmakuProviderError>> => {
  const result = await fetchDanDanPlay(
    {
      path: '/v2/login',
      responseSchema: zLoginResponse,
      requestSchema: {
        body: zLoginRequest,
      },
      body: request,
      method: 'POST',
    },
    context
  )

  if (!result.success) return result
  const data = result.data

  if (!data.success) {
    return err(new DanDanPlayApiException(data.errorMessage, data.errorCode))
  }

  return ok(data)
}

export const loginRenewToken = async (
  context?: DanDanPlayQueryContext
): Promise<Result<LoginResponse, DanmakuProviderError>> => {
  const result = await fetchDanDanPlay(
    {
      path: '/v2/login',
      responseSchema: zLoginResponse,
      method: 'GET',
    },
    context
  )

  if (!result.success) return result
  const data = result.data

  if (!data.success) {
    return err(new DanDanPlayApiException(data.errorMessage, data.errorCode))
  }

  return ok(data)
}

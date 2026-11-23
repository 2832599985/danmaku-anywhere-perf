import { CommentMode, zRgb888 } from '@danmaku-anywhere/danmaku-converter'
import { z } from 'zod'
import { BiliBiliMediaType } from './enums.js'

const zBilibiliApiResponseBase = z.object({
  code: z.number(),
  message: z.string(),
})

export type BilibiliApiResponseBase = z.infer<typeof zBilibiliApiResponseBase>

export const zBilibiliUserInfo = zBilibiliApiResponseBase.extend({
  data: z.object({
    isLogin: z.boolean(),
  }),
})

export type BilibiliUserInfo = z.infer<typeof zBilibiliUserInfo>['data']

const zBilibiliSearchMedia = z.object({
  type: z.enum(['media_ft', 'media_bangumi']),
  media_id: z.number(), // mdid
  season_id: z.number(), // ssid
  title: z.string(),
  media_type: z.enum(BiliBiliMediaType),
  cover: z.url(),
  season_type_name: z.string(),
  season_type: z.number(),
  ep_size: z.number(),
  desc: z.string(),
  pubtime: z.number(),
})

export type BilibiliMedia = z.infer<typeof zBilibiliSearchMedia>

export const zBilibiliSearchResponse = zBilibiliApiResponseBase.extend({
  data: z
    .object({
      result: z.array(zBilibiliSearchMedia).optional().prefault([]),
    })
    .optional(),
})

export type BiliBiliSearchType = 'media_ft' | 'media_bangumi'

export interface BiliBiliSearchParams {
  keyword: string
  // searchType: 'media_ft' | 'media_bangumi'
  duration?: number
  order?: 'totalrank' | 'click' | 'pubdate' | 'dm' | 'stow' | 'scores'
  page?: number
}

const zBilibiliEpisode = z.object({
  badge: z.string(),
  aid: z.number(),
  bvid: z.string(),
  cid: z.number(),
  // cover image url
  cover: z.url(),
  link: z.url(),
  // epid
  id: z.number(),
  title: z.string(),
  long_title: z.string(),
  show_title: z.string(),
  share_copy: z.string(), // title for sharing
})

export const zBilibiliBangumiInfoResponse = zBilibiliApiResponseBase.extend({
  result: z
    .object({
      episodes: z.array(zBilibiliEpisode).transform((episodes) => {
        return episodes.filter((episode) => {
          // remove trailers
          if (/预告/.test(episode.badge)) return false
          return true
        })
      }),
      title: z.string(),
      type: z.enum(BiliBiliMediaType),
      media_id: z.number(),
      season_id: z.number(),
      cover: z.string(),
    })
    .optional(),
})

export type BilibiliBangumiInfo = NonNullable<
  z.infer<typeof zBilibiliBangumiInfoResponse>['result']
>

interface LongLike {
  low: number
  high: number
  unsigned?: boolean
}

const isLongLike = (value: unknown): value is LongLike => {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Partial<LongLike>
  return typeof candidate.low === 'number' && typeof candidate.high === 'number'
}

// A `Long` stores an int64 as two 32 bit halves, reassemble it exactly.
// Going through `Number` here would be lossy for real dmids.
const longLikeToBigInt = ({ low, high, unsigned }: LongLike) => {
  const highBits = unsigned ? BigInt(high >>> 0) : BigInt(high | 0)
  return (highBits << 32n) | BigInt(low >>> 0)
}

/**
 * `DmSegMobileReply.decode()` returns the int64 `id` as a protobufjs `Long`
 * ({low, high, unsigned}), or as a plain number when the long shim is absent,
 * never as a JS bigint. Normalize every shape it may produce to the exact
 * decimal string. Unrecognized shapes yield undefined instead of failing the
 * whole parse, the id is only used for deduplication.
 */
const normalizeDanmakuId = (value: unknown): string | undefined => {
  if (typeof value === 'bigint') return value.toString()
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) ? value.toString() : undefined
  }
  if (typeof value === 'string') {
    return /^-?\d+$/.test(value) ? value : undefined
  }
  if (isLongLike(value)) return longLikeToBigInt(value).toString()
  return undefined
}

/**
 * `CommentEntity.cid` is a number, so only ids that survive the conversion
 * exactly may be emitted. Real dmids like 1259181282681056512 are orders of
 * magnitude above Number.MAX_SAFE_INTEGER and `Number()` would collapse
 * distinct ids into false duplicates. Omitting `cid` lets downstream dedup
 * fall back to the `p+m` composite key, which is correct.
 * `0` is the protobuf default for an absent field, treat it as no id.
 */
const toSafeCid = (id: string | undefined): number | undefined => {
  if (id === undefined || id === '0') return undefined
  const cid = Number(id)
  return Number.isSafeInteger(cid) ? cid : undefined
}

export const zBilibiliCommentProto = z.object({
  elems: z
    .array(
      z
        .object({
          // 弹幕唯一ID (dmid)
          id: z.unknown().transform(normalizeDanmakuId),
          progress: z.int(), // time in milliseconds
          mode: z.int().transform((mode) => {
            switch (mode) {
              case 1:
              case 2:
              case 3:
                return CommentMode.rtl
              case 4:
                return CommentMode.bottom
              case 5:
                return CommentMode.top
              case 6:
                return CommentMode.ltr
              default:
                return null
            }
          }),
          fontsize: z.int(),
          color: zRgb888,
          content: z.string(),
        })
        .transform((data) => {
          // discard other modes
          if (data.mode === null) return null

          const comment = {
            p: `${data.progress / 1000},${data.mode},${data.color}`,
            m: data.content,
          }

          // 保留弹幕ID用于去重，超出安全整数范围时省略
          const cid = toSafeCid(data.id)
          if (cid === undefined) return comment

          return { ...comment, cid }
        })
    )
    .transform((elems) => elems.filter((elem) => elem !== null)),
})

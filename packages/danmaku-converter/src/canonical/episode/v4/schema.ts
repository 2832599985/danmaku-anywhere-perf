import { z } from 'zod'
import { stripHtml } from '../../../utils/index.js'
import { zCommentEntity } from '../../comment/index.js'
import {
  type ByProvider,
  DanmakuSourceType,
  type DbEntity,
  type RemoteDanmakuSourceType,
} from '../../provider/provider.js'
import {
  type SeasonV1,
  zBilibiliSeasonV1,
  zDanDanPlaySeasonV1,
  zMacCmsSeasonV1,
  zTencentSeasonV1,
} from '../../season/index.js'

/**
 * Custom episode schema
 */
export const zCustomEpisodeInsertV4 = z.object({
  provider: z.union([
    z.literal(DanmakuSourceType.Custom),
    z.literal(DanmakuSourceType.MacCMS),
  ]),
  title: z.string().transform(stripHtml),
  comments: z.array(zCommentEntity),
  commentCount: z.number(),
  schemaVersion: z.literal(4),
})

export type CustomEpisodeInsertV4 = z.infer<typeof zCustomEpisodeInsertV4>

export type CustomEpisodeV4 = DbEntity<CustomEpisodeInsertV4>

export type CustomEpisodeLiteV4 = Omit<CustomEpisodeV4, 'comments'>

/**
 * Remote episode schema
 */
const zBaseEpisodeV4 = z.object({
  // Episode title
  title: z.string().transform(stripHtml),
  // Episode number
  episodeNumber: z.union([z.number(), z.string()]).optional(),
  // Cover image url
  imageUrl: z.url().optional(),
  // Link to source
  externalLink: z.url().optional(),
  // alternative title
  alternativeTitle: z.array(z.string()).optional(),
  provider: z.enum(DanmakuSourceType),
  // unique id within the provider for indexing
  indexedId: z.string(),
  // foreign key in the season table
  seasonId: z.number(),
  comments: z.array(zCommentEntity),
  commentCount: z.number(),
  schemaVersion: z.literal(4),
  // The last time we checked for updates
  lastChecked: z.number(),
})

export const zDanDanPlayProviderIds = z.object({
  episodeId: z.number(),
})

export const zDanDanPlayParams = z.object({
  episodeId: z.number().optional(),
  animeId: z.number().optional(),
  withRelated: z.boolean().optional(),
})

export const zBilibiliProviderIds = z.object({
  cid: z.number(),
  epid: z.number().optional(),
  aid: z.number().optional(),
  bvid: z.string().optional(),
})

export const zTencentProviderIds = z.object({
  vid: z.string(),
})

export const zDanDanPlayEpisodeV4 = zBaseEpisodeV4.extend({
  provider: z.literal(DanmakuSourceType.DanDanPlay),
  providerIds: zDanDanPlayProviderIds,
  params: zDanDanPlayParams.optional(),
})

export const zBilibiliEpisodeV4 = zBaseEpisodeV4.extend({
  provider: z.literal(DanmakuSourceType.Bilibili),
  providerIds: zBilibiliProviderIds,
})

export const zTencentEpisodeV4 = zBaseEpisodeV4.extend({
  provider: z.literal(DanmakuSourceType.Tencent),
  providerIds: zTencentProviderIds,
})

export const zMacCmsProviderIds = z.object({
  url: z.string(),
})

export const zMacCmsEpisodeV4 = zBaseEpisodeV4.extend({
  provider: z.literal(DanmakuSourceType.MacCMS),
  providerIds: zMacCmsProviderIds,
})

export const zEpisodeInsertV4 = z.discriminatedUnion('provider', [
  zDanDanPlayEpisodeV4,
  zBilibiliEpisodeV4,
  zTencentEpisodeV4,
  zMacCmsEpisodeV4,
])

export type EpisodeInsertV4 = z.infer<typeof zEpisodeInsertV4>

export type EpisodeV4 = {
  [K in RemoteDanmakuSourceType]: DbEntity<ByProvider<EpisodeInsertV4, K>>
}[RemoteDanmakuSourceType]

export type EpisodeLiteV4 = {
  [K in RemoteDanmakuSourceType]: Omit<ByProvider<EpisodeV4, K>, 'comments'>
}[RemoteDanmakuSourceType]

export type EpisodeMetaV4 = {
  [K in RemoteDanmakuSourceType]: Omit<
    ByProvider<EpisodeInsertV4, K>,
    'comments' | 'commentCount'
  >
}[RemoteDanmakuSourceType]

export type EpisodeImportV4 = {
  [K in RemoteDanmakuSourceType]: Omit<
    ByProvider<EpisodeInsertV4, K>,
    'seasonId'
  >
}[RemoteDanmakuSourceType]

const zBilibiliEpisodeV4WithSeasonV1 = zBilibiliEpisodeV4.extend({
  season: zBilibiliSeasonV1,
})

const zDanDanPlayEpisodeV4WithSeasonV1 = zDanDanPlayEpisodeV4.extend({
  season: zDanDanPlaySeasonV1,
})

const zTencentEpisodeV4WithSeasonV1 = zTencentEpisodeV4.extend({
  season: zTencentSeasonV1,
})

const zMacCmsEpisodeV4WithSeasonV1 = zMacCmsEpisodeV4.extend({
  season: zMacCmsSeasonV1,
})

export const zEpisodeInsertV4WithSeasonV1 = z.discriminatedUnion('provider', [
  zBilibiliEpisodeV4WithSeasonV1,
  zDanDanPlayEpisodeV4WithSeasonV1,
  zTencentEpisodeV4WithSeasonV1,
  zMacCmsEpisodeV4WithSeasonV1,
])

type EpisodeV4SeasonMap = {
  [DanmakuSourceType.DanDanPlay]: {
    season: ByProvider<SeasonV1, DanmakuSourceType.DanDanPlay>
  }
  [DanmakuSourceType.Bilibili]: {
    season: ByProvider<SeasonV1, DanmakuSourceType.Bilibili>
  }
  [DanmakuSourceType.Tencent]: {
    season: ByProvider<SeasonV1, DanmakuSourceType.Tencent>
  }
  [DanmakuSourceType.MacCMS]: {
    season: ByProvider<SeasonV1, DanmakuSourceType.MacCMS>
  }
}

export type WithSeasonV1<T> = T extends { provider: RemoteDanmakuSourceType }
  ? Readonly<T & EpisodeV4SeasonMap[T['provider']]>
  : never

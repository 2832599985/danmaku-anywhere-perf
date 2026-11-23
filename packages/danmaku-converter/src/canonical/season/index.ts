import type {
  ByProvider,
  DanmakuSourceType,
  DbEntity,
} from '../provider/provider.js'
import type { SeasonInsertV1, SeasonV1 } from './v1/schema.js'

export * from './v1/schema.js'

export const SEASON_SCHEMA_VERSION = 1

export type Season = SeasonV1
export type SeasonInsert = SeasonInsertV1
// CustomSeason is now just the MacCMS variant of SeasonV1
export type CustomSeasonInsert = ByProvider<
  SeasonInsertV1,
  DanmakuSourceType.MacCMS
>
export type CustomSeason = DbEntity<CustomSeasonInsert>

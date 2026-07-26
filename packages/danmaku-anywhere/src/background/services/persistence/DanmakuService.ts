import {
  type BackupParseResult,
  type CommentEntity,
  type CustomEpisode,
  type CustomEpisodeInsert,
  type CustomEpisodeLite,
  EPISODE_SCHEMA_VERSION,
  type Episode,
  type EpisodeInsert,
  type EpisodeLite,
  parseBackupMany,
  type WithSeason,
  zCombinedDanmaku,
} from '@danmaku-anywhere/danmaku-converter'
import { inject, injectable } from 'inversify'
import { SeasonService } from '@/background/services/persistence/SeasonService'
import type {
  CustomEpisodeQueryFilter,
  DanmakuImportData,
  DanmakuImportResult,
  EpisodeQueryFilter,
} from '@/common/danmaku/dto'
import { DanmakuSourceType } from '@/common/danmaku/enums'
import { DanmakuAnywhereDb } from '@/common/db/db'
import { type ILogger, LoggerSymbol } from '@/common/Logger'
import { SeasonMap } from '@/common/seasonMap/SeasonMap'
import type { DbEntity } from '@/common/types/dbEntity'
import { tryCatch } from '@/common/utils/tryCatch'
import { invariant, isServiceWorker } from '@/common/utils/utils'
import { matchPathByName } from './utils/matchPathByName'

@injectable('Singleton')
export class DanmakuService {
  private logger: ILogger

  constructor(
    @inject(SeasonService) private seasonService: SeasonService,
    @inject(DanmakuAnywhereDb) private db: DanmakuAnywhereDb,
    @inject(LoggerSymbol) logger: ILogger
  ) {
    invariant(
      isServiceWorker(),
      'DanmakuService is only available in service worker'
    )
    this.logger = logger.sub('[DanmakuService]')
  }

  async addCustom(data: CustomEpisodeInsert): Promise<CustomEpisode> {
    const toAdd = {
      ...data,
      timeUpdated: Date.now(),
      version: 1,
    }
    const id = await this.db.customEpisode.add(toAdd)

    return {
      id,
      ...toAdd,
    }
  }

  async importCustom(importData: {
    title: string
    comments: CommentEntity[]
  }): Promise<CustomEpisode> {
    return this.addCustom({
      provider: DanmakuSourceType.MacCMS,
      comments: importData.comments,
      commentCount: importData.comments.length,
      title: importData.title,
      schemaVersion: EPISODE_SCHEMA_VERSION,
    })
  }

  async filterCustom(
    filter: CustomEpisodeQueryFilter
  ): Promise<CustomEpisode[]> {
    if (filter.all) {
      return this.db.customEpisode.toArray()
    }
    if (filter.ids) {
      const res = await this.db.customEpisode.bulkGet(filter.ids)
      return res.filter((item) => item !== undefined)
    }
    return this.db.customEpisode.where(filter).toArray()
  }

  async filterCustomLite(
    filter: CustomEpisodeQueryFilter
  ): Promise<CustomEpisodeLite[]> {
    const episodes = await this.filterCustom(filter)
    return episodes.map((episode) => {
      const { comments: _, ...rest } = episode
      return rest
    })
  }

  async getCustomByTitle(title: string): Promise<CustomEpisode | undefined> {
    const normalized = title.startsWith('/') ? title : `/${title}`
    return this.db.customEpisode.get({ title: normalized })
  }

  async matchLocalByTitle(title: string): Promise<CustomEpisode | undefined> {
    // episode title can be a path, so we need to match it by comparing the last part
    const customEpisodesLite = await this.filterCustomLite({
      all: true,
    })
    const match = customEpisodesLite.find((episode) =>
      matchPathByName(title, episode.title)
    )
    if (!match) {
      return undefined
    }
    const customEpisodes = await this.filterCustom({
      ids: [match.id],
    })
    return customEpisodes[0]
  }

  async deleteCustom(filter: CustomEpisodeQueryFilter) {
    if (filter.all) {
      await this.db.customEpisode.clear()
      return
    }
    if (filter.ids) {
      await this.db.customEpisode.bulkDelete(filter.ids)
      return
    }
    await this.db.customEpisode.where(filter).delete()
  }

  async bulkUpsert(data: EpisodeInsert[]): Promise<Episode[]> {
    if (data.length === 0) return []

    return this.db.transaction(
      'rw',
      this.db.episode,
      this.db.season,
      async () => {
        const now = Date.now()
        const results: Episode[] = []

        // Batch lookup: find existing episodes by seasonId+indexedId
        const existingMap = new Map<string, Episode>()
        for (const item of data) {
          const existing = await this.db.episode.get({
            seasonId: item.seasonId,
            indexedId: item.indexedId,
          })
          if (existing) {
            existingMap.set(`${item.seasonId}:${item.indexedId}`, existing)
          }
        }

        const toUpdate: Episode[] = []
        const toAdd: Omit<Episode, 'id'>[] = []
        const updateIndices: number[] = []
        const addIndices: number[] = []

        for (let i = 0; i < data.length; i++) {
          const item = data[i]
          const key = `${item.seasonId}:${item.indexedId}`
          const existing = existingMap.get(key)

          if (existing) {
            toUpdate.push({
              ...existing,
              ...item,
              timeUpdated: now,
              version: existing.version + 1,
            })
            updateIndices.push(i)
          } else {
            toAdd.push({
              ...item,
              timeUpdated: now,
              version: 1,
            })
            addIndices.push(i)
          }
        }

        // Batch update via bulkPut
        if (toUpdate.length > 0) {
          await this.db.episode.bulkPut(toUpdate)
          for (let j = 0; j < toUpdate.length; j++) {
            results[updateIndices[j]] = toUpdate[j]
          }
        }

        // Batch insert via bulkAdd
        if (toAdd.length > 0) {
          const ids = await this.db.episode.bulkAdd(toAdd, { allKeys: true })
          for (let j = 0; j < toAdd.length; j++) {
            results[addIndices[j]] = {
              ...toAdd[j],
              id: ids[j],
            } as Episode
          }
        }

        return results
      }
    )
  }

  async upsert<T extends EpisodeInsert>(data: T): Promise<DbEntity<T>> {
    return this.db.transaction(
      'rw',
      this.db.episode,
      this.db.season,
      async () => {
        const existing = await this.db.episode.get({
          seasonId: data.seasonId,
          indexedId: data.indexedId,
        })

        if (existing) {
          return (await this.update({ ...existing, ...data })) as DbEntity<T>
        }

        return this.add(data)
      }
    )
  }

  async add<T extends EpisodeInsert>(data: T): Promise<DbEntity<T>> {
    const toInsert = {
      ...data,
      timeUpdated: Date.now(),
      version: 1,
    }

    const id = await this.db.transaction(
      'rw',
      this.db.episode,
      this.db.season,
      async () => {
        // check if the seasonId link is valid in a transaction context so the whole operation is atomic
        const season = await this.seasonService.getById(data.seasonId)

        if (!season) {
          this.logger.warn(
            `Season ${data.seasonId} not found when adding danmaku`,
            { seasonId: data.seasonId }
          )
          throw new Error(
            `Inserting episode failed: Season ${data.seasonId} not found`
          )
        }

        const id = await this.db.episode.add(toInsert)

        return id
      }
    )

    return {
      ...toInsert,
      id,
    }
  }

  async update<T extends Episode>(data: T): Promise<T> {
    const toUpdate: T = {
      ...data,
      timeUpdated: Date.now(),
      version: data.version + 1,
    }

    await this.db.episode.update(data.id, toUpdate as Omit<T, 'id'>)

    return toUpdate
  }

  /**
   * This is an arrow function so that the "this" keyword is bound to the class instance
   */
  private joinSeason = async <T extends EpisodeLite>(
    episode: T
  ): Promise<WithSeason<T>> => {
    const season = await this.seasonService.mustGetById(episode.seasonId)

    return {
      ...episode,
      season,
    } as WithSeason<T>
  }

  async filterLite(
    filter: EpisodeQueryFilter
  ): Promise<WithSeason<EpisodeLite>[]> {
    const res = await this.filter(filter)

    return res.map((item) => {
      const { comments: _, ...rest } = item
      return rest
    })
  }

  async filter(filter: EpisodeQueryFilter): Promise<WithSeason<Episode>[]> {
    if (filter.all) {
      const res = await this.db.episode.toArray()
      return Promise.all(res.map(this.joinSeason))
    }

    if (filter.ids) {
      const getMany = async (ids: number[]): Promise<WithSeason<Episode>[]> => {
        const res = await this.db.episode.bulkGet(ids)
        const filtered = res.filter((r) => r !== undefined)
        return Promise.all(filtered.map(this.joinSeason))
      }
      return getMany(filter.ids)
    }

    const res = await this.db.episode.where(filter).toArray()

    return Promise.all(
      res
        .toSorted((a, b) => a.indexedId.localeCompare(b.indexedId))
        .map(this.joinSeason)
    )
  }

  async delete(filter: EpisodeQueryFilter) {
    if (filter.all) {
      // don't delete everything at once
      return
    }
    if (filter.ids) {
      await this.db.episode.bulkDelete(filter.ids)
      return
    }
    await this.db.episode.where(filter).delete()
  }

  async import(importData: DanmakuImportData[]): Promise<DanmakuImportResult> {
    const results: DanmakuImportResult = {
      success: [],
      error: [],
    }

    const importBackup = async (data: BackupParseResult) => {
      let skipped = data.skipped.length
      const imported = []

      for (const [i, item] of data.parsed) {
        try {
          if (item.type === 'Custom') {
            await this.addCustom(item.episode)
            results.success.push({
              title: item.episode.title,
              type: 'Custom',
            })
          } else {
            let savedSeasonId = -1
            let savedSeasonTitle = ''
            await this.db.transaction(
              'rw',
              this.db.season,
              this.db.episode,
              async () => {
                let [existingSeason] = await this.seasonService.filter({
                  providerConfigId: item.season.providerConfigId,
                  indexedId: item.season.indexedId,
                })
                if (!existingSeason) {
                  existingSeason = await this.seasonService.upsert(item.season)
                }
                savedSeasonId = existingSeason.id
                savedSeasonTitle = existingSeason.title

                await this.upsert({
                  ...item.episode,
                  seasonId: existingSeason.id,
                })
              }
            )
            imported.push({
              type: item.season.provider,
              title: item.episode.title,
              seasonId: savedSeasonId,
              seasonTitle: savedSeasonTitle,
            })
          }
        } catch (e) {
          this.logger.error(`Failed to import backup item ${i}`, e)
          skipped += 1
        }
      }

      const grouped = Object.groupBy(
        imported,
        (item) => item.seasonTitle
      ) as Record<
        string,
        {
          type: DanmakuSourceType
          title: string
          seasonId: number
          seasonTitle: string
        }[]
      >

      return {
        skipped,
        imported: grouped,
      }
    }

    for (const { title, data } of importData) {
      const [, err] = await tryCatch(async () => {
        // aggregate errors
        const errors: unknown[] = []

        // 1. parse as custom
        const customParse = zCombinedDanmaku.safeParse(data)

        if (customParse.success) {
          await this.importCustom({
            comments: customParse.data,
            title,
          })
          results.success.push({
            title,
            type: 'Custom',
          })
          return
        }
        errors.push(customParse.error)

        // 2. parse as backup
        const backupParseResult = parseBackupMany(
          Array.isArray(data) ? data : [data]
        )

        if (backupParseResult.parsed.length > 0) {
          const importResult = await importBackup(backupParseResult)

          if (
            Object.keys(importResult.imported).length > 0 ||
            importResult.skipped > 0
          ) {
            results.success.push({
              title,
              type: 'Backup',
              result: importResult,
            })
          }
          return
        }

        // 3. unable to import, return aggregated errors
        errors.push(backupParseResult.skipped)

        results.error.push({
          title,
          message: JSON.stringify(errors, null, 2),
        })
        return
      })
      if (err) {
        results.error.push({
          title,
          message: err.message,
        })
      }
    }

    return results
  }

  async purgeOlderThan(days: number) {
    if (days <= 0) return 0

    const now = Date.now()
    const threshold = now - days * 24 * 60 * 60 * 1000

    // delete danmaku older than threshold, ignoring custom danmaku
    // then clean up orphan seasons that no longer have any episodes
    const deleteCount = await this.db.transaction(
      'rw',
      this.db.episode,
      this.db.season,
      this.db.seasonMap,
      this.db.bookmark,
      async () => {
        // Collect seasonIds of episodes about to be deleted
        const affectedSeasonIds = new Set<number>()
        await this.db.episode
          .where('timeUpdated')
          .below(threshold)
          .each((episode) => {
            affectedSeasonIds.add(episode.seasonId)
          })

        // Delete the old episodes
        const count = await this.db.episode
          .where('timeUpdated')
          .below(threshold)
          .delete()

        // For each affected season, check if it still has episodes
        if (affectedSeasonIds.size > 0) {
          const orphanSeasonIds: number[] = []
          for (const seasonId of affectedSeasonIds) {
            const remaining = await this.db.episode.where({ seasonId }).count()
            if (remaining === 0) {
              orphanSeasonIds.push(seasonId)
            }
          }

          if (orphanSeasonIds.length > 0) {
            await this.db.season.bulkDelete(orphanSeasonIds)

            /**
             * Drop the references too, mirroring SeasonService.delete.
             * Without this a purge leaves seasonMap entries pointing at
             * deleted seasons (so automatic matching keeps resolving to a
             * season that is gone) and bookmark rows holding a dangling
             * unique seasonId.
             */
            await this.db.bookmark
              .where('seasonId')
              .anyOf(orphanSeasonIds)
              .delete()

            for (const seasonId of orphanSeasonIds) {
              await this.db.seasonMap
                .where('seasonIds')
                .equals(seasonId)
                .modify((val) => {
                  const updated =
                    SeasonMap.fromSnapshot(val).withoutSeasonId(seasonId)
                  const snapshot = updated.toSnapshot()
                  val.seasonIds = snapshot.seasonIds
                  val.seasons = snapshot.seasons
                })
            }

            this.logger.log(
              `Cleaned up ${orphanSeasonIds.length} orphan seasons`
            )
          }
        }

        return count
      }
    )

    this.logger.log(
      `Purged ${deleteCount} danmaku older than ${new Date(threshold).toLocaleString()}`
    )

    return deleteCount
  }
}

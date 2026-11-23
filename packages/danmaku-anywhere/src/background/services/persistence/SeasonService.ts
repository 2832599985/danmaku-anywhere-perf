import type { Season, SeasonInsert } from '@danmaku-anywhere/danmaku-converter'
import { inject, injectable } from 'inversify'
import type { SeasonGetAllRequest, SeasonQueryFilter } from '@/common/anime/dto'
import type { RemoteDanmakuSourceType } from '@/common/danmaku/enums'
import { isProvider } from '@/common/danmaku/utils'
import { DanmakuAnywhereDb } from '@/common/db/db'
import { SeasonMap } from '@/common/seasonMap/SeasonMap'
import type { DbEntity } from '@/common/types/dbEntity'

@injectable('Singleton')
export class SeasonService {
  constructor(@inject(DanmakuAnywhereDb) private db: DanmakuAnywhereDb) {}
  async bulkUpsert<T extends SeasonInsert>(data: T[]): Promise<DbEntity<T>[]> {
    if (data.length === 0) return []

    return this.db.transaction('rw', this.db.season, async () => {
      const now = Date.now()
      const results: DbEntity<T>[] = []

      // Batch lookup: find all existing seasons matching providerConfigId+indexedId
      const existingMap = new Map<string, Season>()
      for (const item of data) {
        const existing = await this.db.season.get({
          providerConfigId: item.providerConfigId,
          indexedId: item.indexedId,
        })
        if (existing) {
          existingMap.set(
            `${item.providerConfigId}:${item.indexedId}`,
            existing
          )
        }
      }

      // Prepare items for bulkPut (updates) and bulkAdd (inserts)
      const toUpdate: Season[] = []
      const toAdd: Omit<Season, 'id'>[] = []
      const updateIndices: number[] = []
      const addIndices: number[] = []

      for (let i = 0; i < data.length; i++) {
        const item = data[i]
        const key = `${item.providerConfigId}:${item.indexedId}`
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

      // Batch update via bulkPut (items have id, so Dexie updates in place)
      if (toUpdate.length > 0) {
        await this.db.season.bulkPut(toUpdate)
        for (let j = 0; j < toUpdate.length; j++) {
          results[updateIndices[j]] = toUpdate[j] as DbEntity<T>
        }
      }

      // Batch insert via bulkAdd
      if (toAdd.length > 0) {
        const ids = await this.db.season.bulkAdd(toAdd, { allKeys: true })
        for (let j = 0; j < toAdd.length; j++) {
          results[addIndices[j]] = {
            ...toAdd[j],
            id: ids[j],
          } as unknown as DbEntity<T>
        }
      }

      return results
    })
  }

  async upsert<T extends SeasonInsert>(data: T): Promise<DbEntity<T>> {
    return this.db.transaction('rw', this.db.season, async () => {
      const existing = await this.db.season.get({
        providerConfigId: data.providerConfigId,
        indexedId: data.indexedId,
      })
      if (existing) {
        const toInsert = {
          ...existing,
          ...data,
          timeUpdated: Date.now(),
          version: existing.version + 1,
        }
        await this.db.season.update(existing.id, toInsert)
        return toInsert
      }

      const toInsert = {
        ...data,
        timeUpdated: Date.now(),
        version: 1,
      }
      const id = await this.db.season.add(toInsert)
      return {
        ...toInsert,
        id,
      }
    })
  }

  async mustGetById(id: number): Promise<Season> {
    const result = await this.db.season.get(id)
    if (!result) {
      throw new Error(`No season found for id ${id}`)
    }
    return result
  }

  async getById(id: number): Promise<Season | undefined> {
    return this.db.season.get(id)
  }

  async getByType<T extends RemoteDanmakuSourceType>(
    id: number,
    expectedType: T
  ): Promise<Extract<Season, { provider: T }>> {
    const season = await this.mustGetById(id)

    if (!isProvider(season, expectedType)) {
      throw new Error(
        `Type mismatch getting season: Expected ${expectedType}, got ${season.provider}`
      )
    }

    return season as Extract<Season, { provider: T }>
  }

  async getAll(options: SeasonGetAllRequest) {
    return this.db.transaction(
      'r',
      this.db.season,
      this.db.episode,
      async () => {
        const allSeasons = await this.db.season.toArray()

        // Batch count: group episodes by seasonId in a single pass
        const countMap = new Map<number, number>()
        await this.db.episode.each((episode) => {
          const sid = episode.seasonId
          countMap.set(sid, (countMap.get(sid) ?? 0) + 1)
        })

        const seasons: Season[] = []
        for (const season of allSeasons) {
          const episodeCount = countMap.get(season.id) ?? 0
          if (episodeCount > 0 || options.includeEmpty) {
            seasons.push({
              ...season,
              localEpisodeCount: episodeCount,
            })
          }
        }

        return seasons
      }
    )
  }

  async filter(filter: SeasonQueryFilter): Promise<Season[]> {
    if (filter.ids) {
      return this.db.season.where('id').anyOf(filter.ids).toArray()
    }
    return this.db.season.where(filter).toArray()
  }

  async delete(filter: SeasonQueryFilter): Promise<void> {
    if (filter.id === undefined)
      throw new Error('id must be provided for delete operation')
    const id = filter.id
    await this.db.transaction(
      'rw',
      this.db.episode,
      this.db.season,
      this.db.seasonMap,
      this.db.bookmark,
      async () => {
        await this.db.bookmark.where({ seasonId: id }).delete()
        await this.db.episode
          .where({
            seasonId: id,
          })
          .delete()
        await this.db.season.delete(id)
        await this.db.seasonMap
          .where('seasonIds')
          .equals(id)
          .modify((val) => {
            const updated = SeasonMap.fromSnapshot(val).withoutSeasonId(id)
            const snapshot = updated.toSnapshot()
            val.seasonIds = snapshot.seasonIds
            val.seasons = snapshot.seasons
          })
      }
    )
  }
}

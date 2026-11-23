import { describe, expect, it } from 'vitest'
import type { SeasonMapSnapshot } from '@/common/seasonMap/SeasonMap'
import { TitleMappingService } from './TitleMappingService'

class FakeSeasonMapTable {
  private store = new Map<string, SeasonMapSnapshot>()

  async get(query: { key: string }) {
    return this.store.get(query.key)
  }

  async put(value: SeasonMapSnapshot, key?: string) {
    this.store.set(key ?? value.key, value)
  }

  async add(value: SeasonMapSnapshot) {
    this.store.set(value.key, value)
  }

  where(query: { key: string }) {
    return {
      delete: async () => {
        this.store.delete(query.key)
      },
    }
  }

  async toArray() {
    return Array.from(this.store.values())
  }
}

const createService = () => {
  const db = {
    seasonMap: new FakeSeasonMapTable(),
  }

  const logger = {
    debug: () => {},
    sub: () => logger,
  }

  return {
    db,
    service: new TitleMappingService(db as never, logger as never),
  }
}

describe('TitleMappingService', () => {
  it('removes a provider mapping without affecting other providers', async () => {
    const { db, service } = createService()

    await db.seasonMap.add({
      key: 'media-key',
      seasons: {
        ddp: 10,
        bilibili: 42,
      },
      seasonIds: [10, 42],
    })

    await service.removeProvider('media-key', 'ddp')

    const saved = await db.seasonMap.get({ key: 'media-key' })
    expect(saved).toEqual({
      key: 'media-key',
      seasons: {
        bilibili: 42,
      },
      seasonIds: [42],
    })
  })

  it('deletes the mapping when the last provider mapping is removed', async () => {
    const { db, service } = createService()

    await db.seasonMap.add({
      key: 'media-key',
      seasons: {
        ddp: 10,
      },
      seasonIds: [10],
    })

    await service.removeProvider('media-key', 'ddp')

    const saved = await db.seasonMap.get({ key: 'media-key' })
    expect(saved).toBeUndefined()
  })
})

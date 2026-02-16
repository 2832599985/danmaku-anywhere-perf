import { inject, injectable } from 'inversify'
import { LogsDb } from '@/common/db/logsDb'
import type { LogEntry } from '@/common/Logger'

@injectable('Singleton')
export class LogsDbService {
  constructor(@inject(LogsDb) private db: LogsDb) {}

  async add(entry: LogEntry) {
    return this.db.logs.add(entry)
  }

  async count() {
    return this.db.logs.count()
  }

  async getOldestKeys(limit: number) {
    return this.db.logs.orderBy('id').limit(limit).primaryKeys()
  }

  async deleteOldest(limit: number) {
    const keys = await this.getOldestKeys(limit)
    return this.db.logs.bulkDelete(keys)
  }

  async deleteOlderThan(timestamp: number) {
    return this.db.logs.where('timestamp').below(timestamp).delete()
  }

  async exportSorted() {
    return this.db.logs.orderBy('timestamp').toArray()
  }

  async clear() {
    return this.db.logs.clear()
  }

  /**
   * Purge old logs: delete entries older than maxAgeDays,
   * then cap remaining entries to maxEntries (keeping newest).
   */
  async purge(maxAgeDays = 7, maxEntries = 1000) {
    const threshold = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000
    await this.deleteOlderThan(threshold)

    const remaining = await this.count()
    if (remaining > maxEntries) {
      await this.deleteOldest(remaining - maxEntries)
    }
  }
}

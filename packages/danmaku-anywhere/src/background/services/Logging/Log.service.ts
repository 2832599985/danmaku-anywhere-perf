import { inject, injectable } from 'inversify'
import type { LogEntry } from '@/common/Logger'
import { LogsDbService } from './LogsDb.service'

const MAX_LOGS = 1000
const DELETE_BUFFER = 100
const PRUNE_CHECK_PROBABILITY = 0.05
const RETENTION_DAYS = 7
const MS_PER_DAY = 24 * 60 * 60 * 1000

@injectable('Singleton')
export class LogService {
  constructor(@inject(LogsDbService) private logsDb: LogsDbService) {}

  async log(entry: LogEntry) {
    // best effort save, non-blocking
    void this.saveLog(entry)
  }

  private async saveLog(entry: LogEntry) {
    try {
      await this.logsDb.add(entry)

      // loose check to avoid counting every time
      if (Math.random() < PRUNE_CHECK_PROBABILITY) {
        // Prune by age: delete logs older than retention period
        const threshold = Date.now() - RETENTION_DAYS * MS_PER_DAY
        await this.logsDb.deleteOlderThan(threshold)

        // Prune by count: keep at most MAX_LOGS entries
        const count = await this.logsDb.count()
        if (count > MAX_LOGS) {
          const deleteCount = count - MAX_LOGS + DELETE_BUFFER
          await this.logsDb.deleteOldest(deleteCount)
        }
      }
    } catch (e) {
      console.error('Failed to save log', e)
    }
  }
}

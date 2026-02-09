import { inject, injectable } from 'inversify'
import { ConfigStateService } from '@/background/services/Backup/ConfigStateService'
import type { IBackupSink } from '@/background/services/Backup/sinks/BackupSink.interface'
import type { BackupData, BackupRestoreResult } from '@/common/backup/dto'

@injectable('Singleton')
export class BackupService {
  constructor(
    @inject(ConfigStateService)
    private configStateService: ConfigStateService
  ) {}

  async getBackupData(): Promise<BackupData> {
    return this.configStateService.getState()
  }

  async importAll(backup: unknown): Promise<BackupRestoreResult> {
    let backupData = backup
    if (typeof backup === 'string') {
      try {
        backupData = JSON.parse(backup)
      } catch {
        throw new Error('Failed to parse backup data as JSON')
      }
    }

    // Validate top-level structure of backup data
    if (
      !backupData ||
      typeof backupData !== 'object' ||
      !('meta' in backupData) ||
      !('services' in backupData)
    ) {
      throw new Error(
        'Invalid backup data: missing required "meta" and "services" keys'
      )
    }

    const { meta, services } = backupData as Record<string, unknown>
    if (
      !meta ||
      typeof meta !== 'object' ||
      !('version' in meta) ||
      typeof (meta as Record<string, unknown>).version !== 'number'
    ) {
      throw new Error('Invalid backup data: "meta.version" must be a number')
    }
    if (!services || typeof services !== 'object') {
      throw new Error('Invalid backup data: "services" must be an object')
    }

    return this.configStateService.restoreState(backupData as BackupData)
  }

  async backupTo(sink: IBackupSink): Promise<void> {
    const data = await this.configStateService.getState()
    await sink.save(data)
  }
}

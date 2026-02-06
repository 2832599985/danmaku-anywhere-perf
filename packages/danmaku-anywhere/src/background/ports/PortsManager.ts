import { injectable } from 'inversify'
import { setupContentPing } from '@/background/ports/content-ping'
import { setupDanmakuParse } from '@/background/ports/danmaku-parse'
import { setupExtractMedia } from '@/background/ports/media-extraction'

@injectable('Singleton')
export class PortsManager {
  setup() {
    setupExtractMedia()
    setupContentPing()
    setupDanmakuParse()
  }
}

import { inject, injectable } from 'inversify'
import { type ILogger, LoggerSymbol } from '@/common/Logger'
import { TranslationApiClient } from './TranslationApiClient'

const MAX_CACHE_SIZE = 5000

@injectable('Singleton')
export class TranslationService {
  private logger: ILogger
  private cache = new Map<string, string>()
  private apiClient: TranslationApiClient

  constructor(@inject(LoggerSymbol) logger: ILogger) {
    this.logger = logger.sub('[TranslationService]')

    const proxyUrl = (import.meta.env as unknown as { VITE_PROXY_URL?: string })
      .VITE_PROXY_URL
    this.apiClient = new TranslationApiClient(proxyUrl || undefined)
  }

  private getCacheKey(text: string, targetLang: string): string {
    return `${targetLang}:${text}`
  }

  private evictIfNeeded(): void {
    if (this.cache.size <= MAX_CACHE_SIZE) return

    // Delete oldest entries (first inserted)
    const toDelete = this.cache.size - MAX_CACHE_SIZE + 500
    const iterator = this.cache.keys()
    for (let i = 0; i < toDelete; i++) {
      const key = iterator.next().value
      if (key !== undefined) {
        this.cache.delete(key)
      }
    }
  }

  async translateBatch(texts: string[], targetLang: string): Promise<string[]> {
    if (texts.length === 0) return []

    // 1. Check cache for already-translated texts
    const results = new Array<string>(texts.length)
    const missIndices: number[] = []
    const missTexts: string[] = []

    for (let i = 0; i < texts.length; i++) {
      const cached = this.cache.get(this.getCacheKey(texts[i], targetLang))
      if (cached !== undefined) {
        results[i] = cached
      } else {
        missIndices.push(i)
        missTexts.push(texts[i])
      }
    }

    if (missTexts.length === 0) {
      this.logger.debug(`All ${texts.length} texts found in cache`)
      return results
    }

    this.logger.debug(
      `Cache hit: ${texts.length - missTexts.length}, miss: ${missTexts.length}`
    )

    // 2. For cache misses, call the backend API
    const response = await this.apiClient.translateBatch(missTexts, targetLang)

    // 3. Cache results and fill in the response array
    for (let i = 0; i < missIndices.length; i++) {
      const translation = response.translations[i]
      if (translation !== undefined) {
        const originalIndex = missIndices[i]
        results[originalIndex] = translation
        this.cache.set(this.getCacheKey(missTexts[i], targetLang), translation)
      }
    }

    this.evictIfNeeded()

    // 4. Return all translations in order
    return results
  }
}

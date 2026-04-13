import type { TranslationResponse } from './types'

const API_ROOT = 'https://api.danmaku.weeblify.app'

export class TranslationApiClient {
  private baseUrl: string

  constructor(baseUrl?: string) {
    this.baseUrl = baseUrl ?? API_ROOT
  }

  async translateBatch(
    texts: string[],
    targetLang: string
  ): Promise<TranslationResponse> {
    const url = `${this.baseUrl}/api/translate/v1/batch`

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ texts, targetLang }),
    })

    if (!res.ok) {
      const errorText = await res.text().catch(() => res.statusText)
      throw new Error(
        `Translation API failed with status ${res.status}: ${errorText}`
      )
    }

    const data: { translations: string[]; success: boolean } = await res.json()

    if (!data.success) {
      throw new Error('Translation API returned unsuccessful response')
    }

    return { translations: data.translations }
  }
}

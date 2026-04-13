export interface TranslationRequest {
  texts: string[]
  targetLang: 'en' | 'ja' | 'zh' | 'ko'
}

export interface TranslationResponse {
  translations: string[]
}

export type TranslationMode = 'replace' | 'dual' | 'off'

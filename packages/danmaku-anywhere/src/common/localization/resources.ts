import enTranslation from './locales/en/translation.json' with { type: 'json' }
import zhTranslation from './locales/zh/translation.json' with { type: 'json' }

export const resources = {
  en: {
    translation: enTranslation,
  },
  zh: {
    translation: zhTranslation,
  },
}

declare module 'i18next' {
  interface CustomTypeOptions {
    // Must stay namespace-keyed. Assigning `typeof enTranslation` directly makes
    // i18next read every top-level section as a namespace, so the default
    // namespace collapses onto the unrelated `translation` section and every
    // t() key in the app fails to type-check.
    resources: { translation: typeof enTranslation }
  }
}

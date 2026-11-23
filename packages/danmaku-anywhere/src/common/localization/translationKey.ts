import type { ParseKeys } from 'i18next'

/**
 * A key that exists in the translation resources.
 *
 * Use it wherever a key is stored for later lookup (config tables, theme
 * metadata) so typos are caught at the definition site instead of silently
 * rendering the raw key at runtime.
 */
export type TranslationKey = ParseKeys

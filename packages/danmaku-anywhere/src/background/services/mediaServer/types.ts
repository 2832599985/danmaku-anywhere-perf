export type MediaServerType = 'jellyfin' | 'emby' | 'plex'

export interface MediaServerConfig {
  type: MediaServerType
  baseUrl: string
  apiKey: string
  userId?: string // Jellyfin/Emby need this
}

export interface MediaMetadata {
  title: string
  originalTitle?: string
  season?: number
  episode?: number
  tmdbId?: string
  anidbId?: string
  year?: number
}

/**
 * URL patterns for detecting media server pages.
 * Each pattern includes the server type and a regex to extract the item ID.
 */
export interface MediaServerUrlPattern {
  type: MediaServerType
  /**
   * Regex to match the URL. Must have a named capture group `itemId`.
   */
  pattern: RegExp
}

/**
 * Result of extracting media server info from a URL.
 */
export interface MediaServerUrlMatch {
  type: MediaServerType
  itemId: string
  baseUrl: string
}

import { inject, injectable } from 'inversify'
import { type ILogger, LoggerSymbol } from '@/common/Logger'
import type {
  MediaMetadata,
  MediaServerConfig,
  MediaServerType,
  MediaServerUrlMatch,
} from './types'

/**
 * URL patterns for detecting media server pages and extracting item IDs.
 *
 * Jellyfin: /web/#/details?id=ITEM_ID or /web/index.html#!/details?id=ITEM_ID
 * Emby:     /web/#/item?id=ITEM_ID or /web/index.html#!/item?id=ITEM_ID
 * Plex:     /web/index.html#!/server/MACHINE_ID/details?key=%2Flibrary%2Fmetadata%2FRATING_KEY
 */
const URL_PATTERNS: Array<{
  type: MediaServerType
  match: (url: URL) => string | null
}> = [
  {
    type: 'jellyfin',
    match: (url) => {
      // Jellyfin uses hash routing: #/details?id=ITEM_ID
      const hash = url.hash
      if (!hash) return null
      const detailsMatch = hash.match(
        /[#!\/]*details\?.*?(?:^|&)id=([a-f0-9]+)/i
      )
      return detailsMatch?.[1] ?? null
    },
  },
  {
    type: 'emby',
    match: (url) => {
      // Emby uses hash routing: #/item?id=ITEM_ID
      const hash = url.hash
      if (!hash) return null
      const itemMatch = hash.match(/[#!\/]*item\?.*?(?:^|&)id=([a-f0-9]+)/i)
      return itemMatch?.[1] ?? null
    },
  },
  {
    type: 'plex',
    match: (url) => {
      // Plex: key=%2Flibrary%2Fmetadata%2FRATING_KEY in hash
      const hash = url.hash
      if (!hash) return null
      const keyMatch = hash.match(/key=%2Flibrary%2Fmetadata%2F(\d+)/i)
      return keyMatch?.[1] ?? null
    },
  },
]

@injectable('Singleton')
export class MediaServerApiService {
  private logger: ILogger
  private configs: MediaServerConfig[] = []

  constructor(@inject(LoggerSymbol) logger: ILogger) {
    this.logger = logger.sub('[MediaServerApiService]')
  }

  /**
   * Register media server configurations.
   * In a future iteration, these could come from extension options.
   */
  setConfigs(configs: MediaServerConfig[]): void {
    this.configs = configs
  }

  getConfigs(): MediaServerConfig[] {
    return this.configs
  }

  /**
   * Try to extract a media server match from a tab URL.
   * Returns null if the URL doesn't match any known media server pattern.
   */
  extractFromUrl(tabUrl: string): MediaServerUrlMatch | null {
    let url: URL
    try {
      url = new URL(tabUrl)
    } catch {
      return null
    }

    for (const pattern of URL_PATTERNS) {
      const itemId = pattern.match(url)
      if (itemId) {
        const baseUrl = `${url.protocol}//${url.host}`
        return { type: pattern.type, itemId, baseUrl }
      }
    }

    return null
  }

  /**
   * Find a matching config for the given server type and base URL.
   */
  findConfig(
    type: MediaServerType,
    baseUrl: string
  ): MediaServerConfig | undefined {
    return this.configs.find(
      (c) =>
        c.type === type &&
        this.normalizeUrl(c.baseUrl) === this.normalizeUrl(baseUrl)
    )
  }

  /**
   * Fetch media metadata from a Jellyfin/Emby/Plex server.
   */
  async getMetadata(
    config: MediaServerConfig,
    itemId: string
  ): Promise<MediaMetadata | null> {
    try {
      switch (config.type) {
        case 'jellyfin':
        case 'emby':
          return await this.fetchJellyfinEmbyMetadata(config, itemId)
        case 'plex':
          return await this.fetchPlexMetadata(config, itemId)
      }
    } catch (e) {
      this.logger.warn(`Failed to fetch metadata from ${config.type}`, e)
      return null
    }
  }

  private async fetchJellyfinEmbyMetadata(
    config: MediaServerConfig,
    itemId: string
  ): Promise<MediaMetadata | null> {
    const userId = config.userId
    if (!userId) {
      this.logger.warn(
        `${config.type} config requires userId but none was provided`
      )
      return null
    }

    const url = `${this.normalizeUrl(config.baseUrl)}/Users/${userId}/Items/${itemId}`
    const response = await fetch(url, {
      headers: {
        'X-Emby-Token': config.apiKey,
      },
    })

    if (!response.ok) {
      this.logger.warn(
        `${config.type} API returned ${response.status} for item ${itemId}`
      )
      return null
    }

    const data = (await response.json()) as Record<string, unknown>
    return this.parseJellyfinEmbyResponse(data)
  }

  private async fetchPlexMetadata(
    config: MediaServerConfig,
    itemId: string
  ): Promise<MediaMetadata | null> {
    const url = `${this.normalizeUrl(config.baseUrl)}/library/metadata/${itemId}`
    const response = await fetch(url, {
      headers: {
        'X-Plex-Token': config.apiKey,
        Accept: 'application/json',
      },
    })

    if (!response.ok) {
      this.logger.warn(
        `Plex API returned ${response.status} for item ${itemId}`
      )
      return null
    }

    const data = (await response.json()) as Record<string, unknown>
    return this.parsePlexResponse(data)
  }

  private parseJellyfinEmbyResponse(
    data: Record<string, unknown>
  ): MediaMetadata | null {
    // Jellyfin/Emby return a flat item object
    const name = data.SeriesName ?? data.Name
    if (typeof name !== 'string') {
      return null
    }

    const metadata: MediaMetadata = {
      title: name,
    }

    if (typeof data.OriginalTitle === 'string') {
      metadata.originalTitle = data.OriginalTitle
    }

    if (typeof data.ParentIndexNumber === 'number') {
      metadata.season = data.ParentIndexNumber
    }

    if (typeof data.IndexNumber === 'number') {
      metadata.episode = data.IndexNumber
    }

    if (typeof data.ProductionYear === 'number') {
      metadata.year = data.ProductionYear
    }

    // Extract provider IDs (TMDB, AniDB)
    const providerIds = data.ProviderIds as Record<string, string> | undefined
    if (providerIds) {
      if (providerIds.Tmdb) {
        metadata.tmdbId = providerIds.Tmdb
      }
      if (providerIds.AniDB) {
        metadata.anidbId = providerIds.AniDB
      }
    }

    return metadata
  }

  private parsePlexResponse(
    data: Record<string, unknown>
  ): MediaMetadata | null {
    // Plex wraps results in MediaContainer.Metadata[]
    const container = data.MediaContainer as Record<string, unknown> | undefined
    if (!container) {
      return null
    }

    const metadataArray = container.Metadata as
      | Record<string, unknown>[]
      | undefined
    if (!metadataArray || metadataArray.length === 0) {
      return null
    }

    const item = metadataArray[0]
    // For episodes, grandparentTitle is the series name
    const title = item.grandparentTitle ?? item.parentTitle ?? item.title
    if (typeof title !== 'string') {
      return null
    }

    const metadata: MediaMetadata = {
      title,
    }

    if (typeof item.originalTitle === 'string') {
      metadata.originalTitle = item.originalTitle
    }

    if (typeof item.parentIndex === 'number') {
      metadata.season = item.parentIndex
    }

    if (typeof item.index === 'number') {
      metadata.episode = item.index
    }

    if (typeof item.year === 'number') {
      metadata.year = item.year
    }

    return metadata
  }

  private normalizeUrl(url: string): string {
    return url.replace(/\/+$/, '')
  }
}

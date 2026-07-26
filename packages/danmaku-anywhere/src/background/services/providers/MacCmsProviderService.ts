import type {
  CommentEntity,
  CustomSeason,
  EpisodeMeta,
  Season,
  SeasonInsert,
  WithSeason,
} from '@danmaku-anywhere/danmaku-converter'
import type { MacCmsParsedPlayUrl } from '@danmaku-anywhere/danmaku-provider/maccms'
import {
  fetchDanmuIcuComments,
  searchMacCmsVod,
} from '@danmaku-anywhere/danmaku-provider/maccms'
import type { DanmakuService } from '@/background/services/persistence/DanmakuService'
import type { DanmakuFetchByMeta } from '@/common/danmaku/dto'
import { DanmakuSourceType } from '@/common/danmaku/enums'
import { assertProviderType } from '@/common/danmaku/utils'
import type { ILogger } from '@/common/Logger'
import type { CustomMacCmsProvider } from '@/common/options/providerConfig/schema'
import type { ProviderConfigService } from '@/common/options/providerConfig/service'
import { invariant, isServiceWorker } from '@/common/utils/utils'
import { findEpisodeByNumber } from './common/findEpisodeByNumber'
import type {
  IDanmakuProvider,
  OmitSeasonId,
  SeasonSearchParams,
} from './IDanmakuProvider'

/**
 * Cache parsed play URLs from search results, keyed by indexedId.
 *
 * Module scoped rather than per-instance because DanmakuProviderFactory builds
 * a new service for every call, so an instance field would be discarded before
 * anything could read it. The cache still dies with the service worker, which
 * is what the re-search recovery in getEpisodesByIndexedId is for.
 */
const episodeCache = new Map<string, MacCmsParsedPlayUrl[]>()

const MAX_CACHED_SEASONS = 100

/**
 * Drop every cached season.
 *
 * In production only a service worker restart clears this cache, which tests
 * cannot trigger — they use this to exercise the re-search recovery path.
 */
export const clearMacCmsEpisodeCache = (): void => {
  episodeCache.clear()
}

const cacheEpisodes = (
  indexedId: string,
  playUrls: MacCmsParsedPlayUrl[]
): void => {
  // re-insert so the bound evicts the least recently written entry
  episodeCache.delete(indexedId)
  episodeCache.set(indexedId, playUrls)

  while (episodeCache.size > MAX_CACHED_SEASONS) {
    const oldest = episodeCache.keys().next()
    if (oldest.done) break
    episodeCache.delete(oldest.value)
  }
}

export class MacCmsProviderService implements IDanmakuProvider {
  readonly forProvider = DanmakuSourceType.MacCMS
  private logger: ILogger

  constructor(
    private config: CustomMacCmsProvider,
    logger: ILogger
  ) {
    this.logger = logger.sub('[MacCmsProviderService]')
    invariant(
      isServiceWorker(),
      'MacCmsProviderService is only available in service worker'
    )
  }

  async search(params: SeasonSearchParams): Promise<SeasonInsert[]> {
    this.logger.debug('Searching for', {
      baseUrl: this.config.options.danmakuBaseUrl,
      keyword: params.keyword,
    })
    const res = await searchMacCmsVod(
      this.config.options.danmakuBaseUrl,
      params.keyword
    )

    if (!res.success) {
      throw res.error
    }

    return res.data.list.map((item) => {
      const indexedId = `custom:${item.vod_id}`

      // Cache parsed play URLs for getEpisodesByIndexedId()
      cacheEpisodes(indexedId, item.parsedPlayUrls)

      return {
        indexedId,
        title: item.vod_name,
        type: 'Custom',
        imageUrl: item.vod_pic ?? undefined,
        externalLink: undefined,
        localEpisodeCount: undefined,
        year: item.vod_year
          ? Number.parseInt(item.vod_year) || undefined
          : undefined,
        schemaVersion: 1 as const,
        provider: DanmakuSourceType.MacCMS,
        providerIds: {},
        providerConfigId: this.config.id,
      }
    })
  }

  /**
   * MacCMS seasons are identified by `indexedId`, not by `providerIds` (which
   * is always `{}`), so this signature carries nothing to look up. Combining
   * every cached season here would return another show's episodes, so callers
   * must go through getEpisodesByIndexedId — which is what ProviderService
   * does for this provider.
   */
  async getEpisodes(
    _providerIds: Record<string, never>
  ): Promise<OmitSeasonId<EpisodeMeta>[]> {
    throw new Error(
      'MacCmsProviderService.getEpisodes cannot identify a season from providerIds; use getEpisodesByIndexedId instead'
    )
  }

  async getEpisodesByIndexedId(
    indexedId: string,
    title?: string
  ): Promise<OmitSeasonId<EpisodeMeta>[]> {
    let playUrls = episodeCache.get(indexedId)

    if (!playUrls && title) {
      this.logger.debug(
        `Cache miss for indexedId: ${indexedId}, re-searching with title: ${title}`
      )
      await this.search({ keyword: title })
      playUrls = episodeCache.get(indexedId)
    }

    if (!playUrls) {
      this.logger.warn(
        `No cached episodes found for indexedId: ${indexedId}. ` +
          'This may happen if the cache was cleared. Try searching again.'
      )
      return []
    }

    return this.playUrlsToEpisodes(playUrls)
  }

  async findEpisode(
    season: Season,
    episodeNumber: number
  ): Promise<WithSeason<EpisodeMeta> | null> {
    assertProviderType(season, DanmakuSourceType.MacCMS)

    const episodes = await this.getEpisodesByIndexedId(
      season.indexedId,
      season.title
    )

    if (episodes.length === 0) {
      return null
    }

    const episode = findEpisodeByNumber(episodes, episodeNumber)

    if (!episode) {
      return null
    }

    return {
      ...episode,
      seasonId: season.id,
      season,
    } as WithSeason<EpisodeMeta>
  }

  async getDanmaku(request: DanmakuFetchByMeta): Promise<CommentEntity[]> {
    assertProviderType(request.meta, DanmakuSourceType.MacCMS)

    const url = request.meta.providerIds.url

    this.logger.debug('Fetching danmaku for URL:', url)

    const commentsResult = await fetchDanmuIcuComments(
      this.config.options.danmuicuBaseUrl,
      url,
      this.config.options.stripColor
    )

    if (!commentsResult.success) {
      throw commentsResult.error
    }

    return commentsResult.data
  }

  async preloadNextEpisode(request: DanmakuFetchByMeta): Promise<void> {
    assertProviderType(request.meta, DanmakuSourceType.MacCMS)

    const { meta } = request
    const episodes = await this.getEpisodesByIndexedId(
      meta.season.indexedId,
      meta.season.title
    )

    const currentIndex = episodes.findIndex(
      (e) => e.indexedId === meta.indexedId
    )

    if (currentIndex === -1 || currentIndex >= episodes.length - 1) {
      this.logger.debug('Next episode not found for preload')
      return
    }

    const nextEpisode = episodes[currentIndex + 1]
    assertProviderType(
      nextEpisode as { provider: DanmakuSourceType },
      DanmakuSourceType.MacCMS
    )

    // Pre-fetch the danmaku so it gets cached
    const commentsResult = await fetchDanmuIcuComments(
      this.config.options.danmuicuBaseUrl,
      (nextEpisode as { providerIds: { url: string } }).providerIds.url,
      this.config.options.stripColor
    )

    if (!commentsResult.success) {
      throw commentsResult.error
    }
  }

  /**
   * Legacy static search for the `genericVodSearch` RPC.
   * Returns the old CustomSeason format with embedded episodes.
   */
  static async search(
    baseUrl: string,
    keyword: string,
    logger: ILogger
  ): Promise<CustomSeason[]> {
    logger.debug('Searching for (legacy)', { baseUrl, keyword })
    const res = await searchMacCmsVod(baseUrl, keyword)

    if (!res.success) {
      throw res.error
    }

    return res.data.list.map((item, i) => {
      const id = `custom:${item.vod_id}:${i}`
      return {
        id: i,
        version: 1,
        timeUpdated: 0,
        indexedId: id,
        title: item.vod_name,
        type: 'Custom',
        imageUrl: item.vod_pic ?? undefined,
        externalLink: undefined,
        localEpisodeCount: undefined,
        year: item.vod_year
          ? Number.parseInt(item.vod_year) || undefined
          : undefined,
        schemaVersion: 1 as const,
        provider: DanmakuSourceType.MacCMS,
        providerIds: {},
        providerConfigId: '',
        episodes: item.parsedPlayUrls,
      } as CustomSeason & { episodes: MacCmsParsedPlayUrl[] }
    })
  }

  static async fetchDanmakuForUrl(
    title: string,
    url: string,
    providerConfigId: string,
    danmakuService: DanmakuService,
    providerConfigService: ProviderConfigService
  ) {
    // TODO: Use the config from the instance
    const config = await providerConfigService.get(providerConfigId)
    if (!config) {
      throw new Error(
        `Provider config with ID "${providerConfigId}" not found. Please ensure the provider configuration exists.`
      )
    }
    if (config.type !== 'MacCMS') {
      throw new Error(
        `Invalid provider type "${config.type}" for MacCMS service. Expected "MacCMS".`
      )
    }

    const commentsResult = await fetchDanmuIcuComments(
      config.options.danmuicuBaseUrl,
      url,
      config.options.stripColor
    )

    if (!commentsResult.success) {
      throw commentsResult.error
    }

    const comments = commentsResult.data

    return danmakuService.importCustom({ title, comments })
  }

  private playUrlsToEpisodes(
    playUrls: MacCmsParsedPlayUrl[]
  ): OmitSeasonId<EpisodeMeta>[] {
    return playUrls.map((playUrl, index) => ({
      provider: DanmakuSourceType.MacCMS,
      indexedId: playUrl.url,
      title: playUrl.originalTitle,
      episodeNumber: this.extractEpisodeNumber(playUrl.originalTitle, index),
      providerIds: { url: playUrl.url },
      schemaVersion: 4 as const,
      lastChecked: Date.now(),
    }))
  }

  private extractEpisodeNumber(
    title: string,
    index: number
  ): number | undefined {
    const trimmed = title.trim()

    /**
     * Anchored patterns first. A bare first-digit-run would pick up years and
     * resolutions instead of the episode ("2024版 第3集" -> 2024, "1080P 第5集"
     * -> 1080), which breaks findEpisodeByNumber and silently kills automatic
     * matching for sources that prefix their episode titles.
     */
    const anchored = [
      /第\s*(\d+)\s*[集話话期]/, // 第01集 / 第 3 话
      /\bEP?\s*[.\-_]?\s*(\d+)\b/i, // EP02 / E02 / ep.3
      /^(\d+)$/, // bare "01"
    ]

    for (const pattern of anchored) {
      const match = trimmed.match(pattern)
      if (match) {
        return Number.parseInt(match[1], 10)
      }
    }

    // No anchor matched, fall back to the first number anywhere in the title
    const loose = trimmed.match(/\d+/)
    if (loose) {
      return Number.parseInt(loose[0], 10)
    }

    // Fallback to 1-based index
    return index + 1
  }
}

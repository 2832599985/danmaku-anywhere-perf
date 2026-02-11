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
import type { DanmakuFetchRequest } from '@/common/danmaku/dto'
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

export class MacCmsProviderService implements IDanmakuProvider {
  readonly forProvider = DanmakuSourceType.MacCMS
  private logger: ILogger

  // Cache parsed play URLs from search results, keyed by indexedId
  private episodeCache = new Map<string, MacCmsParsedPlayUrl[]>()

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

      // Cache parsed play URLs for getEpisodes()
      this.episodeCache.set(indexedId, item.parsedPlayUrls)

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

  async getEpisodes(
    _providerIds: Record<string, never>
  ): Promise<OmitSeasonId<EpisodeMeta>[]> {
    // Episodes were cached during search(). We need to find the right cache entry.
    // Since getEpisodes is called via season (which has indexedId), we iterate all cached entries.
    // The caller (ProviderService.fetchEpisodesBySeason) should use the indexedId-based approach instead.
    // For now, return all cached episodes combined — caller will filter by seasonId.

    // Collect from all cached entries. In practice, this is called after search().
    const allEpisodes: OmitSeasonId<EpisodeMeta>[] = []

    for (const [, playUrls] of this.episodeCache) {
      allEpisodes.push(...this.playUrlsToEpisodes(playUrls))
    }

    return allEpisodes
  }

  async getEpisodesByIndexedId(
    indexedId: string,
    title?: string
  ): Promise<OmitSeasonId<EpisodeMeta>[]> {
    let playUrls = this.episodeCache.get(indexedId)

    if (!playUrls && title) {
      this.logger.debug(
        `Cache miss for indexedId: ${indexedId}, re-searching with title: ${title}`
      )
      await this.search({ keyword: title })
      playUrls = this.episodeCache.get(indexedId)
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

  async getDanmaku(request: DanmakuFetchRequest): Promise<CommentEntity[]> {
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

  async preloadNextEpisode(request: DanmakuFetchRequest): Promise<void> {
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
    assertProviderType(nextEpisode, DanmakuSourceType.MacCMS)

    // Pre-fetch the danmaku so it gets cached
    const commentsResult = await fetchDanmuIcuComments(
      this.config.options.danmuicuBaseUrl,
      nextEpisode.providerIds.url,
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
    // Try to extract a number from the episode title (e.g., "第01集" -> 1, "EP02" -> 2)
    const match = title.match(/\d+/)
    if (match) {
      return Number.parseInt(match[0])
    }
    // Fallback to 1-based index
    return index + 1
  }
}

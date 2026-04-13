import type { Season } from '@danmaku-anywhere/danmaku-converter'
import { inject, injectable } from 'inversify'
import { SeasonService } from '@/background/services/persistence/SeasonService'
import { TitleMappingService } from '@/background/services/persistence/TitleMappingService'
import type { MatchEpisodeInput, MatchEpisodeResult } from '@/common/anime/dto'
import { type ILogger, LoggerSymbol } from '@/common/Logger'
import { ProviderConfigService } from '@/common/options/providerConfig/service'
import { SeasonMap } from '@/common/seasonMap/SeasonMap'
import { serializeError } from '@/common/utils/serializeError'
import { MediaServerApiService } from '../../mediaServer/MediaServerApiService'
import {
  DanmakuProviderFactory,
  type IDanmakuProviderFactory,
} from '../../providers/ProviderFactory'
import { EpisodeResolutionService } from '../EpisodeResolutionService'
import type { IMatchingStrategy } from './IMatchingStrategy'
import { findBestMatchingSeason } from './titleMatch'

@injectable()
export class MediaServerMatchingStrategy implements IMatchingStrategy {
  readonly name = 'mediaServer'

  private logger: ILogger

  constructor(
    @inject(MediaServerApiService)
    private mediaServerApi: MediaServerApiService,
    @inject(ProviderConfigService)
    private providerConfigService: ProviderConfigService,
    @inject(DanmakuProviderFactory)
    private danmakuProviderFactory: IDanmakuProviderFactory,
    @inject(SeasonService) private seasonService: SeasonService,
    @inject(TitleMappingService)
    private titleMappingService: TitleMappingService,
    @inject(EpisodeResolutionService)
    private episodeResolver: EpisodeResolutionService,
    @inject(LoggerSymbol) logger: ILogger
  ) {
    this.logger = logger.sub('[MediaServerMatchingStrategy]')
  }

  async match(input: MatchEpisodeInput): Promise<MatchEpisodeResult | null> {
    const { tabUrl, mapKey } = input

    // Pass if no tab URL is available
    if (!tabUrl) {
      return null
    }

    // Check if the URL matches a known media server pattern
    const urlMatch = this.mediaServerApi.extractFromUrl(tabUrl)
    if (!urlMatch) {
      return null
    }

    this.logger.debug(
      `Detected ${urlMatch.type} URL, item ID: ${urlMatch.itemId}`
    )

    // Find a configured media server for this URL
    const config = this.mediaServerApi.findConfig(
      urlMatch.type,
      urlMatch.baseUrl
    )
    if (!config) {
      this.logger.debug(
        `No ${urlMatch.type} config found for ${urlMatch.baseUrl}, passing`
      )
      return null
    }

    // Fetch metadata from the media server
    const metadata = await this.mediaServerApi.getMetadata(
      config,
      urlMatch.itemId
    )
    if (!metadata) {
      this.logger.debug('Failed to fetch metadata from media server, passing')
      return null
    }

    this.logger.debug('Got media server metadata', metadata)

    // Use the title from the media server to search danmaku providers
    const searchTitle = metadata.originalTitle ?? metadata.title
    const episodeNumber = metadata.episode ?? input.episodeNumber

    const autoProviders =
      await this.providerConfigService.getAutomaticProviders()

    if (autoProviders.length === 0) {
      return null
    }

    // Search across all providers using the media server's title
    const searchResults = await Promise.allSettled(
      autoProviders.map(async (autoProvider) => {
        const service = this.danmakuProviderFactory(autoProvider)
        this.logger.debug(
          `Searching with provider ${autoProvider.name}: ${searchTitle}`
        )
        const foundSeasonInserts = await service.search({
          keyword: searchTitle,
        })
        const foundSeasons =
          await this.seasonService.bulkUpsert(foundSeasonInserts)
        return { autoProvider, foundSeasons }
      })
    )

    // Collect and deduplicate results
    const allSeasons: Season[] = []
    const seenIndexedIds = new Set<string>()
    const seenSeasonIds = new Set<number>()
    let firstSuccessfulProvider = autoProviders[0]

    for (let i = 0; i < searchResults.length; i++) {
      const result = searchResults[i]
      if (result.status === 'rejected') {
        this.logger.warn(
          `Provider ${autoProviders[i].name ?? autoProviders[i].id} search failed`,
          result.reason
        )
        continue
      }

      const { autoProvider, foundSeasons } = result.value
      if (foundSeasons.length === 0) continue

      if (!firstSuccessfulProvider) {
        firstSuccessfulProvider = autoProvider
      }

      for (const season of foundSeasons) {
        const isDuplicate =
          (season.indexedId && seenIndexedIds.has(season.indexedId)) ||
          (season.id !== undefined && seenSeasonIds.has(season.id))
        if (!isDuplicate) {
          if (season.indexedId) seenIndexedIds.add(season.indexedId)
          if (season.id !== undefined) seenSeasonIds.add(season.id)
          allSeasons.push(season as Season)
        }
      }
    }

    if (allSeasons.length === 0) {
      // No seasons found from media server metadata — pass to next strategy
      // (SearchMatchingStrategy will try the original title)
      this.logger.debug(
        'No seasons found using media server title, passing to next strategy'
      )
      return null
    }

    // Try to find the best match
    let bestSeason: Season | null = null

    if (allSeasons.length === 1) {
      bestSeason = allSeasons[0]
      this.logger.debug(
        'Single season found from media server metadata, auto-mapping',
        bestSeason
      )
    } else {
      bestSeason = findBestMatchingSeason(allSeasons, searchTitle, undefined)
      if (bestSeason) {
        this.logger.debug(
          'Best title match selected from media server results',
          bestSeason
        )
      }
    }

    if (bestSeason) {
      await this.titleMappingService.add(
        SeasonMap.fromSeason(mapKey, bestSeason)
      )

      if (episodeNumber === undefined) {
        return {
          status: 'notFound',
          data: null,
          cause: 'matching.episodeNumberUndefined',
        }
      }

      try {
        const data = await this.episodeResolver.resolveEpisode(
          bestSeason,
          episodeNumber
        )
        return {
          status: 'success',
          data,
          metadata: {
            strategy: 'mediaServer',
            providerConfig: firstSuccessfulProvider,
          },
        }
      } catch (e) {
        return {
          status: 'notFound',
          data: null,
          cause: serializeError(e).message,
        }
      }
    }

    // Multiple results, let user disambiguate
    return {
      status: 'disambiguation',
      data: allSeasons,
      metadata: {
        strategy: 'mediaServer',
        providerConfig: firstSuccessfulProvider,
      },
    }
  }
}

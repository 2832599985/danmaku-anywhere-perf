import type { Season } from '@danmaku-anywhere/danmaku-converter'
import { inject, injectable } from 'inversify'
import { SeasonService } from '@/background/services/persistence/SeasonService'
import { TitleMappingService } from '@/background/services/persistence/TitleMappingService'
import type { MatchEpisodeInput, MatchEpisodeResult } from '@/common/anime/dto'
import { type ILogger, LoggerSymbol } from '@/common/Logger'
import type { ProviderConfig } from '@/common/options/providerConfig/schema'
import { ProviderConfigService } from '@/common/options/providerConfig/service'
import { SeasonMap } from '@/common/seasonMap/SeasonMap'
import { serializeError } from '@/common/utils/serializeError'
import {
  DanmakuProviderFactory,
  type IDanmakuProviderFactory,
} from '../../providers/ProviderFactory'
import { EpisodeResolutionService } from '../EpisodeResolutionService'
import type { IMatchingStrategy } from './IMatchingStrategy'
import { extractSeasonHint, findBestMatchingSeason } from './titleMatch'

@injectable()
export class SearchMatchingStrategy implements IMatchingStrategy {
  readonly name = 'search'

  private logger: ILogger

  constructor(
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
    this.logger = logger.sub('SearchStrategy')
  }

  async match(input: MatchEpisodeInput): Promise<MatchEpisodeResult | null> {
    const { title, mapKey, episodeNumber } = input

    const autoProviders =
      await this.providerConfigService.getAutomaticProviders()

    if (autoProviders.length === 0) {
      return null
    }

    // Extract season hint from title for season-aware matching
    const seasonHint = extractSeasonHint(title)

    // Parallel search across all providers
    const searchResults = await Promise.allSettled(
      autoProviders.map(async (autoProvider) => {
        const service = this.danmakuProviderFactory(autoProvider)
        this.logger.debug(
          `Searching for season with provider ${autoProvider.name}: ${title}`
        )
        const foundSeasonInserts = await service.search({ keyword: title })
        const foundSeasons =
          await this.seasonService.bulkUpsert(foundSeasonInserts)
        return { autoProvider, foundSeasons }
      })
    )

    // Merge and deduplicate results across all providers
    const allSeasons: Season[] = []
    const seenIndexedIds = new Set<string>()
    const seenSeasonIds = new Set<number>()
    let firstSuccessfulProvider: ProviderConfig | undefined

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

      if (foundSeasons.length === 0) {
        this.logger.debug(`No seasons found with provider ${autoProvider.name}`)
        continue
      }

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
      return {
        status: 'notFound',
        data: null,
        cause: 'matching.noSeasonsAllProviders',
      }
    }

    // Try to find a single best match
    let bestSeason: Season | null = null

    if (allSeasons.length === 1) {
      bestSeason = allSeasons[0]
      this.logger.debug('Single season found, auto-mapping', bestSeason)
    } else {
      bestSeason = findBestMatchingSeason(allSeasons, title, seasonHint)
      if (bestSeason) {
        this.logger.debug(
          'Multiple seasons found, best title match selected',
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
            strategy: 'search',
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

    // No best match found, return disambiguation for user selection
    return {
      status: 'disambiguation',
      data: allSeasons,
      metadata: {
        strategy: 'search',
        providerConfig: firstSuccessfulProvider,
      },
    }
  }
}

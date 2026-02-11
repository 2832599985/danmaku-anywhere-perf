import type { Season } from '@danmaku-anywhere/danmaku-converter'
import { inject, injectable } from 'inversify'
import { SeasonService } from '@/background/services/persistence/SeasonService'
import { TitleMappingService } from '@/background/services/persistence/TitleMappingService'
import type { MatchEpisodeInput, MatchEpisodeResult } from '@/common/anime/dto'
import { type ILogger, LoggerSymbol } from '@/common/Logger'
import { ProviderConfigService } from '@/common/options/providerConfig/service'
import { SeasonMap } from '@/common/seasonMap/SeasonMap'
import { serializeError } from '@/common/utils/serializeError'
import {
  DanmakuProviderFactory,
  type IDanmakuProviderFactory,
} from '../../providers/ProviderFactory'
import { EpisodeResolutionService } from '../EpisodeResolutionService'
import type { IMatchingStrategy } from './IMatchingStrategy'
import { findBestMatchingSeason } from './titleMatch'

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

    for (const autoProvider of autoProviders) {
      try {
        const service = this.danmakuProviderFactory(autoProvider)

        this.logger.debug(
          `Searching for season with provider ${autoProvider.name ?? autoProvider.id}: ${title}`
        )
        const foundSeasonInserts = await service.search({
          keyword: title,
        })

        const foundSeasons =
          await this.seasonService.bulkUpsert(foundSeasonInserts)

        if (foundSeasons.length === 0) {
          this.logger.debug(
            `No seasons found with provider ${autoProvider.name ?? autoProvider.id}`
          )
          continue
        }

        // Try to find a single best match: either only one result, or best title match
        let bestSeason: Season | null = null

        if (foundSeasons.length === 1) {
          bestSeason = foundSeasons[0] as Season
          this.logger.debug('Single season found, auto-mapping', bestSeason)
        } else {
          bestSeason = findBestMatchingSeason(foundSeasons, title)
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
              cause: 'Episode number is undefined',
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
              metadata: { strategy: 'search', providerConfig: autoProvider },
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
          data: foundSeasons,
          metadata: { strategy: 'search', providerConfig: autoProvider },
        }
      } catch (e) {
        this.logger.warn(
          `Provider ${autoProvider.name ?? autoProvider.id} search failed, trying next`,
          e
        )
        continue
      }
    }

    return {
      status: 'notFound',
      data: null,
      cause: 'No seasons found across all providers',
    }
  }
}

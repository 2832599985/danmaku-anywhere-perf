import type { Season } from '@danmaku-anywhere/danmaku-converter'
import { inject, injectable } from 'inversify'
import { SeasonService } from '@/background/services/persistence/SeasonService'
import { TitleMappingService } from '@/background/services/persistence/TitleMappingService'
import type { MatchEpisodeInput, MatchEpisodeResult } from '@/common/anime/dto'
import { type ILogger, LoggerSymbol } from '@/common/Logger'
import type { ProviderConfig } from '@/common/options/providerConfig/schema'
import { ProviderConfigService } from '@/common/options/providerConfig/service'
import { SeasonMap } from '@/common/seasonMap/SeasonMap'
import { EpisodeResolutionService } from '../EpisodeResolutionService'
import type { IMatchingStrategy } from './IMatchingStrategy'

@injectable()
export class MappingMatchingStrategy implements IMatchingStrategy {
  readonly name = 'mapping'
  private logger: ILogger

  constructor(
    @inject(TitleMappingService)
    private titleMappingService: TitleMappingService,
    @inject(SeasonService) private seasonService: SeasonService,
    @inject(ProviderConfigService)
    private providerConfigService: ProviderConfigService,
    @inject(EpisodeResolutionService)
    private episodeResolver: EpisodeResolutionService,
    @inject(LoggerSymbol) logger: ILogger
  ) {
    this.logger = logger.sub('[MappingMatchingStrategy]')
  }

  async match(input: MatchEpisodeInput): Promise<MatchEpisodeResult | null> {
    const { mapKey, seasonId, episodeNumber } = input
    const resolution = await this.resolveSeason(mapKey, seasonId)

    if (!resolution) {
      return null
    }

    const { season, providerConfig } = resolution

    // Save mapping if we found it via ID but it wasn't mapped yet
    if (seasonId) {
      await this.titleMappingService.add(SeasonMap.fromSeason(mapKey, season))
    }

    if (episodeNumber === undefined) {
      // Cannot resolve episode without a number, pass to next strategy
      this.logger.debug('Episode number is undefined, passing to next strategy')
      return null
    }

    try {
      const data = await this.episodeResolver.resolveEpisode(
        season,
        episodeNumber
      )
      return {
        status: 'success',
        data,
        metadata: { strategy: 'mapping', providerConfig },
      }
    } catch (e) {
      // Episode resolution failed — pass to next strategy rather than terminating
      this.logger.debug(
        'Episode resolution failed, passing to next strategy',
        e
      )
      return null
    }
  }

  private async resolveSeason(
    mapKey: string,
    seasonId?: number
  ): Promise<{ season: Season; providerConfig?: ProviderConfig } | undefined> {
    if (seasonId) {
      const season = await this.seasonService.getById(seasonId)
      if (!season) {
        return undefined
      }
      const providerConfig = await this.providerConfigService.get(
        season.providerConfigId
      )
      return { season, providerConfig: providerConfig ?? undefined }
    }

    const mapping = await this.titleMappingService.get(mapKey)

    if (mapping) {
      const autoProviders =
        await this.providerConfigService.getAutomaticProviders()

      // go through all automatic providers and try to find one with a mapped season id
      for (const autoProvider of autoProviders) {
        if (!autoProvider.enabled) {
          continue
        }
        this.logger.debug('Checking provider', autoProvider)
        const mappedId = mapping.getSeasonId(autoProvider.id)
        if (mappedId) {
          this.logger.debug('Found mapped season id', mappedId)
          const season = await this.seasonService.getById(mappedId)
          if (season) {
            return { season, providerConfig: autoProvider }
          }
        }
      }
    }
  }
}

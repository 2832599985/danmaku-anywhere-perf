import type {
  CommentEntity,
  EpisodeMeta,
  Season,
  WithSeason,
} from '@danmaku-anywhere/danmaku-converter'
import { inject, injectable } from 'inversify'
import { SeasonService } from '@/background/services/persistence/SeasonService'
import type { DanmakuSourceType } from '@/common/danmaku/enums'
import { type ILogger, LoggerSymbol } from '@/common/Logger'
import { ProviderConfigService } from '@/common/options/providerConfig/service'
import {
  DanmakuProviderFactory,
  type IDanmakuProviderFactory,
} from './providers/ProviderFactory'

export interface MultiSourceFetchInput {
  /** The episode meta from the primary match */
  primaryMeta: WithSeason<EpisodeMeta>
  /** The provider config ID to exclude (already fetched) */
  excludeProviderConfigId: string
}

export interface MultiSourceFetchResult {
  /** Comments from additional providers, already deduplicated within each source */
  comments: CommentEntity[]
  /** Provider info for each source that contributed */
  sources: {
    provider: DanmakuSourceType
    providerConfigId: string
    commentCount: number
  }[]
  /** Providers that failed */
  failures: {
    provider: DanmakuSourceType
    providerConfigId: string
    error: string
  }[]
}

@injectable('Singleton')
export class DanmakuMergeService {
  private logger: ILogger

  constructor(
    @inject(ProviderConfigService)
    private providerConfigService: ProviderConfigService,
    @inject(DanmakuProviderFactory)
    private danmakuProviderFactory: IDanmakuProviderFactory,
    @inject(SeasonService)
    private seasonService: SeasonService,
    @inject(LoggerSymbol) logger: ILogger
  ) {
    this.logger = logger.sub('[DanmakuMergeService]')
  }

  /**
   * Fetch danmaku from all other enabled automatic providers for the same episode.
   * Uses Promise.allSettled so partial failures don't block other sources.
   */
  async fetchFromOtherProviders(
    input: MultiSourceFetchInput
  ): Promise<MultiSourceFetchResult> {
    const { primaryMeta, excludeProviderConfigId } = input
    const title = primaryMeta.season.title
    const rawEpisodeNumber = primaryMeta.episodeNumber

    if (rawEpisodeNumber === undefined) {
      this.logger.debug(
        'Episode number is undefined, cannot search other providers'
      )
      return { comments: [], sources: [], failures: [] }
    }

    const episodeNumber =
      typeof rawEpisodeNumber === 'string'
        ? Number.parseInt(rawEpisodeNumber, 10)
        : rawEpisodeNumber

    if (Number.isNaN(episodeNumber)) {
      this.logger.debug(
        `Episode number "${rawEpisodeNumber}" is not a valid number`
      )
      return { comments: [], sources: [], failures: [] }
    }

    // Get all automatic providers except the one already used
    const allAutoProviders =
      await this.providerConfigService.getAutomaticProviders()
    const otherProviders = allAutoProviders.filter(
      (p) => p.id !== excludeProviderConfigId && p.enabled
    )

    if (otherProviders.length === 0) {
      this.logger.debug('No other providers available for multi-source fetch')
      return { comments: [], sources: [], failures: [] }
    }

    this.logger.debug(
      `Searching ${otherProviders.length} other providers for: ${title} ep${episodeNumber}`
    )

    // Search and resolve episode from each other provider
    const results = await Promise.allSettled(
      otherProviders.map(async (providerConfig) => {
        const service = this.danmakuProviderFactory(providerConfig)

        // Search for the season
        this.logger.debug(
          `Searching provider ${providerConfig.name} for: ${title}`
        )
        const seasonInserts = await service.search({ keyword: title })
        const foundSeasons = await this.seasonService.bulkUpsert(seasonInserts)

        if (foundSeasons.length === 0) {
          this.logger.debug(
            `No seasons found in provider ${providerConfig.name}`
          )
          return null
        }

        // Try to find best matching season (exact title match preferred)
        let bestSeason: Season | undefined
        for (const season of foundSeasons) {
          if (season.title === title) {
            bestSeason = season as Season
            break
          }
        }
        if (!bestSeason) {
          // Fallback: take the first result
          bestSeason = foundSeasons[0] as Season
        }

        // Resolve the specific episode
        if (!service.findEpisode) {
          this.logger.debug(
            `Provider ${providerConfig.name} does not support episode matching`
          )
          return null
        }

        const episodeMeta = await service.findEpisode(bestSeason, episodeNumber)
        if (!episodeMeta) {
          this.logger.debug(
            `Episode ${episodeNumber} not found in provider ${providerConfig.name}`
          )
          return null
        }

        // Fetch the comments
        const comments = await service.getDanmaku({
          type: 'by-meta',
          meta: episodeMeta,
        })

        return {
          provider: providerConfig.impl,
          providerConfigId: providerConfig.id,
          comments,
        }
      })
    )

    const allComments: CommentEntity[] = []
    const sources: MultiSourceFetchResult['sources'] = []
    const failures: MultiSourceFetchResult['failures'] = []

    for (let i = 0; i < results.length; i++) {
      const result = results[i]
      const providerConfig = otherProviders[i]

      if (result.status === 'rejected') {
        this.logger.warn(
          `Provider ${providerConfig.name} failed:`,
          result.reason
        )
        failures.push({
          provider: providerConfig.impl,
          providerConfigId: providerConfig.id,
          error:
            result.reason instanceof Error
              ? result.reason.message
              : String(result.reason),
        })
        continue
      }

      const value = result.value
      if (!value || value.comments.length === 0) {
        continue
      }

      allComments.push(...value.comments)
      sources.push({
        provider: value.provider,
        providerConfigId: value.providerConfigId,
        commentCount: value.comments.length,
      })
    }

    this.logger.debug(
      `Multi-source fetch complete: ${sources.length} sources, ${allComments.length} comments, ${failures.length} failures`
    )

    return { comments: allComments, sources, failures }
  }
}

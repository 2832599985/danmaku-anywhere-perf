import { inject, injectable } from 'inversify'
import type {
  MatchEpisodeInput,
  MatchEpisodeResult,
  StrategyAttempt,
} from '@/common/anime/dto'
import { type ILogger, LoggerSymbol } from '@/common/Logger'
import type { IMatchingStrategy } from './strategies/IMatchingStrategy'
import { LocalMatchingStrategy } from './strategies/LocalMatchingStrategy'
import { MappingMatchingStrategy } from './strategies/MappingMatchingStrategy'
import { SearchMatchingStrategy } from './strategies/SearchMatchingStrategy'

@injectable('Singleton')
export class EpisodeMatchingService {
  private logger: ILogger
  private strategies: IMatchingStrategy[]

  constructor(
    @inject(LocalMatchingStrategy) localStrategy: LocalMatchingStrategy,
    @inject(MappingMatchingStrategy) mappingStrategy: MappingMatchingStrategy,
    @inject(SearchMatchingStrategy) searchStrategy: SearchMatchingStrategy,
    @inject(LoggerSymbol) logger: ILogger
  ) {
    this.strategies = [localStrategy, mappingStrategy, searchStrategy]
    this.logger = logger.sub('EpisodeMatchingService')
  }

  async findMatchingEpisodes(
    input: MatchEpisodeInput
  ): Promise<MatchEpisodeResult> {
    const attempts: StrategyAttempt[] = []

    for (const strategy of this.strategies) {
      this.logger.debug(`Matching using strategy ${strategy.name}`, input)
      const result = await strategy.match(input)

      if (result) {
        this.logger.debug(
          `Strategy ${strategy.name} returned result`,
          result.status
        )

        if (result.status === 'notFound') {
          attempts.push({
            strategy: strategy.name,
            tried: true,
            skipped: false,
            reason: result.cause,
          })
          // notFound from a strategy that handled the request is a terminal result
          // Add remaining strategies as not tried
          const currentIndex = this.strategies.indexOf(strategy)
          for (let i = currentIndex + 1; i < this.strategies.length; i++) {
            attempts.push({
              strategy: this.strategies[i].name,
              tried: false,
              skipped: true,
              reason: 'matching.previousStrategyTerminal',
            })
          }
          return {
            ...result,
            strategyAttempts: attempts,
          }
        }

        return result
      }

      // Strategy returned null, meaning it passed
      attempts.push({
        strategy: strategy.name,
        tried: true,
        skipped: false,
        reason: 'matching.passedToNext',
      })
    }

    return {
      status: 'notFound',
      data: null,
      cause: 'matching.allStrategiesExhausted',
      strategyAttempts: attempts,
    }
  }
}

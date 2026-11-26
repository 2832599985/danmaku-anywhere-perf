import { describe, expect, it, vi } from 'vitest'
import { DanmakuSourceType } from '@/common/danmaku/enums'
import { DanmakuMergeService } from './DanmakuMergeService'

describe('DanmakuMergeService', () => {
  it('uses season-aware matching instead of blindly falling back to foundSeasons[0]', async () => {
    const providerConfigService = {
      getAutomaticProviders: vi.fn().mockResolvedValue([
        {
          id: 'primary',
          name: 'Primary',
          impl: DanmakuSourceType.DanDanPlay,
          enabled: true,
        },
        {
          id: 'bili',
          name: 'Bilibili',
          impl: DanmakuSourceType.Bilibili,
          enabled: true,
        },
      ]),
    }

    const s1 = {
      id: 101,
      title: '咒术回战',
      provider: DanmakuSourceType.Bilibili,
    }
    const s2 = {
      id: 102,
      title: '咒术回战 怀玉·玉折 / 涩谷事变 第二季',
      provider: DanmakuSourceType.Bilibili,
    }

    const findEpisode = vi
      .fn()
      .mockImplementation(async (season: { id: number }, ep: number) => ({
        seasonId: season.id,
        episodeNumber: ep,
      }))
    const getDanmaku = vi
      .fn()
      .mockResolvedValue([{ cid: 1, p: '12,1,16777215', m: 'S2 comment' }])

    const factory = vi.fn().mockReturnValue({
      search: vi.fn().mockResolvedValue([s1, s2]),
      findEpisode,
      getDanmaku,
    })

    const seasonService = {
      bulkUpsert: vi.fn().mockImplementation(async (items: unknown[]) => items),
    }

    const logger = {
      sub: () => ({
        debug: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        info: vi.fn(),
      }),
    }

    const service = new DanmakuMergeService(
      providerConfigService as never,
      factory as never,
      seasonService as never,
      logger as never
    )

    const result = await service.fetchFromOtherProviders({
      primaryMeta: {
        episodeNumber: 5,
        season: {
          id: 1,
          title: '咒术回战 第二季',
        },
      } as never,
      excludeProviderConfigId: 'primary',
    })

    expect(findEpisode).toHaveBeenCalledTimes(1)
    expect(findEpisode.mock.calls[0][0].id).toBe(102)
    expect(result.comments).toHaveLength(1)
  })
})

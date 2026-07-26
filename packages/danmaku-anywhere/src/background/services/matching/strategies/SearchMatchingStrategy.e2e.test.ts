/**
 * End-to-end simulation of MacCMS auto-matching flow.
 *
 * Tests the REAL code path:
 *   SearchMatchingStrategy.match()
 *     → danmakuProviderFactory(config)  → instance #1 → search() → fills episodeCache
 *     → episodeResolver.resolveEpisode()
 *       → danmakuProviderFactory(config)  → instance #2 → findEpisode()
 *         → getEpisodesByIndexedId() → cache HIT (the cache is module scoped,
 *           so it survives the factory building a second instance)
 *
 * The re-search-by-title recovery still exists for the case the cache really is
 * empty — a service worker restart — and is covered separately below by
 * clearing the cache explicitly.
 *
 * We use REAL MacCmsProviderService instances (no mock) but mock the network layer
 * (searchMacCmsVod) so no actual HTTP calls are made.
 */

import type {
  EpisodeMeta,
  SeasonInsert,
  WithSeason,
} from '@danmaku-anywhere/danmaku-converter'
import { DanmakuSourceType } from '@danmaku-anywhere/danmaku-converter'
import type { MacCmsParsedPlayUrl } from '@danmaku-anywhere/danmaku-provider/maccms'
import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest'
import type { SeasonService } from '@/background/services/persistence/SeasonService'
import type { TitleMappingService } from '@/background/services/persistence/TitleMappingService'
import {
  clearMacCmsEpisodeCache,
  MacCmsProviderService,
} from '@/background/services/providers/MacCmsProviderService'
import type { IDanmakuProviderFactory } from '@/background/services/providers/ProviderFactory'
import type { ProviderConfigService } from '@/common/options/providerConfig/service'
import { EpisodeResolutionService } from '../EpisodeResolutionService'
import { SearchMatchingStrategy } from './SearchMatchingStrategy'

// ─── Mock network layer ──────────────────────────────────────────────────────

vi.mock('@danmaku-anywhere/danmaku-provider/maccms', () => ({
  searchMacCmsVod: vi.fn(),
  fetchDanmuIcuComments: vi.fn(),
}))

vi.mock('@/common/utils/utils', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>
  return {
    ...actual,
    isServiceWorker: () => true,
  }
})

import { searchMacCmsVod } from '@danmaku-anywhere/danmaku-provider/maccms'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function createMockLogger() {
  const logger: any = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    log: vi.fn(),
    sub: vi.fn(() => logger),
  }
  return logger
}

const macCmsConfig = {
  id: 'maccms-provider-1',
  name: 'Test MacCMS',
  impl: DanmakuSourceType.MacCMS,
  type: 'MacCMS' as const,
  isBuiltIn: false,
  enabled: true,
  options: {
    danmakuBaseUrl: 'https://example.com/api',
    danmuicuBaseUrl: 'https://danmuicu.example.com',
    stripColor: false,
  },
}

/** Simulate what searchMacCmsVod returns for "凡人修仙传" */
function makeMacCmsApiResponse() {
  return {
    success: true,
    data: {
      code: 1,
      msg: 'ok',
      page: 1,
      pagecount: 1,
      limit: 20,
      total: 3,
      list: [
        {
          vod_id: 8001,
          vod_name: '凡人修仙传',
          vod_pic: 'https://example.com/fanren.jpg',
          vod_year: '2020',
          vod_area: null,
          vod_class: null,
          vod_play_from: 'hnm3u8$$$ikm3u8',
          vod_play_url:
            '第01集$https://play.example.com/fanren/01.m3u8#第02集$https://play.example.com/fanren/02.m3u8#第03集$https://play.example.com/fanren/03.m3u8$$$第01集$https://play2.example.com/fanren/01.m3u8#第02集$https://play2.example.com/fanren/02.m3u8',
          parsedPlayUrls: [
            {
              source: 'hnm3u8',
              seasonTitle: '凡人修仙传',
              originalTitle: '第01集',
              title: '凡人修仙传 - hnm3u8 - 第01集',
              url: 'https://play.example.com/fanren/01.m3u8',
            },
            {
              source: 'hnm3u8',
              seasonTitle: '凡人修仙传',
              originalTitle: '第02集',
              title: '凡人修仙传 - hnm3u8 - 第02集',
              url: 'https://play.example.com/fanren/02.m3u8',
            },
            {
              source: 'hnm3u8',
              seasonTitle: '凡人修仙传',
              originalTitle: '第03集',
              title: '凡人修仙传 - hnm3u8 - 第03集',
              url: 'https://play.example.com/fanren/03.m3u8',
            },
            {
              source: 'ikm3u8',
              seasonTitle: '凡人修仙传',
              originalTitle: '第01集',
              title: '凡人修仙传 - ikm3u8 - 第01集',
              url: 'https://play2.example.com/fanren/01.m3u8',
            },
            {
              source: 'ikm3u8',
              seasonTitle: '凡人修仙传',
              originalTitle: '第02集',
              title: '凡人修仙传 - ikm3u8 - 第02集',
              url: 'https://play2.example.com/fanren/02.m3u8',
            },
          ] as MacCmsParsedPlayUrl[],
        },
        {
          vod_id: 8002,
          vod_name: '凡人修仙传 第二季',
          vod_pic: 'https://example.com/fanren2.jpg',
          vod_year: '2023',
          vod_area: null,
          vod_class: null,
          vod_play_from: 'hnm3u8',
          vod_play_url:
            '第01集$https://play.example.com/fanren2/01.m3u8#第02集$https://play.example.com/fanren2/02.m3u8',
          parsedPlayUrls: [
            {
              source: 'hnm3u8',
              seasonTitle: '凡人修仙传 第二季',
              originalTitle: '第01集',
              title: '凡人修仙传 第二季 - hnm3u8 - 第01集',
              url: 'https://play.example.com/fanren2/01.m3u8',
            },
            {
              source: 'hnm3u8',
              seasonTitle: '凡人修仙传 第二季',
              originalTitle: '第02集',
              title: '凡人修仙传 第二季 - hnm3u8 - 第02集',
              url: 'https://play.example.com/fanren2/02.m3u8',
            },
          ] as MacCmsParsedPlayUrl[],
        },
        {
          vod_id: 8003,
          vod_name: '凡人修仙传之仙界篇',
          vod_pic: 'https://example.com/fanren-xianjie.jpg',
          vod_year: '2025',
          vod_area: null,
          vod_class: null,
          vod_play_from: 'hnm3u8',
          vod_play_url:
            '第01集$https://play.example.com/fanren-xianjie/01.m3u8',
          parsedPlayUrls: [
            {
              source: 'hnm3u8',
              seasonTitle: '凡人修仙传之仙界篇',
              originalTitle: '第01集',
              title: '凡人修仙传之仙界篇 - hnm3u8 - 第01集',
              url: 'https://play.example.com/fanren-xianjie/01.m3u8',
            },
          ] as MacCmsParsedPlayUrl[],
        },
      ],
    },
  }
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('MacCMS end-to-end: 凡人修仙传 full auto-match flow', () => {
  let strategy: SearchMatchingStrategy
  let mockProviderConfigService: any
  let mockSeasonService: any
  let mockTitleMappingService: any
  let instanceCounter: number

  beforeEach(() => {
    vi.clearAllMocks()

    // the episode cache is module scoped, so it would otherwise leak between tests
    clearMacCmsEpisodeCache()

    instanceCounter = 0

    // Each call to searchMacCmsVod returns the same API response
    ;(searchMacCmsVod as Mock).mockResolvedValue(makeMacCmsApiResponse())

    const logger = createMockLogger()

    // ── REAL ProviderFactory behavior: each call creates a NEW MacCmsProviderService ──
    const realFactory = ((config: any) => {
      instanceCounter++
      return new MacCmsProviderService(config, logger)
    }) as unknown as IDanmakuProviderFactory
    realFactory.getTyped = realFactory as any

    // ── ProviderConfigService mock ──
    mockProviderConfigService = {
      getAutomaticProviders: vi.fn().mockResolvedValue([macCmsConfig]),
      mustGet: vi.fn().mockResolvedValue(macCmsConfig),
    } as unknown as ProviderConfigService

    // ── SeasonService mock: simulate DB upsert (adds id/version/timeUpdated) ──
    mockSeasonService = {
      bulkUpsert: vi.fn(async (inserts: SeasonInsert[]) => {
        return inserts.map((insert, i) => ({
          ...insert,
          id: 100 + i,
          version: 1,
          timeUpdated: Date.now(),
        }))
      }),
    } as unknown as SeasonService

    // ── TitleMappingService mock ──
    mockTitleMappingService = {
      add: vi.fn(),
      get: vi.fn(),
    } as unknown as TitleMappingService

    // ── REAL EpisodeResolutionService with the same factory ──
    const episodeResolver = new EpisodeResolutionService(
      mockProviderConfigService,
      realFactory
    )

    // ── Strategy under test ──
    strategy = new SearchMatchingStrategy(
      mockProviderConfigService,
      realFactory,
      mockSeasonService,
      mockTitleMappingService,
      episodeResolver,
      logger
    )
  })

  it('should auto-match "凡人修仙传" episode 2 with TWO separate MacCmsProviderService instances', async () => {
    const result = await strategy.match({
      mapKey: 'example.com::凡人修仙传',
      title: '凡人修仙传',
      episodeNumber: 2,
    })

    // ProviderFactory was called TWICE: once in SearchMatchingStrategy, once in EpisodeResolutionService
    expect(instanceCounter).toBe(2)

    // searchMacCmsVod was called ONCE. The second instance reads the episode
    // cache filled by the first: the cache is module scoped precisely because
    // the factory hands out a fresh instance per call, so a per-instance cache
    // could never be read back and every resolution paid for a second search.
    expect(searchMacCmsVod).toHaveBeenCalledTimes(1)

    expect(result).not.toBeNull()
    expect(result?.status).toBe('success')

    if (result?.status === 'success') {
      const episode = result.data as WithSeason<EpisodeMeta>
      // Should have matched episode 2 of "凡人修仙传"
      expect(episode.episodeNumber).toBe(2)
      expect(episode.season.title).toBe('凡人修仙传')
      expect(episode.season.indexedId).toBe('custom:8001')
      // The URL should be the episode 2 URL
      expect(episode.providerIds).toEqual({
        url: 'https://play.example.com/fanren/02.m3u8',
      })
    }

    // Title mapping was created
    expect(mockTitleMappingService.add).toHaveBeenCalled()
  })

  it('should auto-match "凡人修仙传" episode 1 (first episode)', async () => {
    const result = await strategy.match({
      mapKey: 'example.com::凡人修仙传',
      title: '凡人修仙传',
      episodeNumber: 1,
    })

    expect(result?.status).toBe('success')
    if (result?.status === 'success') {
      const episode = result.data as WithSeason<EpisodeMeta>
      expect(episode.episodeNumber).toBe(1)
      expect(episode.providerIds).toEqual({
        url: 'https://play.example.com/fanren/01.m3u8',
      })
    }
  })

  it('should fail gracefully for non-existent episode 999', async () => {
    const result = await strategy.match({
      mapKey: 'example.com::凡人修仙传',
      title: '凡人修仙传',
      episodeNumber: 999,
    })

    // findEpisode returns null → EpisodeResolutionService throws → notFound
    expect(result?.status).toBe('notFound')
  })

  it('should auto-match "凡人修仙传 第二季" episode 1 from multi-result search', async () => {
    // The search returns 3 seasons, but title matching picks "凡人修仙传 第二季"
    const result = await strategy.match({
      mapKey: 'example.com::凡人修仙传 第二季',
      title: '凡人修仙传 第二季',
      episodeNumber: 1,
    })

    expect(result?.status).toBe('success')
    if (result?.status === 'success') {
      const episode = result.data as WithSeason<EpisodeMeta>
      expect(episode.season.title).toBe('凡人修仙传 第二季')
      expect(episode.season.indexedId).toBe('custom:8002')
      expect(episode.episodeNumber).toBe(1)
      expect(episode.providerIds).toEqual({
        url: 'https://play.example.com/fanren2/01.m3u8',
      })
    }
  })

  it('should auto-match "凡人修仙传之仙界篇" episode 1', async () => {
    const result = await strategy.match({
      mapKey: 'example.com::凡人修仙传之仙界篇',
      title: '凡人修仙传之仙界篇',
      episodeNumber: 1,
    })

    expect(result?.status).toBe('success')
    if (result?.status === 'success') {
      const episode = result.data as WithSeason<EpisodeMeta>
      expect(episode.season.title).toBe('凡人修仙传之仙界篇')
      expect(episode.season.indexedId).toBe('custom:8003')
      expect(episode.providerIds).toEqual({
        url: 'https://play.example.com/fanren-xianjie/01.m3u8',
      })
    }
  })

  it('searches once with the input title when the cache is warm', async () => {
    await strategy.match({
      mapKey: 'example.com::凡人修仙传',
      title: '凡人修仙传',
      episodeNumber: 1,
    })

    expect(searchMacCmsVod).toHaveBeenCalledTimes(1)
    expect(searchMacCmsVod).toHaveBeenNthCalledWith(
      1,
      'https://example.com/api',
      '凡人修仙传'
    )
  })

  it('re-searches by season.title when the cache was lost (worker restart)', async () => {
    const result = await strategy.match({
      mapKey: 'example.com::凡人修仙传',
      title: '凡人修仙传',
      episodeNumber: 1,
    })
    expect(result?.status).toBe('success')
    expect(searchMacCmsVod).toHaveBeenCalledTimes(1)

    // simulate the service worker being torn down: the cache is gone, but the
    // season row in the database survives
    clearMacCmsEpisodeCache()

    const season = (result as { data: WithSeason<EpisodeMeta> }).data.season
    const recovered = await new MacCmsProviderService(
      macCmsConfig as any,
      createMockLogger()
    ).findEpisode(season, 1)

    // the cache miss is recovered by re-searching with the season title
    expect(searchMacCmsVod).toHaveBeenCalledTimes(2)
    expect(searchMacCmsVod).toHaveBeenNthCalledWith(
      2,
      'https://example.com/api',
      '凡人修仙传'
    )
    expect(recovered?.providerIds).toEqual({
      url: 'https://play.example.com/fanren/01.m3u8',
    })
  })
})

import type { Season, SeasonInsert } from '@danmaku-anywhere/danmaku-converter'
import { DanmakuSourceType } from '@danmaku-anywhere/danmaku-converter'
import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest'
import type { SeasonService } from '@/background/services/persistence/SeasonService'
import type { TitleMappingService } from '@/background/services/persistence/TitleMappingService'
import type { IDanmakuProviderFactory } from '@/background/services/providers/ProviderFactory'
import type { EpisodeResolutionService } from '../EpisodeResolutionService'
import { SearchMatchingStrategy } from './SearchMatchingStrategy'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeSeason(
  overrides: Partial<Season> & { title: string; indexedId: string }
): Season {
  return {
    id: Math.floor(Math.random() * 10000),
    version: 1,
    timeUpdated: Date.now(),
    type: 'Custom',
    schemaVersion: 1 as const,
    provider: DanmakuSourceType.MacCMS,
    providerIds: {},
    providerConfigId: 'maccms-provider-1',
    ...overrides,
  } as Season
}

function makeSeasonInsert(title: string, vodId: number): SeasonInsert {
  return {
    indexedId: `custom:${vodId}`,
    title,
    type: 'Custom',
    schemaVersion: 1 as const,
    provider: DanmakuSourceType.MacCMS,
    providerIds: {},
    providerConfigId: 'maccms-provider-1',
  }
}

const macCmsProviderConfig = {
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

// ─── Mock factories ──────────────────────────────────────────────────────────

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

function createMockProviderConfigService(providers = [macCmsProviderConfig]) {
  return {
    getAutomaticProviders: vi.fn().mockResolvedValue(providers),
    mustGet: vi.fn().mockResolvedValue(macCmsProviderConfig),
  } as any
}

function createMockSeasonService() {
  return {
    bulkUpsert: vi.fn(async (inserts: SeasonInsert[]) => {
      // Simulate DB upsert: add id/version/timeUpdated
      return inserts.map((insert, i) => ({
        ...insert,
        id: 100 + i,
        version: 1,
        timeUpdated: Date.now(),
      }))
    }),
  } as unknown as SeasonService
}

function createMockTitleMappingService() {
  return {
    add: vi.fn(),
    get: vi.fn(),
  } as unknown as TitleMappingService
}

function createMockEpisodeResolver() {
  return {
    resolveEpisode: vi.fn(),
  } as unknown as EpisodeResolutionService
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('SearchMatchingStrategy - MacCMS integration simulation', () => {
  let strategy: SearchMatchingStrategy
  let mockProviderConfigService: ReturnType<
    typeof createMockProviderConfigService
  >
  let mockSeasonService: SeasonService
  let mockTitleMappingService: TitleMappingService
  let mockEpisodeResolver: EpisodeResolutionService
  let mockProviderFactory: IDanmakuProviderFactory & Mock
  let mockProviderService: any

  beforeEach(() => {
    mockProviderConfigService = createMockProviderConfigService()
    mockSeasonService = createMockSeasonService()
    mockTitleMappingService = createMockTitleMappingService()
    mockEpisodeResolver = createMockEpisodeResolver()

    mockProviderService = {
      forProvider: DanmakuSourceType.MacCMS,
      search: vi.fn(),
      getEpisodes: vi.fn(),
      findEpisode: vi.fn(),
    }

    mockProviderFactory = vi.fn(
      () => mockProviderService
    ) as unknown as IDanmakuProviderFactory & Mock
    mockProviderFactory.getTyped = vi.fn(() => mockProviderService) as any

    const logger = createMockLogger()

    // Manually construct strategy with injected mocks
    strategy = new SearchMatchingStrategy(
      mockProviderConfigService,
      mockProviderFactory,
      mockSeasonService,
      mockTitleMappingService,
      mockEpisodeResolver,
      logger
    )
  })

  // ── Scenario 1: MacCMS 搜索"进击的巨人" 返回多季 ──────────────────────────

  describe('Scenario: MacCMS returns multiple seasons for "进击的巨人"', () => {
    const searchInserts = [
      makeSeasonInsert('进击的巨人', 1001),
      makeSeasonInsert('进击的巨人 第二季', 1002),
      makeSeasonInsert('进击的巨人 第三季', 1003),
      makeSeasonInsert('进击的巨人 最终季', 1004),
    ]

    beforeEach(() => {
      mockProviderService.search.mockResolvedValue(searchInserts)
    })

    it('should auto-select exact title match instead of returning disambiguation', async () => {
      const mockEpisode = {
        provider: DanmakuSourceType.MacCMS,
        indexedId: 'http://example.com/play/1',
        title: '第01集',
        episodeNumber: 1,
        providerIds: { url: 'http://example.com/play/1' },
        schemaVersion: 4 as const,
        lastChecked: Date.now(),
        seasonId: 100,
        season: makeSeason({
          id: 100,
          title: '进击的巨人',
          indexedId: 'custom:1001',
        }),
      }
      ;(mockEpisodeResolver.resolveEpisode as Mock).mockResolvedValue(
        mockEpisode
      )

      const result = await strategy.match({
        mapKey: 'example.com::进击的巨人',
        title: '进击的巨人',
        episodeNumber: 1,
      })

      // BEFORE FIX: would return { status: 'disambiguation' }
      // AFTER FIX: should auto-select the exact match
      expect(result).not.toBeNull()
      expect(result?.status).toBe('success')
      expect(result?.status === 'success' && result?.data).toBeDefined()

      // Verify title mapping was created
      expect(mockTitleMappingService.add).toHaveBeenCalled()

      // Verify the correct season was selected (title === "进击的巨人", id === 100)
      expect(mockEpisodeResolver.resolveEpisode).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 100,
          title: '进击的巨人',
        }),
        1
      )
    })

    it('should return disambiguation when no title matches', async () => {
      // Search keyword doesn't match any season title
      const result = await strategy.match({
        mapKey: 'example.com::鬼灭之刃',
        title: '鬼灭之刃',
        episodeNumber: 1,
      })

      // "鬼灭之刃" doesn't match any of the 进击的巨人 seasons → disambiguation
      expect(result).not.toBeNull()
      expect(result?.status).toBe('disambiguation')
    })
  })

  // ── Scenario 2: 单结果场景（原有逻辑不变）──────────────────────────────────

  describe('Scenario: single result (original behavior preserved)', () => {
    it('should auto-map single result as before', async () => {
      const singleInsert = [makeSeasonInsert('鬼灭之刃', 2001)]
      mockProviderService.search.mockResolvedValue(singleInsert)

      const mockEpisode = {
        provider: DanmakuSourceType.MacCMS,
        indexedId: 'http://example.com/play/1',
        title: '第01集',
        episodeNumber: 1,
        providerIds: { url: 'http://example.com/play/1' },
        schemaVersion: 4 as const,
        lastChecked: Date.now(),
        seasonId: 100,
        season: makeSeason({
          id: 100,
          title: '鬼灭之刃',
          indexedId: 'custom:2001',
        }),
      }
      ;(mockEpisodeResolver.resolveEpisode as Mock).mockResolvedValue(
        mockEpisode
      )

      const result = await strategy.match({
        mapKey: 'example.com::鬼灭之刃',
        title: '鬼灭之刃',
        episodeNumber: 1,
      })

      expect(result?.status).toBe('success')
      expect(mockTitleMappingService.add).toHaveBeenCalled()
    })
  })

  // ── Scenario 3: 最短包含匹配（模糊匹配场景）──────────────────────────────

  describe('Scenario: best containing match when no exact match', () => {
    it('should select shortest title containing the keyword', async () => {
      // Search returns seasons but none exactly match the search keyword
      const searchInserts = [
        makeSeasonInsert('我独自升级 第二季', 3001),
        makeSeasonInsert('我独自升级 第二季 特别篇', 3002),
      ]
      mockProviderService.search.mockResolvedValue(searchInserts)

      const mockEpisode = {
        provider: DanmakuSourceType.MacCMS,
        indexedId: 'http://example.com/play/1',
        title: '第01集',
        episodeNumber: 1,
        providerIds: { url: 'http://example.com/play/1' },
        schemaVersion: 4 as const,
        lastChecked: Date.now(),
        seasonId: 100,
        season: makeSeason({
          id: 100,
          title: '我独自升级 第二季',
          indexedId: 'custom:3001',
        }),
      }
      ;(mockEpisodeResolver.resolveEpisode as Mock).mockResolvedValue(
        mockEpisode
      )

      const result = await strategy.match({
        mapKey: 'example.com::我独自升级',
        title: '我独自升级',
        episodeNumber: 1,
      })

      // Should pick "我独自升级 第二季" (shorter) over "我独自升级 第二季 特别篇"
      expect(result?.status).toBe('success')
      expect(mockEpisodeResolver.resolveEpisode).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 100,
          title: '我独自升级 第二季',
        }),
        1
      )
    })
  })

  // ── Scenario 4: episodeResolver 失败（缓存跨实例丢失） ─────────────────────

  describe('Scenario: episode resolution failure (cache miss)', () => {
    it('should return notFound when episodeResolver throws', async () => {
      const searchInserts = [makeSeasonInsert('间谍过家家', 4001)]
      mockProviderService.search.mockResolvedValue(searchInserts)

      // Simulate what happens when ProviderFactory creates a new instance
      // for EpisodeResolutionService — the new instance has no cached episodes
      ;(mockEpisodeResolver.resolveEpisode as Mock).mockRejectedValue(
        new Error('Episode 1 not found in season: 间谍过家家')
      )

      const result = await strategy.match({
        mapKey: 'example.com::间谍过家家',
        title: '间谍过家家',
        episodeNumber: 1,
      })

      // The title mapping is still created even when episode resolution fails
      expect(mockTitleMappingService.add).toHaveBeenCalled()
      expect(result?.status).toBe('notFound')
      if (result?.status === 'notFound') {
        expect(result?.cause).toContain('Episode 1 not found')
      }
    })
  })

  // ── Scenario 5: 无搜索结果 ────────────────────────────────────────────────

  describe('Scenario: no search results', () => {
    it('should continue to next provider or return notFound', async () => {
      mockProviderService.search.mockResolvedValue([])

      const result = await strategy.match({
        mapKey: 'example.com::不存在的动漫',
        title: '不存在的动漫',
        episodeNumber: 1,
      })

      expect(result?.status).toBe('notFound')
    })
  })

  // ── Scenario 6: episodeNumber undefined ────────────────────────────────────

  describe('Scenario: episodeNumber is undefined', () => {
    it('should create mapping but return notFound for missing episodeNumber', async () => {
      const searchInserts = [makeSeasonInsert('进击的巨人', 1001)]
      mockProviderService.search.mockResolvedValue(searchInserts)

      const result = await strategy.match({
        mapKey: 'example.com::进击的巨人',
        title: '进击的巨人',
        episodeNumber: undefined,
      })

      expect(mockTitleMappingService.add).toHaveBeenCalled()
      expect(result?.status).toBe('notFound')
      if (result?.status === 'notFound') {
        expect(result?.cause).toBe('matching.episodeNumberUndefined')
      }
    })
  })

  // ── Scenario 7: DanDanPlay 单结果行为不变 ─────────────────────────────────

  describe('Scenario: DanDanPlay single result (regression check)', () => {
    it('should behave identically for DDP single-result case', async () => {
      const ddpInsert: SeasonInsert = {
        indexedId: 'ddp:1234',
        title: '进击的巨人',
        type: 'TV',
        schemaVersion: 1 as const,
        provider: DanmakuSourceType.DanDanPlay,
        providerIds: { animeId: 1234, bangumiId: '5678' },
        providerConfigId: 'builtin:dandanplay',
      }

      const ddpConfig = {
        id: 'builtin:dandanplay',
        name: 'DanDanPlay',
        impl: DanmakuSourceType.DanDanPlay,
        type: 'DanDanPlay' as const,
        isBuiltIn: true,
        enabled: true,
        options: {},
      }

      mockProviderConfigService.getAutomaticProviders.mockResolvedValue([
        ddpConfig,
      ])
      mockProviderService.search.mockResolvedValue([ddpInsert])

      const mockEpisode = {
        provider: DanmakuSourceType.DanDanPlay,
        indexedId: 'ddp:1234:1',
        title: '第1话',
        episodeNumber: 1,
        providerIds: { episodeId: 1 },
        schemaVersion: 4 as const,
        lastChecked: Date.now(),
        seasonId: 100,
        season: makeSeason({
          id: 100,
          title: '进击的巨人',
          indexedId: 'ddp:1234',
          provider: DanmakuSourceType.DanDanPlay,
        }),
      }
      ;(mockEpisodeResolver.resolveEpisode as Mock).mockResolvedValue(
        mockEpisode
      )

      const result = await strategy.match({
        mapKey: 'example.com::进击的巨人',
        title: '进击的巨人',
        episodeNumber: 1,
      })

      expect(result?.status).toBe('success')
    })
  })

  // ── Scenario 8: 凡人修仙传 — 典型 MacCMS 多结果场景 ────────────────────

  describe('Scenario: "凡人修仙传" — typical MacCMS multi-season results', () => {
    // MacCMS 搜"凡人修仙传"的真实返回模拟：多季 + 衍生作品
    const searchInserts = [
      makeSeasonInsert('凡人修仙传', 6001),
      makeSeasonInsert('凡人修仙传 第二季', 6002),
      makeSeasonInsert('凡人修仙传 星海飞驰篇', 6003),
      makeSeasonInsert('凡人修仙传 新篇', 6004),
      makeSeasonInsert('凡人修仙传之仙界篇', 6005),
    ]

    beforeEach(() => {
      mockProviderService.search.mockResolvedValue(searchInserts)
    })

    it('should exact-match "凡人修仙传" from 5 results', async () => {
      const mockEpisode = {
        provider: DanmakuSourceType.MacCMS,
        indexedId: 'http://example.com/play/fanren/1',
        title: '第01集',
        episodeNumber: 1,
        providerIds: { url: 'http://example.com/play/fanren/1' },
        schemaVersion: 4 as const,
        lastChecked: Date.now(),
        seasonId: 100,
        season: makeSeason({
          id: 100,
          title: '凡人修仙传',
          indexedId: 'custom:6001',
        }),
      }
      ;(mockEpisodeResolver.resolveEpisode as Mock).mockResolvedValue(
        mockEpisode
      )

      const result = await strategy.match({
        mapKey: 'example.com::凡人修仙传',
        title: '凡人修仙传',
        episodeNumber: 1,
      })

      expect(result?.status).toBe('success')
      expect(mockEpisodeResolver.resolveEpisode).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 100,
          title: '凡人修仙传',
          indexedId: 'custom:6001',
        }),
        1
      )
    })

    it('should exact-match "凡人修仙传 第二季" when searching for season 2', async () => {
      const mockEpisode = {
        provider: DanmakuSourceType.MacCMS,
        indexedId: 'http://example.com/play/fanren2/1',
        title: '第01集',
        episodeNumber: 1,
        providerIds: { url: 'http://example.com/play/fanren2/1' },
        schemaVersion: 4 as const,
        lastChecked: Date.now(),
        seasonId: 101,
        season: makeSeason({
          id: 101,
          title: '凡人修仙传 第二季',
          indexedId: 'custom:6002',
        }),
      }
      ;(mockEpisodeResolver.resolveEpisode as Mock).mockResolvedValue(
        mockEpisode
      )

      const result = await strategy.match({
        mapKey: 'example.com::凡人修仙传 第二季',
        title: '凡人修仙传 第二季',
        episodeNumber: 1,
      })

      expect(result?.status).toBe('success')
      expect(mockEpisodeResolver.resolveEpisode).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 101,
          title: '凡人修仙传 第二季',
          indexedId: 'custom:6002',
        }),
        1
      )
    })

    it('should pick shortest containing title for partial keyword "凡人修仙"', async () => {
      const mockEpisode = {
        provider: DanmakuSourceType.MacCMS,
        indexedId: 'http://example.com/play/fanren/5',
        title: '第05集',
        episodeNumber: 5,
        providerIds: { url: 'http://example.com/play/fanren/5' },
        schemaVersion: 4 as const,
        lastChecked: Date.now(),
        seasonId: 100,
        season: makeSeason({
          id: 100,
          title: '凡人修仙传',
          indexedId: 'custom:6001',
        }),
      }
      ;(mockEpisodeResolver.resolveEpisode as Mock).mockResolvedValue(
        mockEpisode
      )

      const result = await strategy.match({
        mapKey: 'example.com::凡人修仙',
        title: '凡人修仙',
        episodeNumber: 5,
      })

      // "凡人修仙" is contained in all 5 results; "凡人修仙传" is the shortest → picked
      expect(result?.status).toBe('success')
      expect(mockEpisodeResolver.resolveEpisode).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 100,
          title: '凡人修仙传',
        }),
        5
      )
    })

    it('should select "凡人修仙传之仙界篇" for that specific keyword', async () => {
      const mockEpisode = {
        provider: DanmakuSourceType.MacCMS,
        indexedId: 'http://example.com/play/fanren-xianjie/3',
        title: '第03集',
        episodeNumber: 3,
        providerIds: { url: 'http://example.com/play/fanren-xianjie/3' },
        schemaVersion: 4 as const,
        lastChecked: Date.now(),
        seasonId: 104,
        season: makeSeason({
          id: 104,
          title: '凡人修仙传之仙界篇',
          indexedId: 'custom:6005',
        }),
      }
      ;(mockEpisodeResolver.resolveEpisode as Mock).mockResolvedValue(
        mockEpisode
      )

      const result = await strategy.match({
        mapKey: 'example.com::凡人修仙传之仙界篇',
        title: '凡人修仙传之仙界篇',
        episodeNumber: 3,
      })

      expect(result?.status).toBe('success')
      expect(mockEpisodeResolver.resolveEpisode).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 104,
          title: '凡人修仙传之仙界篇',
        }),
        3
      )
    })
  })

  // ── Scenario 9: 空格和标点差异的精确匹配 ──────────────────────────────────

  describe('Scenario: title matching with spacing/punctuation differences', () => {
    it('should match despite spacing differences', async () => {
      const searchInserts = [
        makeSeasonInsert('Re:Zero', 5001),
        makeSeasonInsert('Re:Zero 第二季', 5002),
      ]
      mockProviderService.search.mockResolvedValue(searchInserts)

      const mockEpisode = {
        provider: DanmakuSourceType.MacCMS,
        indexedId: 'http://example.com/play/1',
        title: '第01集',
        episodeNumber: 1,
        providerIds: { url: 'http://example.com/play/1' },
        schemaVersion: 4 as const,
        lastChecked: Date.now(),
        seasonId: 100,
        season: makeSeason({
          id: 100,
          title: 'Re:Zero',
          indexedId: 'custom:5001',
        }),
      }
      ;(mockEpisodeResolver.resolveEpisode as Mock).mockResolvedValue(
        mockEpisode
      )

      // Search with slightly different formatting
      const result = await strategy.match({
        mapKey: 'example.com::Re: Zero',
        title: 'Re: Zero',
        episodeNumber: 1,
      })

      // normalizeTitle removes punctuation and spaces, so "Re: Zero" → "rezero" matches "Re:Zero" → "rezero"
      expect(result?.status).toBe('success')
      expect(mockEpisodeResolver.resolveEpisode).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Re:Zero' }),
        1
      )
    })
  })
})

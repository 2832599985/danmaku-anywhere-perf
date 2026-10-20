import { describe, expect, it, vi } from 'vitest'
import {
  autoMatch,
  chooseSeason,
  cleanFilenameTitle,
  episodeFromFilename,
  keywordCandidates,
  REASON_BATCH,
  resolveEpisodeTarget,
  targetEpisode,
} from './autoMatch'
import type { SourceEpisode, SourceSeason } from './sources'

const season = (
  id: string,
  title: string,
  episodeCount = 12
): SourceSeason => ({
  source: 'ddp',
  id,
  title,
  type: 'tvseries',
  typeDescription: 'TV动画',
  imageUrl: '',
  year: 2024,
  episodeCount,
})

const episode = (
  episodeId: number,
  episodeNumber: number | string
): SourceEpisode => ({
  source: 'ddp',
  id: String(episodeId),
  seasonId: '1',
  episodeNumber,
  title: `第${episodeNumber}话`,
})

describe('episodeFromFilename', () => {
  it('reads fansub markers without mistaking metadata for the episode', () => {
    expect(
      episodeFromFilename(
        '[Sakurato] BLEACH 千年血战篇-诀别谭- [11][AVC AAC][1080p].mkv'
      )
    ).toBe(11)
    expect(
      episodeFromFilename(
        '【幻樱字幕组】[咒术回战 第二季][第11话][1920X1080].mp4'
      )
    ).toBe(11)
    expect(episodeFromFilename('Spy x Family S01E11 1080p WEB-DL.mkv')).toBe(11)
    expect(episodeFromFilename('葬送的芙莉莲 - 07 [WebRip 1080p].mkv')).toBe(7)
    expect(
      episodeFromFilename(
        '[LoliHouse] Futsutsuka na Akujo dewa Gozaimasu ga - 11 [WebRip 1080p HEVC-10bit AAC ASSx2].mkv'
      )
    ).toBe(11)
    // 1080 is a resolution here, not an episode.
    expect(episodeFromFilename('Show [1080p] [x264].mkv')).toBe(0)
  })

  it('understands Chinese numerals', () => {
    expect(episodeFromFilename('某番 第十一话 [1080p].mp4')).toBe(11)
  })
})

describe('cleanFilenameTitle', () => {
  it('strips release metadata and the episode marker', () => {
    expect(cleanFilenameTitle('葬送的芙莉莲 - 07 [WebRip 1080p].mp4')).toBe(
      '葬送的芙莉莲'
    )
    expect(cleanFilenameTitle('葬送的芙莉莲 第二季 - 11 [1080p].mp4')).toBe(
      '葬送的芙莉莲 第二季'
    )
  })

  it('unwraps brackets that hold the title, drops the ones that do not', () => {
    expect(
      cleanFilenameTitle(
        '【幻樱字幕组】★10月新番【咒术回战 第二季】【第11话】【1920X1080】.mp4'
      )
    ).toBe('咒术回战 第二季')
    expect(
      cleanFilenameTitle(
        '[Sakurato] BLEACH 千年血战篇-诀别谭- [11][AVC AAC][1080p].mkv'
      )
    ).toBe('BLEACH 千年血战篇-诀别谭')
    expect(
      cleanFilenameTitle(
        '[LoliHouse] Futsutsuka na Akujo dewa Gozaimasu ga - 11 [WebRip 1080p HEVC-10bit AAC ASSx2].mkv'
      )
    ).toBe('Futsutsuka na Akujo dewa Gozaimasu ga')
  })

  it('leaves an already-clean name alone', () => {
    expect(cleanFilenameTitle('葬送的芙莉莲.mp4')).toBe('葬送的芙莉莲')
    expect(cleanFilenameTitle('Spy x Family S01E11 1080p WEB-DL.mkv')).toBe(
      'Spy x Family S01'
    )
  })
})

describe('targetEpisode', () => {
  it('prefers the filename marker over the AI answer', () => {
    const ai = { title: 'x', episode: 3, altTitles: [] }
    expect(targetEpisode('某番 第11话.mp4', ai)).toBe(11)
  })

  it('falls back to the AI episode when the name has no marker', () => {
    const ai = { title: '葬送的芙莉莲', episode: 7, altTitles: [] }
    expect(targetEpisode('葬送的芙莉莲 - 07 [1080p].mkv', ai)).toBe(7)
  })

  it('reports 0 when neither source knows', () => {
    expect(targetEpisode('葬送的芙莉莲.mkv', null)).toBe(0)
  })
})

describe('keywordCandidates', () => {
  it('tries the AI title, then alt titles, then the cleaned name', () => {
    const candidates = keywordCandidates('Sousou no Frieren - 07.mkv', {
      title: 'Sousou no Frieren',
      episode: 7,
      altTitles: ['葬送的芙莉莲'],
    })
    expect(candidates[0]).toBe('Sousou no Frieren')
    expect(candidates[1]).toBe('葬送的芙莉莲')
    expect(candidates).toContain('Sousou no Frieren')
  })

  it('dedupes and caps the candidate list', () => {
    const candidates = keywordCandidates('a.mkv', {
      title: 'Same',
      episode: 1,
      altTitles: ['Same', 'x1', 'x2', 'x3'],
    })
    expect(new Set(candidates).size).toBe(candidates.length)
    expect(candidates.length).toBeLessThanOrEqual(5)
  })
})

describe('chooseSeason', () => {
  it('takes the only result', () => {
    const only = season('1', '咒术回战')
    expect(chooseSeason([only], '咒术回战', '')).toBe(only)
  })

  it('uses the season hint to pick between sibling seasons', () => {
    const s1 = season('1', '葬送的芙莉莲')
    const s2 = season('2', '葬送的芙莉莲 第二季')
    expect(chooseSeason([s1, s2], '葬送的芙莉莲 第二季', '')).toBe(s2)
  })

  it('returns null when nothing matches among several (never guesses)', () => {
    const s1 = season('1', '葬送的芙莉莲')
    const s2 = season('2', '进击的巨人')
    expect(chooseSeason([s1, s2], '完全不相干的番', '')).toBeNull()
  })
})

describe('autoMatch', () => {
  const deps = (seasons: SourceSeason[], episodes: SourceEpisode[]) => ({
    search: vi.fn().mockResolvedValue(seasons),
    episodes: vi.fn().mockResolvedValue(episodes),
  })

  it('mounts the episode that matches the number', async () => {
    const s = season('1', '咒术回战 第二季')
    const eps = [episode(101, 10), episode(102, 11), episode(103, 12)]
    const outcome = await autoMatch(
      '【幻樱字幕组】[咒术回战 第二季][第11话][1080p].mp4',
      { title: '咒术回战 第二季', episode: 11, altTitles: [] },
      deps([s], eps)
    )
    expect(outcome.status).toBe('matched')
    if (outcome.status !== 'matched') return
    expect(outcome.episode.id).toBe('102')
  })

  it('NEVER falls back to the first episode when the number is missing', async () => {
    const s = season('1', '葬送的芙莉莲 第二季', 10)
    // Season 2 continues the numbering at 29, so episode 11 is not in the list.
    const eps = [episode(201, 29), episode(202, 30)]
    const outcome = await autoMatch(
      '葬送的芙莉莲 第二季 - 11 [1080p].mkv',
      { title: '葬送的芙莉莲 第二季', episode: 11, altTitles: [] },
      deps([s], eps)
    )
    expect(outcome.status).toBe('ambiguous')
    if (outcome.status !== 'ambiguous') return
    expect(outcome.targetEpisode).toBe(11)
    expect(outcome.seasons).toHaveLength(1)
  })

  it('asks instead of guessing when no episode number can be determined', async () => {
    const s = season('1', '葬送的芙莉莲')
    const outcome = await autoMatch(
      '葬送的芙莉莲.mkv',
      { title: '葬送的芙莉莲', episode: 0, altTitles: [] },
      deps([s], [episode(1, 1)])
    )
    expect(outcome.status).toBe('ambiguous')
    if (outcome.status !== 'ambiguous') return
    expect(outcome.targetEpisode).toBe(0)
  })

  it('reports notFound when the search yields nothing', async () => {
    const outcome = await autoMatch(
      '不存在的番 第1话.mp4',
      { title: '不存在的番', episode: 1, altTitles: [] },
      deps([], [])
    )
    expect(outcome.status).toBe('notFound')
    if (outcome.status !== 'notFound') return
    expect(outcome.keyword).toBe('不存在的番')
  })

  it('uses the candidate that returns results when another finds nothing', async () => {
    const s = season('1', '葬送的芙莉莲')
    const search = vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([s])
    const outcome = await autoMatch(
      'Sousou no Frieren - 07.mkv',
      { title: 'Sousou no Frieren', episode: 7, altTitles: ['葬送的芙莉莲'] },
      { search, episodes: vi.fn().mockResolvedValue([episode(7, 7)]) }
    )
    expect(search).toHaveBeenCalled()
    expect(outcome.status).toBe('matched')
  })
})

describe('resolveEpisodeTarget', () => {
  it('matches the episode number exactly', () => {
    const eps = [episode(1, 1), episode(11, 11)]
    expect(resolveEpisodeTarget(eps, 11)).toMatchObject({
      mode: 'exact',
      episode: { id: '11' },
    })
  })

  it('maps a local episode onto absolute sequel numbering', () => {
    // DanDanPlay numbers 咒术回战 第二季 as 25–47; the file says 第11话.
    const eps = Array.from({ length: 23 }, (_, i) => episode(2500 + i, 25 + i))
    expect(resolveEpisodeTarget(eps, 11)).toMatchObject({
      mode: 'offset',
      episode: { episodeNumber: 35 },
    })
    expect(resolveEpisodeTarget(eps, 24)).toBeNull()
  })

  it('does not shift a season that starts at episode 1', () => {
    const eps = [episode(1, 1), episode(2, 2)]
    expect(resolveEpisodeTarget(eps, 3)).toBeNull()
  })
})

describe('autoMatch season scoring', () => {
  it('resolves absolute sequel numbering end to end', async () => {
    const s = season('17196', '咒术回战 第二季')
    const eps = Array.from({ length: 23 }, (_, i) => episode(2500 + i, 25 + i))
    const outcome = await autoMatch(
      '【幻樱字幕组】[咒术回战 第二季][第11话][1080p].mp4',
      { title: '咒术回战 第二季', episode: 11, altTitles: [] },
      {
        search: vi.fn().mockResolvedValue([s]),
        episodes: vi.fn().mockResolvedValue(eps),
      }
    )
    expect(outcome.status).toBe('matched')
    if (outcome.status !== 'matched') return
    expect(outcome.episodeMode).toBe('offset')
    expect(outcome.episode.episodeNumber).toBe(35)
  })

  it('picks a fuzzy match only when one non-future season has the episode', async () => {
    const real = {
      ...season('19226', '恶女不才，请多关照~雏宫蝶鼠换身传~'),
      year: 2026,
    }
    const future = {
      ...season(
        '20407',
        'ふつつかな悪女ではございますが ~雛宮蝶鼠とりかえ伝~ (2027)'
      ),
      year: 2027,
    }
    const eps = Array.from({ length: 12 }, (_, i) => episode(i + 1, i + 1))
    const outcome = await autoMatch(
      '[LoliHouse] Futsutsuka na Akujo dewa Gozaimasu ga - 11 [WebRip 1080p HEVC-10bit AAC ASSx2].mkv',
      {
        title: 'Futsutsuka na Akujo dewa Gozaimasu ga',
        episode: 11,
        altTitles: [],
      },
      {
        search: vi.fn().mockResolvedValue([real, future]),
        episodes: vi.fn().mockResolvedValue(eps),
        now: () => new Date('2026-10-20T00:00:00Z'),
      }
    )
    expect(outcome.status).toBe('matched')
    if (outcome.status !== 'matched') return
    expect(outcome.matchMode).toBe('fuzzy')
    expect(outcome.season.id).toBe('19226')
    expect(outcome.episode.episodeNumber).toBe(11)
  })

  it('defaults to the base season when the file name has no season', async () => {
    const seasons = [
      { ...season('17870', '药屋少女的呢喃'), year: 2023 },
      { ...season('18562', '药屋少女的呢喃 第二季'), year: 2025 },
      { ...season('19444', '药屋少女的呢喃 续篇'), year: 2026 },
    ]
    const eps = Array.from({ length: 24 }, (_, i) => episode(i + 1, i + 1))
    const outcome = await autoMatch(
      'Kusuriya no Hitorigoto - 12 [1080p].mkv',
      { title: 'Kusuriya no Hitorigoto', episode: 12, altTitles: [] },
      {
        search: vi.fn().mockResolvedValue(seasons),
        episodes: vi.fn().mockResolvedValue(eps),
        now: () => new Date('2026-10-20T00:00:00Z'),
      }
    )
    expect(outcome.status).toBe('matched')
    if (outcome.status !== 'matched') return
    expect(outcome.matchMode).toBe('default-season')
    expect(outcome.season.id).toBe('17870')
  })

  it('asks when the file names a season the candidates do not mark', async () => {
    const seasons = [
      { ...season('17870', '药屋少女的呢喃'), year: 2023 },
      { ...season('18562', '药屋少女的呢喃 第二季'), year: 2025 },
    ]
    const eps = Array.from({ length: 24 }, (_, i) => episode(i + 1, i + 1))
    const outcome = await autoMatch(
      'Kusuriya no Hitorigoto S3 - 12 [1080p].mkv',
      { title: 'Kusuriya no Hitorigoto', episode: 12, altTitles: [] },
      {
        search: vi.fn().mockResolvedValue(seasons),
        episodes: vi.fn().mockResolvedValue(eps),
        now: () => new Date('2026-10-20T00:00:00Z'),
      }
    )
    expect(outcome.status).toBe('ambiguous')
  })

  it('uses the episode search as a last resort', async () => {
    const s = season('1', '葬送的芙莉莲')
    const outcome = await autoMatch(
      '葬送的芙莉莲 - 07 [1080p].mkv',
      { title: '葬送的芙莉莲', episode: 7, altTitles: [] },
      {
        search: vi.fn().mockResolvedValue([]),
        episodes: vi.fn().mockResolvedValue([episode(7, 7)]),
        searchEpisodes: vi.fn().mockResolvedValue([s]),
      }
    )
    expect(outcome.status).toBe('matched')
  })

  it('never auto-mounts a season pack', async () => {
    const outcome = await autoMatch('[Group] Show - 01-12 [1080p].mkv', null, {
      search: vi.fn().mockResolvedValue([]),
      episodes: vi.fn(),
    })
    expect(outcome.status).toBe('ambiguous')
    if (outcome.status !== 'ambiguous') return
    expect(outcome.reason).toBe(REASON_BATCH)
  })

  it('mounts the single episode of a movie', async () => {
    const s = {
      ...season('9', '葬送的芙莉莲 剧场版'),
      type: 'movie',
      year: 2024,
      episodeCount: 1,
    }
    const outcome = await autoMatch(
      '[Group] 葬送的芙莉莲 剧场版 [2024] [BDRip 1080p].mkv',
      null,
      {
        search: vi.fn().mockResolvedValue([s]),
        episodes: vi.fn().mockResolvedValue([episode(1, 1)]),
        now: () => new Date('2026-10-20T00:00:00Z'),
      }
    )
    expect(outcome.status).toBe('matched')
  })

  it('never mounts a TV episode for a movie release', async () => {
    const tv = season('1', '葬送的芙莉莲')
    const outcome = await autoMatch(
      '[Group] 葬送的芙莉莲 剧场版 [2024] [BDRip 1080p].mkv',
      null,
      {
        search: vi.fn().mockResolvedValue([tv]),
        episodes: vi.fn().mockResolvedValue([episode(1, 1)]),
        now: () => new Date('2026-10-20T00:00:00Z'),
      }
    )
    expect(outcome.status).toBe('ambiguous')
  })

  it('ignores unrelated hits produced by the raw filename search', async () => {
    const real = season('17870', '药屋少女的呢喃')
    const noise = { ...season('4710', '妖怪传 猫目小僧'), year: 1976 }
    const eps = Array.from({ length: 24 }, (_, i) => episode(i + 1, i + 1))
    const search = vi.fn(async (keyword: string) =>
      keyword.includes('Kusuriya') ? [real] : [noise]
    )
    const outcome = await autoMatch(
      '[Nekomoe kissaten] Kusuriya no Hitorigoto - 12 [1080p].mkv',
      { title: 'Kusuriya no Hitorigoto', episode: 12, altTitles: [] },
      {
        search,
        episodes: vi.fn().mockResolvedValue(eps),
        now: () => new Date('2026-10-20T00:00:00Z'),
      }
    )
    expect(outcome.status).toBe('matched')
    if (outcome.status !== 'matched') return
    expect(outcome.season.id).toBe('17870')
  })

  it('prefers a resolvable local title over an arc title without the episode', async () => {
    const arc = { ...season('19524', 'ONE PIECE novel HEROINES'), year: 2026 }
    const real = { ...season('69', '海贼王'), year: 1999, episodeCount: 1100 }
    const search = vi.fn(async (keyword: string) =>
      keyword === 'One Piece' ? [arc, real] : [arc]
    )
    const episodes = vi.fn(async (s: SourceSeason) =>
      s.id === '69' ? [episode(1080, 1080)] : [episode(1, 1), episode(2, 2)]
    )
    const outcome = await autoMatch(
      '[Lilith-Raws] One Piece - 1080 [Baha][WEB-DL][1080p][AVC AAC][CHT][MP4].mp4',
      { title: 'One Piece', episode: 1080, altTitles: [] },
      {
        search,
        episodes,
        now: () => new Date('2026-10-20T00:00:00Z'),
      }
    )
    expect(outcome.status).toBe('matched')
    if (outcome.status !== 'matched') return
    expect(outcome.season.id).toBe('69')
  })

  it('uses the episode title to tell two seasons apart', async () => {
    const s1 = { ...season('17870', '药屋少女的呢喃'), year: 2023 }
    const s2 = { ...season('18562', '药屋少女的呢喃 第二季'), year: 2025 }
    const search = vi.fn().mockResolvedValue([s1, s2])
    const episodes = vi.fn(async (s: SourceSeason) =>
      s.id === '17870'
        ? [{ ...episode(17870012, 12), title: '第12话 宦官与妓女' }]
        : [{ ...episode(18562012, 12), title: '第12话 華瑞月' }]
    )
    const outcome = await autoMatch(
      'Kusuriya no Hitorigoto 第12话 華瑞月 [1080p].mkv',
      { title: 'Kusuriya no Hitorigoto', episode: 12, altTitles: [] },
      {
        search,
        episodes,
        now: () => new Date('2026-10-20T00:00:00Z'),
      }
    )
    expect(outcome.status).toBe('matched')
    if (outcome.status !== 'matched') return
    expect(outcome.season.id).toBe('18562')
  })

  it('merges a Tencent 第1季 into the unmarked base season', async () => {
    const ddp = season('17617', '葬送的芙莉莲')
    const tencent = {
      ...season('tx-1', '葬送的芙莉莲 第1季'),
      source: 'tencent' as const,
    }
    const search = vi.fn(async () => [ddp, tencent])
    const episodes = vi.fn(async (s: SourceSeason) =>
      s.source === 'tencent'
        ? [{ ...episode(1101, 11), source: 'tencent' as const, seasonId: s.id }]
        : [episode(1100, 11)]
    )
    const outcome = await autoMatch(
      '葬送的芙莉莲 - 11 [1080p].mkv',
      { title: '葬送的芙莉莲', episode: 11, altTitles: [] },
      {
        search,
        episodes,
        mergeSources: true,
        now: () => new Date('2026-10-20T00:00:00Z'),
      }
    )
    expect(outcome.status).toBe('matched')
    if (outcome.status !== 'matched') return
    expect(outcome.extraMatches).toHaveLength(1)
    expect(outcome.extraMatches[0].season.source).toBe('tencent')
    expect(outcome.extraMatches[0].episode.episodeNumber).toBe(11)
  })
})

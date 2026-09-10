import { describe, expect, it, vi } from 'vitest'
import {
  autoMatch,
  chooseSeason,
  cleanFilenameTitle,
  episodeFromFilename,
  keywordCandidates,
  targetEpisode,
} from './autoMatch'
import type { DdpEpisode, DdpSeason } from './ddp'

const season = (
  bangumiId: string,
  title: string,
  episodeCount = 12
): DdpSeason => ({
  animeId: Number(bangumiId),
  bangumiId,
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
): DdpEpisode => ({
  episodeId,
  episodeNumber,
  title: `第${episodeNumber}话`,
})

describe('episodeFromFilename', () => {
  it('reads the explicit episode marker, NOT the trailing resolution', () => {
    // The regression: "last number wins" turned this into episode 1080 and
    // then fell back to episode 1.
    expect(
      episodeFromFilename(
        '[Sakurato] BLEACH 千年血战篇-诀别谭- [11][AVC AAC][1080p].mkv'
      )
    ).toBe(0) // no 第N话/E11 marker → unknown, the AI supplies it
    expect(
      episodeFromFilename(
        '【幻樱字幕组】[咒术回战 第二季][第11话][1920X1080].mp4'
      )
    ).toBe(11)
    expect(episodeFromFilename('Spy x Family S01E11 1080p WEB-DL.mkv')).toBe(11)
    expect(episodeFromFilename('葬送的芙莉莲 - 07 [WebRip 1080p].mkv')).toBe(0)
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
    ).toBe('Sakurato BLEACH 千年血战篇-诀别谭')
  })

  it('leaves an already-clean name alone', () => {
    expect(cleanFilenameTitle('葬送的芙莉莲.mp4')).toBe('葬送的芙莉莲')
    expect(cleanFilenameTitle('Spy x Family S01E11 1080p WEB-DL.mkv')).toBe(
      'Spy x Family S01E11'
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
  const deps = (seasons: DdpSeason[], episodes: DdpEpisode[]) => ({
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
    expect(outcome.episode.episodeId).toBe(102)
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

  it('falls through to the next candidate keyword when one finds nothing', async () => {
    const s = season('1', '葬送的芙莉莲')
    const search = vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([s])
    const outcome = await autoMatch(
      'Sousou no Frieren - 07.mkv',
      { title: 'Sousou no Frieren', episode: 7, altTitles: ['葬送的芙莉莲'] },
      { search, episodes: vi.fn().mockResolvedValue([episode(7, 7)]) }
    )
    expect(search).toHaveBeenCalledTimes(2)
    expect(outcome.status).toBe('matched')
  })
})

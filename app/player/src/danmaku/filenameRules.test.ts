import { describe, expect, it } from 'vitest'
import {
  dirname,
  type FilenameRule,
  learnRule,
  matchRule,
  orderRules,
} from './filenameRules'

const SEASON = {
  bangumiId: '12345',
  title: 'BLEACH 千年血战篇-诀别谭-',
  episodeCount: 13,
}

const learn = (filePath: string, episode: number) =>
  learnRule({ filePath, episode, season: SEASON })

describe('dirname', () => {
  it('keeps the Windows drive and drops the file name', () => {
    expect(dirname('E:\\动漫\\BLEACH\\ep10.mkv')).toBe('E:\\动漫\\BLEACH')
  })

  it('handles posix paths', () => {
    expect(dirname('/mnt/anime/show/ep10.mkv')).toBe('/mnt/anime/show')
  })

  it('returns empty for a bare file name', () => {
    expect(dirname('ep10.mkv')).toBe('')
  })
})

describe('learnRule', () => {
  it('learns the bracketed episode slot of a sub-group name', () => {
    const rule = learn(
      'E:\\动漫\\BLEACH\\[Sakurato] BLEACH 千年血战篇-诀别谭- [10][AVC AAC][1080p].mkv',
      10
    )
    expect(rule).not.toBeNull()
    expect(rule?.episode).toBe(10)
    expect(rule?.folder).toBe('E:\\动漫\\BLEACH')
    expect(rule?.season).toEqual(SEASON)
    // The episode is the only capture group; the resolution is a wildcard.
    expect(rule?.pattern.match(/\(/g)).toHaveLength(1)
  })

  it('learns a marker the shared parser already handles', () => {
    const rule = learn('葬送的芙莉莲 - 第10话.mkv', 10)
    expect(rule?.pattern).toBe('^葬送的芙莉莲 - 第(\\d{1,4})话')
  })

  it('learns a repeated episode number (scraped page titles)', () => {
    // The 稀饭动漫 download names spell the episode twice; both copies move
    // together, so the first one becomes the capture.
    const rule = learn(
      '幼女战记 第二季 第 10 集：第10集 · 稀饭动漫 Next.mp4',
      10
    )
    expect(rule).not.toBeNull()
    expect(rule?.pattern).toBe('^幼女战记 第二季 第 (\\d{1,4}) 集：第')
    expect(
      matchRule(
        [rule as FilenameRule],
        '幼女战记 第二季 第 11 集：第11集 · 稀饭动漫 Next.mp4'
      )?.episode
    ).toBe(11)
  })

  it('handles the zero-padded copy of the same name', () => {
    const rule = learn(
      '恶女不才，请多关照 ～雏宫蝶鼠换身传～ 第 9 集：第09集 · 稀饭动漫 Next.mp4',
      9
    )
    expect(rule).not.toBeNull()
    expect(
      matchRule(
        [rule as FilenameRule],
        '恶女不才，请多关照 ～雏宫蝶鼠换身传～ 第 10 集：第10集 · 稀饭动漫 Next.mp4'
      )?.episode
    ).toBe(10)
  })

  it('never captures a season number that equals the episode', () => {
    const rule = learn('Show 第2季 第2集.mkv', 2)
    expect(rule?.pattern).toBe('^Show 第\\d+季 第(\\d{1,4})集')
    expect(
      matchRule([rule as FilenameRule], 'Show 第2季 第5集.mkv')?.episode
    ).toBe(5)
  })

  it('refuses when every occurrence is a season number', () => {
    expect(learn('Show 第2季 Part2.mkv', 2)).toBeNull()
  })

  it('refuses when no digit run equals the picked episode', () => {
    expect(learn('Show 1080p.mkv', 10)).toBeNull()
  })

  it('refuses a name with almost no literal text', () => {
    // `^(\d{1,4})$` would match any bare-numbered file on the disk.
    expect(learn('10.mkv', 10)).toBeNull()
  })

  it('refuses non-numeric episode numbers (specials)', () => {
    expect(learn('Show [SP1][1080p].mkv', Number('SP1'))).toBeNull()
  })

  it('ignores digit runs glued to letters', () => {
    // S01 / E10 / 1080p are release metadata or already-parsed markers.
    expect(learn('Bleach S01E10 [1080p].mkv', 10)).toBeNull()
    expect(learn('Bleach 10bit [720p].mkv', 10)).toBeNull()
  })

  it('refuses episode numbers too long to be one', () => {
    expect(learn('Show - 10000.mkv', 10000)).toBeNull()
  })
})

describe('matchRule', () => {
  const rule = learn(
    'E:\\动漫\\BLEACH\\[Sakurato] BLEACH 千年血战篇-诀别谭- [10][AVC AAC][1080p].mkv',
    10
  ) as FilenameRule

  it('reads the episode out of the same shape, resolution changes aside', () => {
    const hit = matchRule(
      [rule],
      'E:\\动漫\\BLEACH\\[Sakurato] BLEACH 千年血战篇-诀别谭- [11][AVC AAC][720p].mkv'
    )
    expect(hit?.episode).toBe(11)
    expect(hit?.rule.id).toBe(rule.id)
  })

  it('does not fire for a different show with a similar shape', () => {
    expect(
      matchRule(
        [rule],
        'E:\\动漫\\咒术回战\\[Sakurato] 咒术回战 第二季 [11][AVC AAC][1080p].mkv'
      )
    ).toBeNull()
  })

  it('survives a per-file CRC hash in the name', () => {
    const crc = learn('[SubsPlease] Show - 10 (1080p) [ABCD1234].mkv', 10)
    expect(crc).not.toBeNull()
    expect(
      matchRule(
        [crc as FilenameRule],
        '[SubsPlease] Show - 11 (720p) [DEAD4BEE].mkv'
      )?.episode
    ).toBe(11)
  })

  it('survives differing bracket groups after the episode', () => {
    const frieren = learn(
      '[Nekomoe kissaten][Sousou no Frieren][07][1080p][AVC AAC].mkv',
      7
    )
    expect(frieren).not.toBeNull()
    expect(
      matchRule(
        [frieren as FilenameRule],
        '[Nekomoe kissaten][Sousou no Frieren][12][720p][HEVC].mkv'
      )?.episode
    ).toBe(12)
  })

  it('returns null with no rules and skips corrupt patterns', () => {
    expect(matchRule([], 'Show - 10.mkv')).toBeNull()
    const corrupt = { ...rule, pattern: '^Show - (\\d{1,4}' }
    expect(matchRule([corrupt], 'Show - 10.mkv')).toBeNull()
  })

  it('ignores a match that reads as zero', () => {
    const zero = { ...rule, pattern: '^Show (\\d{1,4})' }
    expect(matchRule([zero], 'Show 0.mkv')).toBeNull()
  })

  it('prefers the rule learned in the same folder', () => {
    const other = { ...rule, id: 'other', folder: 'D:\\下载', hits: 99 }
    const hit = matchRule(
      [other, rule],
      'E:\\动漫\\BLEACH\\[Sakurato] BLEACH 千年血战篇-诀别谭- [11][AVC AAC][1080p].mkv'
    )
    expect(hit?.rule.id).toBe(rule.id)
  })
})

describe('orderRules', () => {
  it('sorts by folder, then hits, then recency', () => {
    const rules = [
      { folder: 'D:\\a', hits: 5, updatedAt: 1, id: 'a' },
      { folder: 'D:\\a', hits: 5, updatedAt: 9, id: 'b' },
      { folder: 'D:\\a', hits: 7, updatedAt: 1, id: 'c' },
      { folder: 'E:\\b', hits: 100, updatedAt: 9, id: 'd' },
    ] as FilenameRule[]
    expect(orderRules(rules, 'D:\\a').map((r) => r.id)).toEqual([
      'c',
      'b',
      'a',
      'd',
    ])
  })
})

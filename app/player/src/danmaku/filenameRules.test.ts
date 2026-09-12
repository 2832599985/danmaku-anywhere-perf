import { describe, expect, it } from 'vitest'
import {
  dirname,
  type FilenameRule,
  learnRule,
  matchRule,
  orderRules,
  ruleShape,
  unmatchedRuleHint,
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
    // together, so the first one becomes the capture. The tail stops at the
    // second `第` (free text), keeping only the ` 集：` marker.
    const rule = learn(
      '幼女战记 第二季 第 10 集：第10集 · 稀饭动漫 Next.mp4',
      10
    )
    expect(rule).not.toBeNull()
    expect(rule?.pattern).toBe('^幼女战记 第二季 第 (\\d{1,4}) 集：')
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

describe('the literal tail never eats the episode title', () => {
  // Real user files: one season, consecutive episodes, identical shape — only
  // the episode number and the EPISODE TITLE differ. The first implementation
  // took a fixed 6-character tail after the number, which swallowed the title
  // (" 集：欢迎加"), so the learned rule could only ever match the very file it
  // was learned from and the AI silently answered for every other episode.
  const EP1 =
    '魔法光源股份有限公司 第 1 集：欢迎加入魔法光源股份有限公司 · 稀饭动漫 Next'
  const EP2 = '魔法光源股份有限公司 第 2 集：骑扫帚是小菜一碟 · 稀饭动漫 Next'

  it('keeps only the marker as the tail', () => {
    const rule = learn(`D:\\桌面\\${EP1}.mp4`, 1)
    expect(rule).not.toBeNull()
    expect(rule?.pattern).toBe('^魔法光源股份有限公司 第 (\\d{1,4}) 集：')
  })

  it('matches the next episode of the same batch, exactly', () => {
    const rule = learn(`D:\\桌面\\${EP1}.mp4`, 1) as FilenameRule
    const hit = matchRule([rule], `D:\\桌面\\${EP2}.mp4`)
    expect(hit?.episode).toBe(2)
    expect(hit?.exact).toBe(true)
  })

  it('still fires for rules stored by the previous version', () => {
    // Exactly what is persisted on the user's machine today: the tail ate the
    // first episode's title. The loose tier drops the tail, so no re-teaching
    // (and no store migration) is needed.
    const legacy: FilenameRule = {
      ...(learn(`D:\\桌面\\${EP1}.mp4`, 1) as FilenameRule),
      pattern: '^魔法光源股份有限公司 第 (\\d{1,4}) 集：欢迎加',
    }
    const hit = matchRule([legacy], `D:\\桌面\\${EP2}.mp4`)
    expect(hit?.episode).toBe(2)
    expect(hit?.exact).toBe(false)
  })

  it('does not fire on another season of the same show', () => {
    const rule = learn(`D:\\桌面\\${EP1}.mp4`, 1) as FilenameRule
    expect(
      matchRule(
        [rule],
        '魔法光源股份有限公司 第二季 第 3 集：某集 · 稀饭动漫 Next.mp4'
      )
    ).toBeNull()
  })

  it('prefers an exact match over a higher-ranked loose one', () => {
    const base = learn(`D:\\桌面\\${EP1}.mp4`, 1) as FilenameRule
    // Same folder, but the legacy rule ranks first (99 hits) and its tail only
    // fits the file it was learned from — the strict tier must still win with
    // the properly learned pattern further down the list.
    const legacy: FilenameRule = {
      ...base,
      id: 'legacy',
      pattern: '^魔法光源股份有限公司 第 (\\d{1,4}) 集：欢迎加',
      hits: 99,
    }
    const exact: FilenameRule = { ...base, id: 'exact' }
    const hit = matchRule([legacy, exact], `${EP2}.mp4`)
    expect(hit?.rule.id).toBe('exact')
    expect(hit?.exact).toBe(true)
  })

  it('leaves a non-learned pattern alone in the loose tier', () => {
    // No capture group → nothing to fall back to (`prefixOnly` returns null).
    const broken: FilenameRule = {
      ...(learn(`D:\\桌面\\${EP1}.mp4`, 1) as FilenameRule),
      pattern: '^魔法光源股份有限公司 第 \\d+ 集：',
    }
    expect(matchRule([broken], `${EP2}.mp4`)).toBeNull()
  })
})

describe('ruleShape', () => {
  it('counts a legacy tail and a clean tail as the same shape', () => {
    // The user's stored rule vs one learned after the marker-tail fix: they
    // must collapse into a single entry, or a correction could be outranked by
    // the stale rule it was meant to replace.
    expect(ruleShape('^魔法光源股份有限公司 第 (\\d{1,4}) 集：欢迎加')).toBe(
      ruleShape('^魔法光源股份有限公司 第 (\\d{1,4}) 集：')
    )
  })

  it('keeps genuinely different formats apart', () => {
    expect(ruleShape('^Show - (\\d{1,4}) (1080p)')).not.toBe(
      ruleShape('^Show\\[(\\d{1,4})\\]')
    )
    expect(ruleShape('^A 第(\\d{1,4})集')).not.toBe(
      ruleShape('^B 第(\\d{1,4})集')
    )
  })

  it('falls back to the raw pattern when there is no capture group', () => {
    expect(ruleShape('^Show (\\d+)')).toBe('^Show (\\d+)')
  })
})

describe('unmatchedRuleHint', () => {
  const rule = learn('D:\\动漫\\BLEACH\\BLEACH 第 10 集：某集.mp4', 10)

  it('explains that a same-folder rule exists but did not match', () => {
    const hint = unmatchedRuleHint(
      [rule as FilenameRule],
      'D:\\动漫\\BLEACH\\BLEACH 第 11 集：另一集.mp4'
    )
    expect(hint).toContain('没匹配上')
    expect(hint).toContain((rule as FilenameRule).pattern)
  })

  it('stays silent for a folder with no learned rules', () => {
    expect(
      unmatchedRuleHint([rule as FilenameRule], 'E:\\别的\\第 1 集.mp4')
    ).toBeNull()
  })

  it('ignores rules from other folders', () => {
    expect(unmatchedRuleHint([], 'D:\\动漫\\BLEACH\\第 11 集.mp4')).toBeNull()
  })

  it('stays silent for a different show in the same folder', () => {
    // Real libraries keep every show in one directory, so a shared folder is
    // not evidence: claiming "learned a shape but this file did not match"
    // about another show would be actively misleading.
    const bleach = learn('D:\\动漫\\BLEACH 第 10 集：某集.mp4', 10)
    expect(
      unmatchedRuleHint(
        [bleach as FilenameRule],
        'D:\\动漫\\咒术回战 第 3 集：某集.mp4'
      )
    ).toBeNull()
  })
})

describe('a season number is never read as the episode (independent review #1)', () => {
  const EP1 =
    '魔法光源股份有限公司 第 1 集：欢迎加入魔法光源股份有限公司 · 稀饭动漫 Next'
  const rule = learn(`D:/桌面/${EP1}.mp4`, 1) as FilenameRule

  it('rejects the loose-tier capture when a season marker follows it', () => {
    // Without the guard the loose tier reads `第 2` as episode 2 and a SECOND
    // season file gets mounted as the first season's episode 2.
    expect(
      matchRule([rule], '魔法光源股份有限公司 第 2 季 第 1 集：新季首集.mp4')
    ).toBeNull()
    expect(
      matchRule([rule], '魔法光源股份有限公司 第 2 部 第 1 集：某集.mp4')
    ).toBeNull()
    // Spaced-out forms with no space at all are safe either way.
    expect(
      matchRule([rule], '魔法光源股份有限公司 第2季 第 1 集：某集.mp4')
    ).toBeNull()
  })

  it('still reads the real sibling episode', () => {
    expect(
      matchRule([rule], '魔法光源股份有限公司 第 2 集：骑扫帚是小菜一碟.mp4')
        ?.episode
    ).toBe(2)
  })
})

describe('hint ignores site boilerplate (independent review #2)', () => {
  const scraper = learn(
    'D:/Videos/在线播放最强废渣皇子暗中活跃于帝位之争 第08集-高清在线观看.mp4',
    8
  ) as FilenameRule

  it('does not fire for another show that only shares the scraper prefix', () => {
    expect(
      unmatchedRuleHint(
        [scraper],
        'D:/Videos/在线播放转学后班上的清纯可爱美少女 第07集-高清在线观看.mp4'
      )
    ).toBeNull()
  })

  it('still fires for the same show', () => {
    const hint = unmatchedRuleHint(
      [scraper],
      'D:/Videos/在线播放最强废渣皇子暗中活跃于帝位之争 第09集-高清在线观看.mp4'
    )
    expect(hint).toContain('没匹配上')
  })
})

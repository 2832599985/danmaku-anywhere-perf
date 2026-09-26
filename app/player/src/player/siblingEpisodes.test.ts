import { describe, expect, it } from 'vitest'
import { joinPath } from '@/platform/types'
import {
  locateEpisode,
  type SiblingBatch,
  selectBatch,
} from './siblingEpisodes'

/** The user's real Desktop batch (one season, consecutive episodes). */
const MAGIC = 'C:\\Users\\x\\Desktop'
const EP1 = `${MAGIC}\\魔法光源股份有限公司 第 1 集：欢迎加入魔法光源股份有限公司 · 稀饭动漫 Next.mp4`
const EP2 = `${MAGIC}\\魔法光源股份有限公司 第 2 集：骑扫帚是小菜一碟 · 稀饭动漫 Next.mp4`

/** The user's real Videos folder: many shows side by side. */
const VIDEOS = 'C:\\Users\\x\\Videos'
const YUJO10 = `${VIDEOS}\\幼女战记 第二季 第 10 集：第10集 · 稀饭动漫 Next.mp4`
const YUJO11 = `${VIDEOS}\\幼女战记 第二季 第 11 集：第11集 · 稀饭动漫 Next.mp4`
const OTHER = `${VIDEOS}\\乡下大叔成为剑圣 第二季 第 10 集：第10集 · 稀饭动漫 Next.mp4`
const RECORDING = `${VIDEOS}\\2025-10-13 20-03-05.mkv`
const BARE = `${VIDEOS}\\05.mp4`

describe('locateEpisode', () => {
  it('reads the marked number of a scraped name', () => {
    expect(
      locateEpisode('幼女战记 第二季 第 10 集：第10集 · 稀饭动漫 Next')
    ).toEqual({
      episode: 10,
      index: '幼女战记 第二季 第 '.length,
    })
  })

  it('prefers a marked run over an unmarked one', () => {
    // 1080p is glued to a letter and dropped; the bracketed number is the only
    // candidate.
    expect(
      locateEpisode('[Sakurato] BLEACH 千年血战篇-诀别谭- [10][AVC AAC][1080p]')
        ?.episode
    ).toBe(10)
  })

  it('refuses names with several unmarked numbers (dates, ids)', () => {
    // Six numbers and no marker: a date/time is not an episode.
    expect(locateEpisode('2025-10-13 20-03-05')).toBeNull()
    // A bare number IS readable (single candidate) — what keeps those files
    // from forming a "batch" is the empty literal head, checked in
    // `selectBatch` below.
    expect(locateEpisode('05')).toEqual({ episode: 5, index: 0 })
  })

  it('falls back to a learned rule value when the heuristic cannot read it', () => {
    // Two bare numbers, no marker: the heuristic abstains, the rule knows.
    expect(locateEpisode('Show 5 6', null)).toBeNull()
    expect(locateEpisode('Show 5 6', 5)?.episode).toBe(5)
  })
})

/** Every other member of the batch, in episode order (before, then after). */
const members = (batch: SiblingBatch | null) =>
  batch ? [...batch.before, ...batch.after] : []
const episodes = (batch: SiblingBatch | null) =>
  members(batch).map((s) => s.episode)

describe('selectBatch', () => {
  it('finds the next episode of a real batch', () => {
    const batch = selectBatch(EP1, [EP1, EP2])
    expect(batch?.episode).toBe(1)
    expect(batch?.before).toEqual([])
    expect(batch?.after.map((s) => s.path)).toEqual([EP2])
  })

  it('splits the batch around the opened episode', () => {
    // Regression: the first version returned ONE flat list and the playlist
    // queued all of it behind the current file — opening episode 7 gave
    // `7,1,2,…,6,8,9`, so autoplay went from 7 back to 1.
    const all = [1, 2, 3, 7, 8, 9].map(
      (n) =>
        `${VIDEOS}\\幼女战记 第二季 第 ${n} 集：第${n}集 · 稀饭动漫 Next.mp4`
    )
    const batch = selectBatch(all[3], all)
    expect(batch?.episode).toBe(7)
    expect(batch?.before.map((s) => s.episode)).toEqual([1, 2, 3])
    expect(batch?.after.map((s) => s.episode)).toEqual([8, 9])
  })

  it('puts a re-release of the SAME episode before it, not after', () => {
    // A v2 of episode 7 must not be what autoplay plays after episode 7.
    const v1 = `${VIDEOS}\\幼女战记 第二季 第 7 集：第7集 · 稀饭动漫 Next.mp4`
    const v2 = `${VIDEOS}\\幼女战记 第二季 第 7 集：第7集 · 稀饭动漫 Next v2.mp4`
    const ep8 = `${VIDEOS}\\幼女战记 第二季 第 8 集：第8集 · 稀饭动漫 Next.mp4`
    const batch = selectBatch(v1, [v1, v2, ep8])
    expect(batch?.before.map((s) => s.path)).toEqual([v2])
    expect(batch?.after.map((s) => s.path)).toEqual([ep8])
  })

  it('never pulls in another show from the same folder', () => {
    // The real library: 幼女战记 sits next to unrelated scraped shows.
    expect(
      members(selectBatch(YUJO10, [YUJO10, OTHER, RECORDING, BARE]))
    ).toEqual([])
    expect(members(selectBatch(YUJO10, [YUJO10, YUJO11, OTHER]))).toEqual([
      { path: YUJO11, name: expect.any(String), episode: 11 },
    ])
  })

  it('orders by episode, not by name', () => {
    const paths = [
      `${VIDEOS}\\幼女战记 第二季 第 10 集：第10集 · 稀饭动漫 Next.mp4`,
      `${VIDEOS}\\幼女战记 第二季 第 2 集：第2集 · 稀饭动漫 Next.mp4`,
      `${VIDEOS}\\幼女战记 第二季 第 3 集：第3集 · 稀饭动漫 Next.mp4`,
    ]
    expect(episodes(selectBatch(YUJO10, paths))).toEqual([2, 3])
  })

  it('excludes the current file and other folders', () => {
    const elsewhere = `${MAGIC}\\幼女战记 第二季 第 11 集：第11集.mp4`
    const batch = selectBatch(YUJO10, [YUJO10, YUJO11, elsewhere])
    expect(members(batch).map((s) => s.path)).toEqual([YUJO11])
  })

  it('has no opinion when the file name holds no usable episode number', () => {
    expect(selectBatch(RECORDING, [RECORDING, BARE, YUJO10])).toBeNull()
    // A bare number is not a batch identity either (`05.mp4` next to `08.mp4`).
    expect(selectBatch(BARE, [BARE, `${VIDEOS}\\08.mp4`])).toBeNull()
  })

  it('uses a learned rule for shapes the heuristic cannot read', () => {
    const a = `${VIDEOS}\\Show 5 6.mkv`
    const b = `${VIDEOS}\\Show 5 7.mkv`
    // Two bare numbers and no marker: the heuristic abstains; the rule says the
    // SECOND number is the episode (6 and 7).
    const byRule = (path: string) =>
      path.endsWith('6.mkv') ? 6 : path.endsWith('7.mkv') ? 7 : null
    const batch = selectBatch(a, [a, b], byRule)
    expect(batch?.episode).toBe(6)
    expect(batch?.after.map((s) => s.path)).toEqual([b])
  })

  it('keeps a whole season in order and drops duplicates', () => {
    expect(episodes(selectBatch(EP1, [EP1, EP2, EP1]))).toEqual([2])
  })

  it('works on the paths the platform lists for a folder', () => {
    // The real end of the pipe: `listVideoFiles` hands over `joinPath(dir,
    // entry.name)` for BARE names, and that join was silently broken (see
    // types.test.ts) — every entry collapsed to one literal string, so the scan
    // found no episode in any of them and the feature never added anything.
    const dir = VIDEOS
    const names = [
      '无用圣女的异世界美食之旅 凭借隐藏技能召唤露营车 第 7 集：第07集 · 稀饭动漫 Next.mp4',
      '无用圣女的异世界美食之旅 凭借隐藏技能召唤露营车 第 8 集：第08集 · 稀饭动漫 Next.mp4',
      '无用圣女的异世界美食之旅 凭借隐藏技能召唤露营车 第 9 集：第09集 · 稀饭动漫 Next.mp4',
    ]
    const paths = names.map((name) => joinPath(dir, name))
    const batch = selectBatch(paths[0], paths)
    expect(batch?.after.map((s) => s.episode)).toEqual([8, 9])
    expect(batch?.after[0].path).toBe(paths[1])
  })
})

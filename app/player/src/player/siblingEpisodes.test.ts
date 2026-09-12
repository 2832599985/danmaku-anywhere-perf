import { describe, expect, it } from 'vitest'
import { locateEpisode, selectSiblings } from './siblingEpisodes'

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
    // `selectSiblings` below.
    expect(locateEpisode('05')).toEqual({ episode: 5, index: 0 })
  })

  it('falls back to a learned rule value when the heuristic cannot read it', () => {
    // Two bare numbers, no marker: the heuristic abstains, the rule knows.
    expect(locateEpisode('Show 5 6', null)).toBeNull()
    expect(locateEpisode('Show 5 6', 5)?.episode).toBe(5)
  })
})

describe('selectSiblings', () => {
  it('finds the next episode of a real batch', () => {
    const siblings = selectSiblings(EP1, [EP1, EP2])
    expect(siblings.map((s) => s.episode)).toEqual([2])
    expect(siblings[0].path).toBe(EP2)
  })

  it('never pulls in another show from the same folder', () => {
    // The real library: 幼女战记 sits next to unrelated scraped shows.
    const siblings = selectSiblings(YUJO10, [YUJO10, OTHER, RECORDING, BARE])
    expect(siblings).toEqual([])
    expect(selectSiblings(YUJO10, [YUJO10, YUJO11, OTHER])).toEqual([
      { path: YUJO11, name: expect.any(String), episode: 11 },
    ])
  })

  it('orders by episode, not by name', () => {
    const paths = [
      `${VIDEOS}\\幼女战记 第二季 第 10 集：第10集 · 稀饭动漫 Next.mp4`,
      `${VIDEOS}\\幼女战记 第二季 第 2 集：第2集 · 稀饭动漫 Next.mp4`,
      `${VIDEOS}\\幼女战记 第二季 第 3 集：第3集 · 稀饭动漫 Next.mp4`,
    ]
    const siblings = selectSiblings(YUJO10, paths)
    expect(siblings.map((s) => s.episode)).toEqual([2, 3])
  })

  it('excludes the current file and other folders', () => {
    const elsewhere = `${MAGIC}\\幼女战记 第二季 第 11 集：第11集.mp4`
    const siblings = selectSiblings(YUJO10, [YUJO10, YUJO11, elsewhere])
    expect(siblings.map((s) => s.path)).toEqual([YUJO11])
  })

  it('has no opinion when the file name holds no usable episode number', () => {
    expect(selectSiblings(RECORDING, [RECORDING, BARE, YUJO10])).toEqual([])
    // A bare number is not a batch identity either (`05.mp4` next to `08.mp4`).
    expect(selectSiblings(BARE, [BARE, `${VIDEOS}\\08.mp4`])).toEqual([])
  })

  it('uses a learned rule for shapes the heuristic cannot read', () => {
    const a = `${VIDEOS}\\Show 5 6.mkv`
    const b = `${VIDEOS}\\Show 5 7.mkv`
    const byRule = (path: string) =>
      path.endsWith('6.mkv') ? 5 : path.endsWith('7.mkv') ? 5 : null
    // The stub answers "that number is an episode" for the first run, so the
    // head is `show ` on both sides and the numbers come out of each name.
    const siblings = selectSiblings(a, [a, b], (path) =>
      path.includes('Show 5 ') ? 5 : byRule(path)
    )
    expect(siblings.map((s) => s.episode)).toEqual([5])
  })

  it('keeps a whole season in order and drops duplicates', () => {
    const paths = [EP1, EP2, EP1]
    expect(selectSiblings(EP1, paths).map((s) => s.episode)).toEqual([2])
  })
})

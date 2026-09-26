import { describe, expect, it } from 'vitest'
import { languageRank, rankSiblingSubtitles } from './siblings'

const DIR = 'D:\\Anime\\Show'
const VIDEO = `${DIR}\\[Group] Show - 01 [1080p].mkv`
const at = (name: string) => `${DIR}\\${name}`
const names = (paths: string[]) => paths.map((p) => p.split('\\').pop())

describe('rankSiblingSubtitles', () => {
  it('finds fansub-style tagged files and orders them for a Chinese reader', () => {
    const files = [
      at('[Group] Show - 01 [1080p].tc.ass'),
      at('[Group] Show - 01 [1080p].jpn.srt'),
      at('[Group] Show - 01 [1080p].sc.ass'),
      at('[Group] Show - 01 [1080p].chs&jpn.ass'),
      at('[Group] Show - 01 [1080p].eng.srt'),
      at('[Group] Show - 01 [1080p].mkv'),
      at('[Group] Show - 02 [1080p].sc.ass'),
    ]
    expect(names(rankSiblingSubtitles(VIDEO, files))).toEqual([
      '[Group] Show - 01 [1080p].sc.ass',
      '[Group] Show - 01 [1080p].chs&jpn.ass',
      '[Group] Show - 01 [1080p].tc.ass',
      '[Group] Show - 01 [1080p].jpn.srt',
      '[Group] Show - 01 [1080p].eng.srt',
    ])
  })

  it('puts an untagged exact match first (and keeps srt before ass)', () => {
    const files = [
      at('[Group] Show - 01 [1080p].ass'),
      at('[Group] Show - 01 [1080p].sc.ass'),
      at('[Group] Show - 01 [1080p].srt'),
    ]
    expect(names(rankSiblingSubtitles(VIDEO, files))).toEqual([
      '[Group] Show - 01 [1080p].srt',
      '[Group] Show - 01 [1080p].ass',
      '[Group] Show - 01 [1080p].sc.ass',
    ])
  })

  it('does not take episode 10 for episode 1', () => {
    const video = `${DIR}\\ep1.mp4`
    const files = [at('ep10.srt'), at('ep1.srt'), at('ep1.chs.srt')]
    expect(names(rankSiblingSubtitles(video, files))).toEqual([
      'ep1.srt',
      'ep1.chs.srt',
    ])
  })

  it('matches case-insensitively and accepts bracketed tags', () => {
    const video = `${DIR}\\Show.S01E01.1080p.mkv`
    const files = [
      at('show.s01e01.1080p[简体].ASS'),
      at('Show.S01E01.1080p.vtt'),
    ]
    expect(names(rankSiblingSubtitles(video, files))).toEqual([
      'Show.S01E01.1080p.vtt',
      'show.s01e01.1080p[简体].ASS',
    ])
  })

  it('ignores non-subtitle files', () => {
    expect(
      rankSiblingSubtitles(VIDEO, [at('[Group] Show - 01 [1080p].nfo')])
    ).toEqual([])
  })
})

describe('languageRank', () => {
  it('reads the common tags', () => {
    expect(languageRank('')).toBe(0)
    expect(languageRank('.chs')).toBe(1)
    expect(languageRank('.zh-Hans')).toBe(1)
    expect(languageRank('.简体中文')).toBe(1)
    expect(languageRank('.sc_jp')).toBe(2)
    expect(languageRank('.简日双语')).toBe(2)
    expect(languageRank('.zh')).toBe(3)
    expect(languageRank('.cht')).toBe(4)
    expect(languageRank('.繁體中文')).toBe(4)
    expect(languageRank('.tc&jpn')).toBe(5)
    expect(languageRank('.ja')).toBe(6)
    expect(languageRank('.en')).toBe(7)
  })
})

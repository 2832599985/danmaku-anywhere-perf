import { describe, expect, it } from 'vitest'
import { aiInputForFilename, parseReleaseName } from './releaseName'

const parse = (name: string) => parseReleaseName(`C:\\Videos\\${name}`)

describe('parseReleaseName', () => {
  it('parses the common fansub shapes', () => {
    const cases: {
      name: string
      title: string
      episode: number
      season: number | null
      group: string | null
    }[] = [
      {
        name: '[LoliHouse] Futsutsuka na Akujo dewa Gozaimasu ga - 11 [WebRip 1080p HEVC-10bit AAC ASSx2].mkv',
        title: 'Futsutsuka na Akujo dewa Gozaimasu ga',
        episode: 11,
        season: null,
        group: 'LoliHouse',
      },
      {
        name: '[Nekomoe kissaten] Kusuriya no Hitorigoto - 12 [1080p].mkv',
        title: 'Kusuriya no Hitorigoto',
        episode: 12,
        season: null,
        group: 'Nekomoe kissaten',
      },
      {
        name: '[Airota][Sousou no Frieren][07][1080p][CHS].mkv',
        title: 'Sousou no Frieren',
        episode: 7,
        season: null,
        group: 'Airota',
      },
      {
        name: '[Sakurato] BLEACH 千年血战篇-诀别谭- [11][AVC AAC][1080p].mkv',
        title: 'BLEACH 千年血战篇-诀别谭',
        episode: 11,
        season: null,
        group: 'Sakurato',
      },
      {
        name: '【幻樱字幕组】★10月新番【咒术回战 第二季】【第11话】【1920X1080】.mp4',
        title: '咒术回战 第二季',
        episode: 11,
        season: 2,
        group: null,
      },
      {
        name: '葬送的芙莉莲 第二季 - 11 [1080p].mp4',
        title: '葬送的芙莉莲 第二季',
        episode: 11,
        season: 2,
        group: null,
      },
      {
        name: 'Spy x Family S01E11 1080p WEB-DL.mkv',
        title: 'Spy x Family S01',
        episode: 11,
        season: 1,
        group: null,
      },
      {
        name: 'Show.Name.S02E03.1080p.WEB-DL.mkv',
        title: 'Show Name S02',
        episode: 3,
        season: 2,
        group: null,
      },
      {
        name: '孤独摇滚 第01集.mp4',
        title: '孤独摇滚',
        episode: 1,
        season: null,
        group: null,
      },
      {
        name: '关于我转生变成史莱姆这档事 第三季 第05话.mp4',
        title: '关于我转生变成史莱姆这档事 第三季',
        episode: 5,
        season: 3,
        group: null,
      },
      {
        name: 'Attack on Titan 2nd Season - 05 [1080p].mkv',
        title: 'Attack on Titan 2nd Season',
        episode: 5,
        season: 2,
        group: null,
      },
      {
        name: '某番 第2期 第05话.mp4',
        title: '某番 第2期',
        episode: 5,
        season: 2,
        group: null,
      },
    ]

    for (const entry of cases) {
      expect({
        name: entry.name,
        ...parse(entry.name),
      }).toMatchObject({
        name: entry.name,
        title: entry.title,
        episode: entry.episode,
        season: entry.season,
        group: entry.group,
      })
    }
  })

  it('keeps a year out of the episode slot and detects movies/batches', () => {
    const movie = parse('[Group] Show The Movie [2024] [BDRip 1080p].mkv')
    expect(movie.episode).toBe(0)
    expect(movie.year).toBe(2024)
    expect(movie.isMovie).toBe(true)

    const batch = parse('[Group] Show - 01-12 [1080p].mkv')
    expect(batch.isBatch).toBe(true)
  })

  it('builds a compact AI input without group tags or release metadata', () => {
    expect(
      aiInputForFilename(
        '[LoliHouse] Futsutsuka na Akujo dewa Gozaimasu ga - 11 [WebRip 1080p HEVC-10bit AAC ASSx2].mkv'
      )
    ).toBe('Futsutsuka na Akujo dewa Gozaimasu ga - 11')
    expect(
      aiInputForFilename(
        '【幻樱字幕组】★10月新番【咒术回战 第二季】【第11话】【1920X1080】.mp4'
      )
    ).toBe('咒术回战 第二季 - 11')
  })

  it('keeps the episode title when the release carries one', () => {
    expect(
      parse('某番 第11话 真是个不得了的恶女 [1080p].mkv').episodeTitle
    ).toBe('真是个不得了的恶女')
    expect(parse('某番 第11话 [1080p].mkv').episodeTitle).toBe(null)
    expect(parse('某番 第11话 1080p.mkv').episodeTitle).toBe(null)
  })
})

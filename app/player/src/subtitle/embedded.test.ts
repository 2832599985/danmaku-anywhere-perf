import { describe, expect, it } from 'vitest'
import {
  isChinese,
  languageLabel,
  pickDefaultTrack,
  trackLabel,
  trackName,
} from './embedded'
import type { EmbeddedTrack } from './native'

/** The tracks inside the user's real file:
 *  `[Nix-Raws] … S01E11 [CATCHPLAY WEB-DL 1080p AVC AAC][SC_TC].mkv`. */
const SC: EmbeddedTrack = {
  index: 2,
  codec: 'subrip',
  language: 'chi',
  title: 'Chinese Simplified',
  text: true,
  default: false,
  forced: false,
}
const TC: EmbeddedTrack = {
  index: 3,
  codec: 'subrip',
  language: 'chi',
  title: 'Chinese Traditional',
  text: true,
  default: false,
  forced: false,
}
const JPN: EmbeddedTrack = {
  index: 4,
  codec: 'ass',
  language: 'jpn',
  title: null,
  text: true,
  default: false,
  forced: false,
}
const PGS: EmbeddedTrack = {
  index: 5,
  codec: 'hdmv_pgs_subtitle',
  language: 'eng',
  title: null,
  text: false,
  default: false,
  forced: false,
}
const FORCED: EmbeddedTrack = {
  index: 6,
  codec: 'subrip',
  language: 'chi',
  title: '简体（强制）',
  text: true,
  default: false,
  forced: true,
}

describe('pickDefaultTrack', () => {
  it('picks 简体 over 繁體, whatever order the container lists them in', () => {
    // The real file ships both (`[SC_TC]`); the viewer reads Simplified, so
    // stream order must not decide.
    expect(pickDefaultTrack([SC, TC])?.index).toBe(SC.index)
    expect(pickDefaultTrack([TC, SC])?.index).toBe(SC.index)
  })

  it('reads the script from a Chinese title when the tag is bare `chi`', () => {
    const simplified: EmbeddedTrack = {
      ...SC,
      title: '简体中文',
      language: 'chi',
    }
    const traditional: EmbeddedTrack = {
      ...TC,
      title: '繁體中文',
      language: 'chi',
    }
    expect(pickDefaultTrack([traditional, simplified])?.index).toBe(
      simplified.index
    )
  })

  it('does not mistake a bilingual track for a Simplified one', () => {
    // "简繁双语" carries BOTH markers — it is not the Simplified-only stream,
    // so the real 简体 track still wins.
    const bilingual: EmbeddedTrack = { ...SC, index: 9, title: '简繁双语' }
    expect(pickDefaultTrack([bilingual, SC])?.index).toBe(SC.index)
    expect(pickDefaultTrack([bilingual])?.index).toBe(bilingual.index)
  })

  it('prefers Chinese over Japanese/English when both are present', () => {
    expect(pickDefaultTrack([JPN, SC])?.index).toBe(SC.index)
  })

  it('honours the default disposition within the same script', () => {
    const otherSimplified: EmbeddedTrack = { ...SC, index: 7 }
    expect(
      pickDefaultTrack([otherSimplified, { ...SC, default: true }])?.index
    ).toBe(SC.index)
  })

  it('falls back to any text track when nothing is Chinese', () => {
    expect(pickDefaultTrack([JPN])?.index).toBe(JPN.index)
  })

  it('never picks a bitmap track (it cannot become cues)', () => {
    expect(pickDefaultTrack([PGS])).toBeNull()
    expect(pickDefaultTrack([PGS, JPN])?.index).toBe(JPN.index)
    expect(pickDefaultTrack([])).toBeNull()
  })

  it('uses a forced track only when nothing else exists', () => {
    // A forced track only carries foreign-dialogue lines — most of the
    // episode would show nothing.
    expect(pickDefaultTrack([FORCED, JPN])?.index).toBe(JPN.index)
    expect(pickDefaultTrack([FORCED])?.index).toBe(FORCED.index)
  })

  it('recognises Chinese by title when the language tag is missing', () => {
    const untagged: EmbeddedTrack = { ...TC, language: null, title: '简体' }
    expect(isChinese(untagged)).toBe(true)
    expect(pickDefaultTrack([JPN, untagged])?.index).toBe(untagged.index)
  })
})

describe('labels', () => {
  it('names a language we know, uppercases one we do not', () => {
    expect(languageLabel('chi')).toBe('中文')
    expect(languageLabel('jpn')).toBe('日本語')
    expect(languageLabel('fra')).toBe('FRA')
    expect(languageLabel(null)).toBeNull()
  })

  it('prefers the stream title over the language name', () => {
    expect(trackName(SC)).toBe('Chinese Simplified')
    expect(trackName(JPN)).toBe('日本語')
    // No title and no language we know → the codec is still better than "".
    expect(trackName({ ...JPN, language: null, codec: 'mov_text' })).toBe(
      'mov_text'
    )
  })

  it('shows the codec so two same-language tracks stay distinguishable', () => {
    expect(trackLabel(SC)).toBe('Chinese Simplified · subrip')
    expect(trackLabel(FORCED)).toBe('简体（强制） · subrip · 强制')
  })
})

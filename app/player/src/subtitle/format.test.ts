import { describe, expect, it } from 'vitest'
import { parseClock, parseSubtitleText, serializeSrt } from './format'

const texts = (cues: { text: string }[]) => cues.map((c) => c.text)

describe('parseClock', () => {
  it('reads SRT, VTT and ASS timestamps', () => {
    expect(parseClock('00:01:02,500')).toBe(62.5)
    expect(parseClock('00:01:02.050')).toBe(62.05)
    expect(parseClock('01:02.5')).toBe(62.5) // VTT without hours
    expect(parseClock('0:01:02.05')).toBe(62.05) // ASS centiseconds
    expect(parseClock('10:00:00.00')).toBe(36000)
    expect(parseClock('nope')).toBeNull()
    expect(parseClock('00:61:00,000')).toBeNull()
  })
})

describe('SRT', () => {
  it('parses CRLF, BOM, and multi-line cues', () => {
    const raw =
      '﻿1\r\n00:00:01,000 --> 00:00:02,500\r\n第一行\r\n第二行\r\n\r\n2\r\n00:00:03,000 --> 00:00:04,000\r\nhello\r\n'
    const cues = parseSubtitleText(raw, 'a.srt')
    expect(cues).toEqual([
      { start: 1, end: 2.5, text: '第一行\n第二行' },
      { start: 3, end: 4, text: 'hello' },
    ])
  })

  it('survives a missing blank line between cues', () => {
    const raw =
      '1\n00:00:01,000 --> 00:00:02,000\nfirst\n2\n00:00:03,000 --> 00:00:04,000\nsecond\n'
    expect(texts(parseSubtitleText(raw, 'a.srt'))).toEqual(['first', 'second'])
  })

  it('keeps {\\an8} as top placement and strips markup', () => {
    const raw =
      '1\n00:00:01,000 --> 00:00:02,000\n{\\an8}<font color="#ffff00">招牌</font>\n\n2\n00:00:03,000 --> 00:00:04,000\n<i>画外音</i>\n\n3\n00:00:05,000 --> 00:00:06,000\n<b>粗</b> &amp; 细 &lt;3\n'
    const cues = parseSubtitleText(raw, 'a.srt')
    expect(cues[0]).toMatchObject({ text: '招牌', align: 8 })
    expect(cues[1]).toMatchObject({ text: '画外音', italic: true })
    expect(cues[2].text).toBe('粗 & 细 <3')
    expect(cues[2].align).toBeUndefined()
  })

  it('reads what ffmpeg makes of an ASS track (font tags, \\an8)', () => {
    // `ffmpeg -f srt` output for an embedded ASS stream.
    const raw =
      '1\n00:00:02,021 --> 00:00:03,021\n<font face="Source Han Sans SC" size="60" color="#ffff00"><i>{\\an8}招牌：拉面店</i></font>\n'
    expect(parseSubtitleText(raw, 'x.srt')[0]).toMatchObject({
      text: '招牌：拉面店',
      align: 8,
    })
  })

  it('drops empty and inverted cues', () => {
    const raw =
      '1\n00:00:02,000 --> 00:00:01,000\nbackwards\n\n2\n00:00:03,000 --> 00:00:04,000\n<i></i>\n'
    expect(parseSubtitleText(raw, 'a.srt')).toEqual([])
  })
})

describe('WebVTT', () => {
  it('reads identifiers, settings, NOTE blocks and voice tags', () => {
    const raw = `WEBVTT

NOTE this is a comment
spanning lines

intro
00:01.000 --> 00:02.000 line:10% align:center
<v Roger>Top line</v>

00:00:03.000 --> 00:00:04.000
<c.yellow>plain</c> <00:00:03.500>karaoke
`
    const cues = parseSubtitleText(raw, 'a.vtt')
    expect(cues).toEqual([
      { start: 1, end: 2, text: 'Top line', align: 8 },
      { start: 3, end: 4, text: 'plain karaoke' },
    ])
  })
})

/** A fansub-shaped script: styles BEFORE events, both with Format lines. */
const FANSUB = `[Script Info]
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080
WrapStyle: 0

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: CN,Source Han Sans SC,72,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,3,1,2,20,20,60,1
Style: JP,Source Han Sans JP,48,&H00E0E0E0,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,1,2,20,20,15,1
Style: Sign,Source Han Sans SC,60,&H0000FFFF,&H000000FF,&H00000000,&H00000000,0,-1,0,0,100,100,0,0,1,2,0,8,20,20,30,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:01.00,0:00:04.00,CN,,0,0,0,,中文台词一{TL注：这是注释}
Dialogue: 0,0:00:01.00,0:00:04.00,JP,,0,0,0,,日本語のセリフ一
Dialogue: 0,0:00:02.00,0:00:03.00,Sign,,0,0,0,,{\\pos(960,200)}招牌：拉面店
Dialogue: 0,0:00:05.00,0:00:07.00,CN,,0,0,0,,{\\an8}顶部台词{\\i1}斜体{\\i0}\\N第二行
Dialogue: 0,0:00:05.00,0:00:07.00,Sign,,0,0,0,,{\\p1}m 0 0 l 100 0 100 100 0 100{\\p0}
Comment: 0,0:00:05.00,0:00:07.00,CN,,0,0,0,,这是注释行
Dialogue: 0,0:00:08.00,0:00:09.50,CN,,0,0,0,,{\\c&H0000FF&}红色{\\r}普通\\n软换行
`

describe('ASS', () => {
  it('parses a script whose [V4+ Styles] Format precedes [Events]', () => {
    // Regression: the styles' Format line was taken for the events' one, so
    // every real .ass file parsed to ZERO cues.
    const cues = parseSubtitleText(FANSUB, 'ep01.ass')
    expect(texts(cues)).toEqual([
      '中文台词一',
      '日本語のセリフ一',
      '招牌：拉面店',
      '顶部台词斜体\n第二行',
      '红色普通 软换行',
    ])
  })

  it('keeps the layout the track asks for', () => {
    const [cn, jp, sign, top] = parseSubtitleText(FANSUB, 'ep01.ass')
    // The main dialogue style defines 1.0; the Japanese line is smaller.
    expect(cn.scale).toBeUndefined()
    expect(jp.scale).toBeCloseTo(48 / 72, 2)
    // Stacking order comes from the margins: Chinese sits above Japanese.
    expect(cn.marginV).toBe(60)
    expect(jp.marginV).toBe(15)
    // \pos → fractions of the script resolution, alignment from the style.
    expect(sign.pos).toEqual({ x: 0.5, y: 200 / 1080 })
    expect(sign.align).toBe(8)
    expect(sign.italic).toBe(true)
    expect(top.align).toBe(8)
  })

  it('never shows comments, drawings or Comment: events', () => {
    const all = texts(parseSubtitleText(FANSUB, 'ep01.ass')).join('|')
    expect(all).not.toContain('TL注')
    expect(all).not.toContain('m 0 0')
    expect(all).not.toContain('这是注释行')
    expect(all).not.toContain('\\')
  })

  it('handles commas in text and a Format-less events section', () => {
    const raw = `[Script Info]
PlayResY: 720

[Events]
Dialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,好, 我知道了, 走吧
`
    expect(texts(parseSubtitleText(raw, 'a.ass'))).toEqual([
      '好, 我知道了, 走吧',
    ])
  })

  it('reads legacy SSA (v4) alignment', () => {
    const raw = `[Script Info]
ScriptType: v4.00

[V4 Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, TertiaryColour, BackColour, Bold, Italic, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, AlphaLevel, Encoding
Style: Top,Arial,20,16777215,65535,65535,0,0,0,1,2,0,6,10,10,10,0,1

[Events]
Format: Marked, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: Marked=0,0:00:01.00,0:00:02.00,Top,,0000,0000,0000,,标题
`
    expect(parseSubtitleText(raw, 'a.ssa')[0]).toMatchObject({
      text: '标题',
      align: 8,
    })
  })

  it('collapses stacked karaoke copies of one line', () => {
    const raw = `[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:01.00,0:00:02.00,OP,,0,0,0,,{\\blur3\\3c&HFFFFFF&}歌词
Dialogue: 1,0:00:01.00,0:00:02.00,OP,,0,0,0,,{\\k20}歌{\\k30}词
Dialogue: 2,0:00:01.00,0:00:02.00,OP,,0,0,0,,{\\t(0,300,\\fscx120)}歌词
`
    expect(texts(parseSubtitleText(raw, 'a.ass'))).toEqual(['歌词'])
  })

  it('takes the start of a \\move, ignores tags inside \\t', () => {
    const raw = `[Script Info]
PlayResX: 1280
PlayResY: 720

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,{\\t(0,500,\\an8\\fs80)\\move(640,360,640,100)}移动
`
    const [cue] = parseSubtitleText(raw, 'a.ass')
    expect(cue.pos).toEqual({ x: 0.5, y: 0.5 })
    expect(cue.align).toBeUndefined()
  })

  it('sniffs an ASS script saved with the wrong extension', () => {
    expect(texts(parseSubtitleText(FANSUB, 'ep01.txt'))).toHaveLength(5)
  })
})

describe('serializeSrt', () => {
  it('round-trips plain cues', () => {
    const cues = [
      { start: 1.5, end: 2.25, text: '一' },
      { start: 59.9996, end: 61, text: '二\n三' },
    ]
    const back = parseSubtitleText(serializeSrt(cues), 'x.srt')
    expect(texts(back)).toEqual(['一', '二\n三'])
    expect(back[1].start).toBe(60)
  })
})

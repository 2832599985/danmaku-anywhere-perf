import { describe, expect, it } from 'vitest'
import { decodeTextBytes } from './decodeText'

const hex = (value: string): Uint8Array =>
  Uint8Array.from(value.match(/../g) ?? [], (pair) => Number.parseInt(pair, 16))

/** ASCII framing around the legacy bytes, the way an SRT file carries them. */
const srt = (body: Uint8Array): Uint8Array => {
  const head = new TextEncoder().encode(
    '1\r\n00:00:01,000 --> 00:00:02,000\r\n'
  )
  const out = new Uint8Array(head.length + body.length + 2)
  out.set(head)
  out.set(body, head.length)
  out.set([0x0d, 0x0a], head.length + body.length)
  return out
}

const utf16 = (text: string, littleEndian: boolean, bom: boolean) => {
  const out = new Uint8Array((text.length + (bom ? 1 : 0)) * 2)
  const view = new DataView(out.buffer)
  let offset = 0
  if (bom) {
    view.setUint16(0, 0xfeff, littleEndian)
    offset = 2
  }
  for (let i = 0; i < text.length; i += 1) {
    view.setUint16(offset + i * 2, text.charCodeAt(i), littleEndian)
  }
  return out
}

// Produced with iconv from the UTF-8 text in each comment.
// 你到底想干什么？这家拉面店的汤头真是绝品，师父请收我为徒吧
const GBK =
  'c4e3b5bdb5d7cfebb8c9cab2c3b4a3bfd5e2bcd2c0adc3e6b5eab5c4ccc0cdb7d5e6cac7bef8c6b7a3accaa6b8b8c7ebcad5ced2ceaacdbdb0c9'
// 這家拉麵店的湯頭真是絕品，露營車裡居然還有廚房
const BIG5 =
  'b36fae61a9d4c4d1a9b1aabab4f6c059af75ac4fb5b4ab7ea141c553c0e7a8aeb8cca97eb54dc1d9a6b3bc70a9d0'
// このラーメン屋のスープは絶品だ。みんなを守りたいだけだ
const SHIFT_JIS =
  '82b182cc8389815b8381839389ae82cc8358815b837682cd90e2956982be814282dd82f182c882f08ee782e882bd82a282be82af82be'

describe('decodeTextBytes', () => {
  it('reads GBK, which is ALSO valid Big5, as GBK', () => {
    const text = decodeTextBytes(srt(hex(GBK)))
    expect(text).toContain('这家拉面店的汤头真是绝品')
  })

  it('reads Big5, which is also valid GB18030, as Big5', () => {
    expect(decodeTextBytes(srt(hex(BIG5)))).toContain(
      '這家拉麵店的湯頭真是絕品'
    )
  })

  it('reads Shift_JIS', () => {
    expect(decodeTextBytes(srt(hex(SHIFT_JIS)))).toContain(
      'このラーメン屋のスープは絶品だ'
    )
  })

  it('reads UTF-8 with and without a BOM', () => {
    const plain = new TextEncoder().encode('字幕：中文')
    expect(decodeTextBytes(plain)).toBe('字幕：中文')
    const withBom = new Uint8Array([0xef, 0xbb, 0xbf, ...plain])
    expect(decodeTextBytes(withBom)).toBe('字幕：中文')
  })

  it('keeps UTF-8 that is merely cut off mid-character', () => {
    const bytes = new TextEncoder().encode(
      '第一句台词，第二句台词，第三句台词。'
    )
    const text = decodeTextBytes(bytes.subarray(0, bytes.length - 1))
    expect(text.startsWith('第一句台词，第二句台词，第三句台词')).toBe(true)
  })

  it('reads UTF-16 with a BOM and without one', () => {
    const text = '1\n00:00:01,000 --> 00:00:02,000\n字幕\n'
    expect(decodeTextBytes(utf16(text, true, true))).toBe(text)
    expect(decodeTextBytes(utf16(text, false, true))).toBe(text)
    expect(decodeTextBytes(utf16(text, true, false))).toBe(text)
    expect(decodeTextBytes(utf16(text, false, false))).toBe(text)
  })

  it('accepts an ArrayBuffer', () => {
    const bytes = new TextEncoder().encode('ok')
    expect(decodeTextBytes(bytes.buffer)).toBe('ok')
  })
})

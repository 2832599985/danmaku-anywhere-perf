/**
 * Decode a text file's bytes without knowing its encoding.
 *
 * Chinese subtitle (and danmaku) files come in whatever the uploader's editor
 * saved: UTF-8 with or without a BOM, UTF-16 (Aegisub on Windows), and a great
 * many legacy GBK / Big5 files — Japanese ones in Shift_JIS. Reading them all
 * as UTF-8 turns everything but the first kind into replacement characters.
 *
 * Order: a byte-order mark decides outright; UTF-16 without a BOM shows itself
 * through NUL bytes; UTF-8 wins when the bytes are (nearly) valid UTF-8 —
 * legacy double-byte text practically never is. Otherwise each legacy encoding
 * reads the bytes by its own structure, and the one that finds the largest
 * share of its COMMON characters wins. Validity alone cannot decide: GBK text
 * is also valid Big5 (and valid GB18030 accepts almost anything), but read
 * the wrong way it lands on rarely used characters, while read the right way
 * nearly every character is in the encoding's common block.
 */

interface Tally {
  /** double-byte (non-ASCII) characters read */
  total: number
  /** how many of them fall in the encoding's common block */
  common: number
}

/**
 * GBK / GB18030. Common = GB2312 level 1 (the 3,755 most used hanzi, lead
 * bytes B0–D7) and the punctuation rows A1–A3.
 */
const walkGbk = (b: Uint8Array): Tally | null => {
  let total = 0
  let common = 0
  for (let i = 0; i < b.length; ) {
    const x = b[i]
    if (x < 0x80) {
      i += 1
      continue
    }
    if (x === 0x80 || x === 0xff) return null
    const y = b[i + 1]
    if (y === undefined) return null
    if (y >= 0x30 && y <= 0x39) {
      // GB18030 four-byte sequence: valid, never common.
      total += 1
      i += 4
      continue
    }
    if (y < 0x40 || y === 0x7f || y === 0xff) return null
    total += 1
    if (y >= 0xa1 && ((x >= 0xb0 && x <= 0xd7) || (x >= 0xa1 && x <= 0xa3))) {
      common += 1
    }
    i += 2
  }
  return { total, common }
}

/** Big5. Common = 常用字 (lead bytes A4–C6) and the symbol rows A1–A3. */
const walkBig5 = (b: Uint8Array): Tally | null => {
  let total = 0
  let common = 0
  for (let i = 0; i < b.length; ) {
    const x = b[i]
    if (x < 0x80) {
      i += 1
      continue
    }
    if (x < 0x81 || x > 0xfe) return null
    const y = b[i + 1]
    if (
      y === undefined ||
      !((y >= 0x40 && y <= 0x7e) || (y >= 0xa1 && y <= 0xfe))
    ) {
      return null
    }
    total += 1
    if ((x >= 0xa4 && x <= 0xc6) || (x >= 0xa1 && x <= 0xa3)) common += 1
    i += 2
  }
  return { total, common }
}

/**
 * Shift_JIS. Common = symbols and kana (lead bytes 81–84) and JIS level-1
 * kanji (88–98). Half-width katakana are valid but rare in subtitles.
 */
const walkShiftJis = (b: Uint8Array): Tally | null => {
  let total = 0
  let common = 0
  for (let i = 0; i < b.length; ) {
    const x = b[i]
    if (x < 0x80) {
      i += 1
      continue
    }
    if (x >= 0xa1 && x <= 0xdf) {
      total += 1
      i += 1
      continue
    }
    if ((x >= 0x81 && x <= 0x9f) || (x >= 0xe0 && x <= 0xfc)) {
      const y = b[i + 1]
      if (y === undefined || y < 0x40 || y === 0x7f || y > 0xfc) return null
      total += 1
      if ((x >= 0x81 && x <= 0x84) || (x >= 0x88 && x <= 0x98)) common += 1
      i += 2
      continue
    }
    return null
  }
  return { total, common }
}

/** Legacy candidates, in tie-break order (a Simplified-Chinese user first). */
const LEGACY: ReadonlyArray<{
  encoding: string
  walk: (bytes: Uint8Array) => Tally | null
}> = [
  { encoding: 'gb18030', walk: walkGbk },
  { encoding: 'big5', walk: walkBig5 },
  { encoding: 'shift_jis', walk: walkShiftJis },
]

/** UTF-16 without a BOM: NUL bytes fall almost only on one side of each pair. */
const sniffUtf16 = (bytes: Uint8Array): 'utf-16le' | 'utf-16be' | null => {
  const sample = Math.min(bytes.length - (bytes.length % 2), 4096)
  if (sample < 4) return null
  let evenZeros = 0
  let oddZeros = 0
  for (let i = 0; i < sample; i += 2) {
    if (bytes[i] === 0) evenZeros += 1
    if (bytes[i + 1] === 0) oddZeros += 1
  }
  const pairs = sample / 2
  if (oddZeros > pairs * 0.3 && evenZeros < pairs * 0.05) return 'utf-16le'
  if (evenZeros > pairs * 0.3 && oddZeros < pairs * 0.05) return 'utf-16be'
  return null
}

/**
 * UTF-8 text, or null when the bytes are not UTF-8. A handful of broken
 * sequences (a file cut off mid-character, one bad line) still counts as
 * UTF-8; a legacy file read as UTF-8 breaks on nearly every character.
 */
const asUtf8 = (bytes: Uint8Array): string | null => {
  const text = new TextDecoder('utf-8').decode(bytes)
  let broken = 0
  let nonAscii = 0
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0
    if (code === 0xfffd) broken += 1
    else if (code > 0x7f) nonAscii += 1
  }
  return broken <= Math.max(2, nonAscii * 0.01) ? text : null
}

/** Text of a file, whatever encoding it was saved in. */
export const decodeTextBytes = (input: ArrayBuffer | Uint8Array): string => {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input)
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return new TextDecoder('utf-8').decode(bytes.subarray(3))
  }
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder('utf-16le').decode(bytes.subarray(2))
  }
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    return new TextDecoder('utf-16be').decode(bytes.subarray(2))
  }
  const utf16 = sniffUtf16(bytes)
  if (utf16) return new TextDecoder(utf16).decode(bytes)

  const utf8 = asUtf8(bytes)
  if (utf8 !== null) return utf8

  let best: string | null = null
  let bestShare = -1
  for (const { encoding, walk } of LEGACY) {
    const tally = walk(bytes)
    if (!tally || tally.total === 0) continue
    const share = tally.common / tally.total
    if (share > bestShare) {
      best = encoding
      bestShare = share
    }
  }
  return new TextDecoder(best ?? 'utf-8').decode(bytes)
}

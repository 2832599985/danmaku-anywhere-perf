import type { ParsedComment, TimedComment } from '../parser'

export const applyParsedChunk = (
  target: TimedComment[],
  startIndex: number,
  parsed: Array<ParsedComment | undefined>
) => {
  for (let i = 0; i < parsed.length; i += 1) {
    const entry = target[startIndex + i]
    const p = parsed[i]
    if (entry && p) {
      entry.parsed = p
    }
  }
}

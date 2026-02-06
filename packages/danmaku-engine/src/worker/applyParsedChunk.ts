import type { ParsedComment, TimedComment } from '../parser'

export const applyParsedChunk = (
  target: TimedComment[],
  startIndex: number,
  parsed: ParsedComment[]
) => {
  for (let i = 0; i < parsed.length; i += 1) {
    const entry = target[startIndex + i]
    if (entry) {
      entry.parsed = parsed[i]
    }
  }
}

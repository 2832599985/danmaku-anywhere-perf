import type { ParsedComment, TimedComment } from '../parser'

export const applyParsedChunk = (
  target: TimedComment[],
  startIndex: number,
  parsed: Array<ParsedComment | undefined>
) => {
  for (let i = 0; i < parsed.length; i += 1) {
    const entry = target[startIndex + i]
    const p = parsed[i]
    if (!entry) continue
    if (p) {
      entry.parsed = p
      // If we previously marked an error but later got a valid parsed entry, clear it.
      entry.parseError = undefined
    } else {
      // Undefined means "parse failed" for this index (worker/remote catches per-item).
      entry.parseError = true
    }
  }
}

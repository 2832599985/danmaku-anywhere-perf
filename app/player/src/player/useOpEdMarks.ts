import type { CommentEntity } from '@danmaku-anywhere/danmaku-converter'
import { useMemo } from 'react'

/**
 * Infer OP-end and ED-start timestamps from danmaku density. Heuristic:
 * OP ends where chatter spikes (first bin ≥ 3× average in [60,240]s);
 * ED starts where it dies off (first bin ≤ 30% peak in the final 15%).
 * Returns null for each when the signal is too weak.
 */
export const useOpEdMarks = (
  comments: CommentEntity[],
  duration: number
): { opEnd: number | null; edStart: number | null } => {
  const durationKey = Math.round(duration)
  return useMemo(() => {
    if (durationKey < 120 || comments.length < 40) {
      return { opEnd: null, edStart: null }
    }
    const BIN = 10
    const count = Math.ceil(durationKey / BIN)
    const bins = new Array<number>(count).fill(0)
    for (const c of comments) {
      const t = Number.parseFloat(c.p)
      if (!Number.isFinite(t) || t < 0 || t >= durationKey) continue
      bins[Math.floor(t / BIN)] += 1
    }
    const avg = comments.length / count

    let opEnd: number | null = null
    const from = Math.floor(60 / BIN)
    const to = Math.min(count, Math.floor(240 / BIN))
    for (let i = from; i < to; i++) {
      if (bins[i] >= avg * 3) {
        opEnd = i * BIN
        break
      }
    }

    let edStart: number | null = null
    const tailFrom = Math.floor(count * 0.85)
    let peak = 0
    for (const v of bins) if (v > peak) peak = v
    for (let i = tailFrom; i < count; i++) {
      if (bins[i] <= peak * 0.3) {
        edStart = i * BIN
        break
      }
    }

    return { opEnd, edStart }
  }, [durationKey, comments])
}

import { translateLines } from '@danmaku-anywhere/danmaku-provider/genAi'
import { ensureConfigured } from '@/danmaku/ddp'
import type { SubtitleCue } from './types'

/**
 * Batch subtitle translation (ja→zh and any→zh) through the free built-in AI
 * proxy. The endpoint enforces a 1:1 line mapping server-side; per-batch
 * failures keep the SOURCE text silently — translation must never break
 * subtitle availability (same contract as danmaku/ai.ts).
 */

const BATCH_SIZE = 40 // server-side per-request limit

export interface TranslateProgress {
  /** completed batches */
  done: number
  total: number
}

export const translateCues = async (
  cues: SubtitleCue[],
  onProgress?: (progress: TranslateProgress) => void
): Promise<SubtitleCue[]> => {
  ensureConfigured()
  const source = cues.map((cue) => cue.text)
  const translated = [...source]
  const batches: number[][] = []
  for (let i = 0; i < source.length; i += BATCH_SIZE) {
    batches.push(
      Array.from(
        { length: Math.min(BATCH_SIZE, source.length - i) },
        (_, j) => i + j
      )
    )
  }

  let done = 0
  for (const indices of batches) {
    const result = await translateLines(indices.map((i) => source[i]))
    if (result.success) {
      indices.forEach((originalIndex, j) => {
        const line = result.data.lines[j]?.trim()
        if (line) translated[originalIndex] = line
      })
    }
    // A failed batch keeps its source lines; keep going so later batches
    // still translate.
    done += 1
    onProgress?.({ done, total: batches.length })
  }
  return cues.map((cue, i) => ({ ...cue, text: translated[i] }))
}

import type { SkipTarget } from '@/content/player/videoSkip/SkipTarget'

export interface AutoSkipOpOptions {
  /**
   * Only auto-skip when the target starts within this time window.
   */
  startMaxSeconds: number
  /**
   * Reject very short ranges to reduce false positives.
   */
  minDurationSeconds: number
  /**
   * Reject very long ranges to reduce false positives.
   */
  maxDurationSeconds: number
}

export const defaultAutoSkipOpOptions: AutoSkipOpOptions = {
  startMaxSeconds: 120,
  minDurationSeconds: 30,
  maxDurationSeconds: 180,
}

export function shouldAutoSkipOp(
  target: SkipTarget,
  currentTime: number,
  hasAutoSkippedOp: boolean,
  options?: Partial<AutoSkipOpOptions>
): boolean {
  if (hasAutoSkippedOp) return false
  if (target.isClosed()) return false

  const opts = { ...defaultAutoSkipOpOptions, ...options }

  if (target.startTime > opts.startMaxSeconds) return false

  const duration = target.endTime - target.startTime
  if (
    duration < opts.minDurationSeconds ||
    duration > opts.maxDurationSeconds
  ) {
    return false
  }

  // Only auto-skip when we're inside the range; avoid edge case at the exact end time.
  if (!target.isInRange(currentTime)) return false
  if (currentTime >= target.endTime) return false

  return true
}

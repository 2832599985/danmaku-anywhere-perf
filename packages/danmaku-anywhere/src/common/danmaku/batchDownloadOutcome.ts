export type BatchDownloadOutcome = 'success' | 'cancelled' | 'failed'

export type ResolveBatchDownloadOutcomeParams = {
  total: number
  completed: number
  cancelled: boolean
  error?: unknown
}

export type ResolvedBatchDownloadOutcome = {
  outcome: BatchDownloadOutcome
  completed: number
  total: number
}

export const resolveBatchDownloadOutcome = ({
  total,
  completed,
  cancelled,
  error,
}: ResolveBatchDownloadOutcomeParams): ResolvedBatchDownloadOutcome => {
  // Defensive normalization for unexpected values.
  const safeTotal = Math.max(0, Math.trunc(total))
  const safeCompleted = Math.min(Math.max(0, Math.trunc(completed)), safeTotal)

  if (error !== undefined) {
    return {
      outcome: 'failed',
      completed: safeCompleted,
      total: safeTotal,
    }
  }

  if (cancelled || safeCompleted < safeTotal) {
    return {
      outcome: 'cancelled',
      completed: safeCompleted,
      total: safeTotal,
    }
  }

  return {
    outcome: 'success',
    completed: safeCompleted,
    total: safeTotal,
  }
}

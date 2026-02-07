import { describe, expect, it } from 'vitest'
import { resolveBatchDownloadOutcome } from './batchDownloadOutcome'

describe('resolveBatchDownloadOutcome', () => {
  it('returns success when all episodes are completed', () => {
    const result = resolveBatchDownloadOutcome({
      total: 3,
      completed: 3,
      cancelled: false,
    })

    expect(result).toEqual({
      outcome: 'success',
      completed: 3,
      total: 3,
    })
  })

  it('returns cancelled when user cancels midway', () => {
    const result = resolveBatchDownloadOutcome({
      total: 5,
      completed: 2,
      cancelled: true,
    })

    expect(result).toEqual({
      outcome: 'cancelled',
      completed: 2,
      total: 5,
    })
  })

  it('returns failed when an error occurs', () => {
    const result = resolveBatchDownloadOutcome({
      total: 5,
      completed: 2,
      cancelled: false,
      error: new Error('boom'),
    })

    expect(result).toEqual({
      outcome: 'failed',
      completed: 2,
      total: 5,
    })
  })

  it('returns success for zero tasks', () => {
    const result = resolveBatchDownloadOutcome({
      total: 0,
      completed: 0,
      cancelled: false,
    })

    expect(result).toEqual({
      outcome: 'success',
      completed: 0,
      total: 0,
    })
  })

  it('returns cancelled when completed is less than total without error', () => {
    const result = resolveBatchDownloadOutcome({
      total: 10,
      completed: 9,
      cancelled: false,
    })

    expect(result).toEqual({
      outcome: 'cancelled',
      completed: 9,
      total: 10,
    })
  })
})

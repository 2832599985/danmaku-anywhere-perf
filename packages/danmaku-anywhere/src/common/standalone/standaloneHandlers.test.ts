import { describe, expect, it } from 'vitest'
import { standaloneBackgroundHandlers } from '@/common/standalone/standaloneHandlers'

describe('standalone background handlers', () => {
  it('returns an empty bookmark collection instead of undefined', () => {
    expect(standaloneBackgroundHandlers.bookmarkGetAll?.(undefined)).toEqual([])
  })
})

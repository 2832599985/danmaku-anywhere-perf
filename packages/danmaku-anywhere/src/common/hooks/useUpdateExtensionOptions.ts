import { useCallback } from 'react'
import type { ExtensionOptions } from '@/common/options/extensionOptions/schema'
import { useExtensionOptions } from '@/common/options/extensionOptions/useExtensionOptions'

/**
 * A write to chrome.storage only reaches the query cache after a round trip and
 * an invalidation, so two updates fired in quick succession both read the same
 * pre-write snapshot and the second silently reverts the first. Components that
 * replace a whole nested section (`playerOptions`, `theme`, ...) lose every
 * sibling field that way, including fields written by other components.
 *
 * Remembering the last value written and rebasing on it closes that window.
 * Module scope on purpose: the clobbering happens across components, not just
 * within one.
 */
let pendingOptions: ExtensionOptions | null = null
let inFlightWrites = 0

/**
 * Returns an updater that always sees the freshest options, including writes
 * that have not round-tripped through storage yet.
 */
export const useUpdateExtensionOptions = () => {
  const { data, partialUpdate } = useExtensionOptions()

  return useCallback(
    async (update: (prev: ExtensionOptions) => Partial<ExtensionOptions>) => {
      const base = pendingOptions ?? data
      const next = { ...base, ...update(base) }

      pendingOptions = next
      inFlightWrites++

      try {
        // A complete options object, so `partialUpdate`'s own stale base is
        // fully overwritten rather than merged into.
        await partialUpdate(next)
      } finally {
        inFlightWrites--
        if (inFlightWrites === 0) {
          pendingOptions = null
        }
      }
    },
    [data, partialUpdate]
  )
}

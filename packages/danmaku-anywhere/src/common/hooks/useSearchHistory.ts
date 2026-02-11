import { useCallback } from 'react'
import { useExtStorage } from '@/common/storage/hooks/useExtStorage'

const SEARCH_HISTORY_KEY = 'searchHistory'
const MAX_HISTORY_SIZE = 10

export const useSearchHistory = () => {
  const storage = useExtStorage<string[]>(SEARCH_HISTORY_KEY, {
    storageType: 'local',
    queryOptions: {
      placeholderData: [],
    },
  })

  const history = storage.data ?? []

  const addEntry = useCallback(
    (keyword: string) => {
      const trimmed = keyword.trim()
      if (!trimmed) return
      const current = storage.data ?? []
      const filtered = current.filter((item) => item !== trimmed)
      const updated = [trimmed, ...filtered].slice(0, MAX_HISTORY_SIZE)
      storage.update.mutate(updated)
    },
    [storage.data, storage.update]
  )

  const removeEntry = useCallback(
    (keyword: string) => {
      const current = storage.data ?? []
      const updated = current.filter((item) => item !== keyword)
      storage.update.mutate(updated)
    },
    [storage.data, storage.update]
  )

  const clearHistory = useCallback(() => {
    storage.update.mutate([])
  }, [storage.update])

  return {
    history,
    addEntry,
    removeEntry,
    clearHistory,
    isLoading: storage.isLoading,
  }
}

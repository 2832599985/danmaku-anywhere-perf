import type {
  CustomSeason,
  DanmakuSourceType,
  Season,
} from '@danmaku-anywhere/danmaku-converter'
import { useCallback, useRef } from 'react'
import { useExtStorage } from '@/common/storage/hooks/useExtStorage'

export interface FavoriteSeason {
  seasonId: number
  title: string
  provider: DanmakuSourceType
  providerConfigId: string
  imageUrl?: string
}

const FAVORITES_KEY = 'favoriteSeasons'
const MAX_FAVORITES_SIZE = 50

export const useFavorites = () => {
  const storage = useExtStorage<FavoriteSeason[]>(FAVORITES_KEY, {
    storageType: 'local',
    queryOptions: {
      placeholderData: [],
    },
  })

  const favorites = storage.data ?? []

  const dataRef = useRef(favorites)
  dataRef.current = favorites

  const isFavorite = useCallback((seasonId: number) => {
    return dataRef.current.some((f) => f.seasonId === seasonId)
  }, [])

  const toggleFavorite = useCallback(
    (season: Season | CustomSeason) => {
      const current = dataRef.current
      const exists = current.some((f) => f.seasonId === season.id)
      if (exists) {
        const updated = current.filter((f) => f.seasonId !== season.id)
        storage.update.mutate(updated)
      } else {
        const entry: FavoriteSeason = {
          seasonId: season.id,
          title: season.title,
          provider: season.provider,
          providerConfigId: season.providerConfigId,
          imageUrl: season.imageUrl,
        }
        storage.update.mutate([entry, ...current].slice(0, MAX_FAVORITES_SIZE))
      }
    },
    [storage.update]
  )

  const removeFavorite = useCallback(
    (seasonId: number) => {
      const current = dataRef.current
      const updated = current.filter((f) => f.seasonId !== seasonId)
      storage.update.mutate(updated)
    },
    [storage.update]
  )

  const clearFavorites = useCallback(() => {
    storage.update.mutate([])
  }, [storage.update])

  return {
    favorites,
    isFavorite,
    toggleFavorite,
    removeFavorite,
    clearFavorites,
    isLoading: storage.isLoading,
  }
}

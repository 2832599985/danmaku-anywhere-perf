import { useCallback, useState } from 'react'
import type { PanelSize } from '@/content/controller/ui/constants/size'
import {
  CONTROLLER_WINDOW_CONTENT_HEIGHT,
  CONTROLLER_WINDOW_DEFAULT_WIDTH,
} from '@/content/controller/ui/constants/size'

const STORAGE_KEY = 'danmaku-anywhere:panelSize'

const defaultSize: PanelSize = {
  width: CONTROLLER_WINDOW_DEFAULT_WIDTH,
  height: CONTROLLER_WINDOW_CONTENT_HEIGHT,
}

const readFromStorage = (): PanelSize => {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return defaultSize
    const parsed = JSON.parse(raw) as Partial<PanelSize>
    if (
      typeof parsed.width === 'number' &&
      Number.isFinite(parsed.width) &&
      typeof parsed.height === 'number' &&
      Number.isFinite(parsed.height)
    ) {
      return { width: parsed.width, height: parsed.height }
    }
    return defaultSize
  } catch {
    return defaultSize
  }
}

const writeToStorage = (size: PanelSize) => {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(size))
  } catch {
    // ignore
  }
}

export const usePersistedPanelSize = () => {
  const [size, setSize] = useState<PanelSize>(() => readFromStorage())

  const updateSize = useCallback((newSize: PanelSize) => {
    setSize(newSize)
    writeToStorage(newSize)
  }, [])

  const resetSize = useCallback(() => {
    setSize(defaultSize)
    writeToStorage(defaultSize)
  }, [])

  return { size, updateSize, resetSize, defaultSize }
}

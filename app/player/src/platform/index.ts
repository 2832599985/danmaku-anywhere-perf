import { browserPlatform } from './browser'
import type { Platform } from './types'

const detectTauri = (): boolean =>
  typeof window !== 'undefined' &&
  ('__TAURI_INTERNALS__' in window || '__TAURI__' in window)

let cached: Platform | null = null

/**
 * The active platform adapter. Tauri's implementation is imported lazily so its
 * plugin modules are never evaluated in the browser build.
 */
export const getPlatform = (): Platform => {
  if (cached) return cached
  cached = browserPlatform
  return cached
}

/**
 * Resolve the platform adapter for the current host and run its async init
 * (fetch bridge in Tauri). Call once at startup before using the platform.
 */
export const initPlatform = async (): Promise<Platform> => {
  if (detectTauri()) {
    const { tauriPlatform } = await import('./tauri')
    cached = tauriPlatform
  } else {
    cached = browserPlatform
  }
  await cached.init()
  return cached
}

export type { PickedMedia, PickedText, Platform } from './types'

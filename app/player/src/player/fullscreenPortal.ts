import { createContext, useContext } from 'react'

/**
 * The element that becomes the fullscreen root (the player stage). MUI overlays
 * (Drawer/Dialog) portal to document.body by default, which sits OUTSIDE the
 * fullscreen element and is therefore hidden behind it in fullscreen. Consumers
 * render into this element instead (via each overlay's `root` slot `container`)
 * so settings/danmaku/playlist stay clickable while fullscreen.
 *
 * Value is null until the stage mounts; a null container falls back to
 * document.body, which is correct for the non-fullscreen case.
 */
export const FullscreenPortalContext = createContext<HTMLElement | null>(null)

export const useFullscreenPortalContainer = (): HTMLElement | null =>
  useContext(FullscreenPortalContext)

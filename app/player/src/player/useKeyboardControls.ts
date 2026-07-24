import { useEffect } from 'react'
import { usePlayerStore } from '@/store/playerStore'
import type { PlayerCommands } from './commands'

const isEditable = (el: EventTarget | null): boolean => {
  if (!(el instanceof HTMLElement)) return false
  const tag = el.tagName
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    el.isContentEditable
  )
}

/**
 * Global keyboard controls (acceptance 2b/2c + polish):
 *   ← / →  seek by playbackSettings.seekStepSec
 *   ↑ / ↓  volume by playbackSettings.volumeStep
 *   Space/k play-pause · f fullscreen · m mute · d danmaku on/off
 *   [ / ]  previous / next playlist entry
 * Ignored while typing in a form field. `commands` must be stable.
 */
export const useKeyboardControls = (commands: PlayerCommands): void => {
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey
      ) {
        return
      }
      if (isEditable(event.target)) return

      const { seekStepSec, volumeStep } =
        usePlayerStore.getState().playbackSettings

      switch (event.key) {
        case 'ArrowLeft':
          event.preventDefault()
          commands.seekBy(-seekStepSec)
          break
        case 'ArrowRight':
          event.preventDefault()
          commands.seekBy(seekStepSec)
          break
        case 'ArrowUp':
          event.preventDefault()
          commands.changeVolume(volumeStep)
          break
        case 'ArrowDown':
          event.preventDefault()
          commands.changeVolume(-volumeStep)
          break
        case ' ':
        case 'k':
          event.preventDefault()
          commands.togglePlay()
          break
        case 'f':
          event.preventDefault()
          commands.toggleFullscreen()
          break
        case 'm':
          event.preventDefault()
          commands.toggleMute()
          break
        case 'd':
          event.preventDefault()
          commands.toggleDanmaku()
          break
        case '[':
          event.preventDefault()
          commands.playlistPrev()
          break
        case ']':
          event.preventDefault()
          commands.playlistNext()
          break
        default:
          break
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [commands])
}

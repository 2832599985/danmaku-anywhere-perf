import { useEffect, useRef } from 'react'
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
 * True when the event came from inside an open overlay (settings/playlist
 * drawer, danmaku dialog, a menu). Those own the keyboard while they are up —
 * otherwise Space would toggle playback instead of the focused switch, and the
 * arrow keys would seek instead of moving through the list.
 */
const isInsideOverlay = (el: EventTarget | null): boolean =>
  el instanceof HTMLElement && el.closest('.MuiModal-root') !== null

/**
 * Global keyboard controls:
 *   ←        seek back by playbackSettings.seekStepSec
 *   → tap    seek forward by seekStepSec
 *   → hold   temporary playback rate (playbackSettings.holdSpeed); releasing
 *            the key restores the rate that was active BEFORE the hold, so a
 *            1.5× global rate resumes after a 3× hold. A tap is distinguished
 *            from a hold via the browser's key auto-repeat: the rate only
 *            engages on a repeated keydown, so a slow tap never loses its seek.
 *   ↑ / ↓    volume by playbackSettings.volumeStep
 *   Space/k  play-pause · f fullscreen · m mute · d danmaku on/off
 *   u upscale · c compare · [ / ] previous / next playlist entry
 * Ignored while typing in a form field or with an overlay open. `commands`
 * must be stable.
 */
export const useKeyboardControls = (commands: PlayerCommands): void => {
  // Held across re-registrations (the effect re-runs when `commands` changes)
  // so a hold in progress is never orphaned by a re-render.
  const holdingRightRef = useRef(false)
  const rateBeforeHoldRef = useRef<number | null>(null)

  useEffect(() => {
    const restoreHold = () => {
      if (!holdingRightRef.current) return
      const rate = rateBeforeHoldRef.current ?? 1
      holdingRightRef.current = false
      rateBeforeHoldRef.current = null
      commands.setPlaybackRate(rate)
      usePlayerStore.getState().showOsd(`${rate}×`, '▶')
    }

    const handler = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey
      ) {
        return
      }
      if (isEditable(event.target) || isInsideOverlay(event.target)) return

      const { seekStepSec, volumeStep, holdSpeed } =
        usePlayerStore.getState().playbackSettings

      // Right arrow: a tap seeks, an auto-repeated press holds a temp speed.
      // The first (non-repeat) keydown intentionally does nothing — keyup
      // decides whether it was a tap (seek) or the start of a hold (no-op,
      // the repeat already engaged the speed). This keeps a slow tap from
      // ever being swallowed by a fixed time threshold.
      if (event.key === 'ArrowRight') {
        event.preventDefault()
        if (event.repeat && !holdingRightRef.current) {
          // Snapshot the live rate NOW, before we overwrite it — setPlaybackRate
          // fires ratechange which mirrors the new rate into the store, so the
          // store can no longer be trusted as "the global rate" mid-hold.
          rateBeforeHoldRef.current =
            usePlayerStore.getState().playback.playbackRate
          holdingRightRef.current = true
          commands.setPlaybackRate(holdSpeed)
          usePlayerStore.getState().showOsd(`${holdSpeed}× 快进`, '⏩')
        }
        return
      }

      switch (event.key) {
        case 'ArrowLeft':
          event.preventDefault()
          commands.seekBy(-seekStepSec)
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
        case 'u':
          event.preventDefault()
          commands.toggleUpscale()
          break
        case 'c':
          event.preventDefault()
          commands.toggleCompare()
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

    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key !== 'ArrowRight') return
      if (isEditable(event.target) || isInsideOverlay(event.target)) return
      if (holdingRightRef.current) {
        restoreHold()
      } else {
        // A clean tap (no repeat ever fired) → forward seek.
        const { seekStepSec } = usePlayerStore.getState().playbackSettings
        commands.seekBy(seekStepSec)
      }
    }

    window.addEventListener('keydown', handler)
    window.addEventListener('keyup', onKeyUp)
    // If focus leaves the window mid-hold (e.g. Alt-Tab) the keyup may never
    // arrive; restore so the speed doesn't stick.
    window.addEventListener('blur', restoreHold)
    return () => {
      window.removeEventListener('keydown', handler)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', restoreHold)
      restoreHold()
    }
  }, [commands])
}

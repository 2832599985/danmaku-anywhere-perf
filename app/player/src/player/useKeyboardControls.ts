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

/** How often a held ← steps the playhead back (ms). */
export const REWIND_TICK_MS = 100

/**
 * Global keyboard controls:
 *   ← / → tap    seek by playbackSettings.seekStepSec
 *   → hold       temporary playback rate (playbackSettings.holdSpeed); releasing
 *                the key restores the rate that was active BEFORE the hold, so
 *                a 1.5× global rate resumes after a 3× hold.
 *   ← hold       rewind at the same speed. Chromium has no negative playback
 *                rate, so the video is paused and stepped back every
 *                REWIND_TICK_MS; releasing resumes if it was playing.
 *   A tap is told from a hold via the browser's key auto-repeat: the hold only
 *   engages on a repeated keydown, so a slow tap never loses its seek.
 *   ↑ / ↓    volume by playbackSettings.volumeStep
 *   Space/k  play-pause · f fullscreen · p mini player (小窗) · m mute · d danmaku on/off
 *   u upscale · c compare · [ / ] previous / next playlist entry
 * Keys are matched on `event.code` (the physical key), so CapsLock, Shift and
 * an active IME do not change what a key does. Ignored while typing in a form
 * field or with an overlay open. `commands` must be stable.
 */
export const useKeyboardControls = (commands: PlayerCommands): void => {
  // Held across re-registrations (the effect re-runs when `commands` changes)
  // so a hold in progress is never orphaned by a re-render.
  const holdingRightRef = useRef(false)
  const rateBeforeHoldRef = useRef<number | null>(null)
  const rewindTimerRef = useRef<number | null>(null)
  const playingBeforeRewindRef = useRef(false)
  // Arrow keys whose keydown we accepted. keyup only acts on these, so a
  // release we never saw pressed (Ctrl+→, a press that began inside a dialog)
  // can never seek.
  const armedArrowsRef = useRef(new Set<string>())

  useEffect(() => {
    const restoreForward = () => {
      if (!holdingRightRef.current) return
      const rate = rateBeforeHoldRef.current ?? 1
      holdingRightRef.current = false
      rateBeforeHoldRef.current = null
      commands.setPlaybackRate(rate)
      usePlayerStore.getState().showOsd(`${rate}×`, '▶')
    }

    const restoreRewind = () => {
      if (rewindTimerRef.current === null) return
      window.clearInterval(rewindTimerRef.current)
      rewindTimerRef.current = null
      if (playingBeforeRewindRef.current) commands.play()
      playingBeforeRewindRef.current = false
    }

    const restoreHolds = () => {
      armedArrowsRef.current.clear()
      restoreForward()
      restoreRewind()
    }

    const startRewind = (speed: number) => {
      const { playback } = usePlayerStore.getState()
      playingBeforeRewindRef.current = playback.playing
      commands.pause()
      let cursor = playback.currentTime
      const step = (speed * REWIND_TICK_MS) / 1000
      rewindTimerRef.current = window.setInterval(() => {
        if (cursor <= 0) return
        cursor = Math.max(0, cursor - step)
        commands.seekTo(cursor)
      }, REWIND_TICK_MS)
      usePlayerStore.getState().showOsd(`${speed}× 快退`, '⏪')
    }

    /** Nudge the subtitle timing offset; wraps the OSD feedback. */
    const subtitleOffset = (deltaMs: number) => {
      const s = usePlayerStore.getState()
      const next = Math.max(
        -30_000,
        Math.min(30_000, s.subtitleSettings.offset + deltaMs)
      )
      s.updateSubtitleSettings({ offset: next })
      s.showOsd(`字幕时轴 ${next >= 0 ? '+' : ''}${next}ms`, '⏱')
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

      const { holdSpeed } = usePlayerStore.getState().playbackSettings

      // ← / →: a tap seeks, an auto-repeated press holds. The first
      // (non-repeat) keydown intentionally does nothing — keyup decides
      // whether it was a tap (seek) or the end of a hold.
      if (event.code === 'ArrowRight' || event.code === 'ArrowLeft') {
        event.preventDefault()
        if (!event.repeat) {
          armedArrowsRef.current.add(event.code)
          return
        }
        if (!armedArrowsRef.current.has(event.code)) return
        if (event.code === 'ArrowRight' && !holdingRightRef.current) {
          // Snapshot the live rate NOW, before we overwrite it — setPlaybackRate
          // fires ratechange which mirrors the new rate into the store, so the
          // store can no longer be trusted as "the global rate" mid-hold.
          rateBeforeHoldRef.current =
            usePlayerStore.getState().playback.playbackRate
          holdingRightRef.current = true
          commands.setPlaybackRate(holdSpeed)
          usePlayerStore.getState().showOsd(`${holdSpeed}× 快进`, '⏩')
        }
        if (event.code === 'ArrowLeft' && rewindTimerRef.current === null) {
          startRewind(holdSpeed)
        }
        return
      }

      const { volumeStep } = usePlayerStore.getState().playbackSettings
      switch (event.code) {
        case 'ArrowUp':
          event.preventDefault()
          commands.changeVolume(volumeStep)
          break
        case 'ArrowDown':
          event.preventDefault()
          commands.changeVolume(-volumeStep)
          break
        case 'Space':
        case 'KeyK':
          event.preventDefault()
          commands.togglePlay()
          break
        case 'KeyF':
          event.preventDefault()
          commands.toggleFullscreen()
          break
        case 'KeyP':
          event.preventDefault()
          void commands.toggleMiniPlayer()
          break
        case 'Escape':
          // Esc already leaves fullscreen natively; give the mini window the
          // same "get me out" key.
          if (usePlayerStore.getState().miniPlayer) {
            event.preventDefault()
            void commands.toggleMiniPlayer()
          }
          break
        case 'KeyM':
          event.preventDefault()
          commands.toggleMute()
          break
        case 'KeyD':
          event.preventDefault()
          commands.toggleDanmaku()
          break
        case 'KeyU':
          event.preventDefault()
          commands.toggleUpscale()
          break
        case 'KeyC':
          event.preventDefault()
          commands.toggleCompare()
          break
        case 'KeyS':
          event.preventDefault()
          commands.toggleSubtitles()
          break
        case 'Comma':
        case 'Period':
          event.preventDefault()
          subtitleOffset(event.code === 'Period' ? 100 : -100)
          break
        case 'BracketLeft':
          event.preventDefault()
          commands.playlistPrev()
          break
        case 'BracketRight':
          event.preventDefault()
          commands.playlistNext()
          break
        default:
          break
      }
    }

    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code !== 'ArrowRight' && event.code !== 'ArrowLeft') return
      if (!armedArrowsRef.current.delete(event.code)) return
      if (event.code === 'ArrowRight') {
        if (holdingRightRef.current) {
          restoreForward()
          return
        }
      } else if (rewindTimerRef.current !== null) {
        restoreRewind()
        return
      }
      // A clean tap (no repeat ever fired) → seek.
      const { seekStepSec } = usePlayerStore.getState().playbackSettings
      commands.seekBy(event.code === 'ArrowRight' ? seekStepSec : -seekStepSec)
    }

    window.addEventListener('keydown', handler)
    window.addEventListener('keyup', onKeyUp)
    // If focus leaves the window mid-hold (e.g. Alt-Tab) the keyup may never
    // arrive; restore so the speed / rewind doesn't stick.
    window.addEventListener('blur', restoreHolds)
    return () => {
      window.removeEventListener('keydown', handler)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', restoreHolds)
      restoreHolds()
    }
  }, [commands])
}

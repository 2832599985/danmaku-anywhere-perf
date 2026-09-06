import { createContext, useContext } from 'react'

/**
 * Imperative player commands (FROZEN). PlayerHost owns the <video>/fullscreen
 * container and provides a concrete implementation through this context; UI
 * components call these instead of touching the DOM. Playback STATE flows the
 * other way, from <video> events into the Zustand store.
 */
export interface PlayerCommands {
  play(): void
  pause(): void
  togglePlay(): void
  /** absolute seek, clamped to [0, duration]. */
  seekTo(seconds: number): void
  /** relative seek; shows a seek OSD. */
  seekBy(deltaSeconds: number): void
  /** set volume 0..1 (also unmutes if > 0). */
  setVolume(volume: number): void
  /** relative volume change; unmutes and shows a volume OSD. */
  changeVolume(delta: number): void
  toggleMute(): void
  setPlaybackRate(rate: number): void
  toggleFullscreen(): void
  /** show/hide danmaku (mirrors settings.visible). */
  toggleDanmaku(): void
  /** flip the super-resolution master switch (keyboard U). */
  toggleUpscale(): void
  /** enter/exit the A/B enhanced-vs-original split (keyboard C). */
  toggleCompare(): void

  /** open the multi-select file picker and ADD the pick to the playlist. */
  openVideo(): Promise<void>
  /** load a video from an absolute path (Tauri drag-drop / recent); adds to playlist. */
  openVideoFromPath(path: string): void
  /** load a video that the browser already turned into a File/URL; adds to playlist. */
  openVideoFromFile(file: File): void
  /** add videos from absolute paths to the playlist (Tauri drop) and play the first. */
  openVideosFromPaths(paths: string[]): void
  /** add browser File objects to the playlist (drag-drop) and play the first. */
  openVideosFromFiles(files: File[]): void

  /** multi-select picker; append to the playlist without interrupting playback. */
  addVideosToPlaylist(): Promise<void>
  /** play the previous playlist entry (no-op at the start / when detached). */
  playlistPrev(): void
  /** play the next playlist entry (no-op at the end / when detached). */
  playlistNext(): void
  /** jump to a playlist entry by index (ignored when out of range). */
  playlistPlayAt(index: number): void
  /** show/hide the playlist drawer. */
  togglePlaylist(): void

  /** open the danmaku file picker, parse and mount. */
  loadDanmakuFromFile(): Promise<void>
  /** parse danmaku from raw file text (drag-drop / picker). */
  loadDanmakuFromText(text: string, name: string): Promise<void>
  /** read a danmaku file by absolute path (Tauri drag-drop). */
  loadDanmakuFromPath(path: string): Promise<void>

  /** show/hide subtitles (mirrors settings.visible; cues stay mounted). */
  toggleSubtitles(): void
  /** open the subtitle file picker (.srt/.ass/.vtt), parse and mount. */
  loadSubtitleFromFile(): Promise<void>
  /** parse a subtitle file from raw text (drag-drop). Throws when unparsable. */
  loadSubtitleFromText(text: string, name: string): Promise<void>
  /** read a subtitle file by absolute path (Tauri drag-drop). */
  loadSubtitleFromPath(path: string): Promise<void>
}

export const PlayerCommandsContext = createContext<PlayerCommands | null>(null)

export const usePlayerCommands = (): PlayerCommands => {
  const commands = useContext(PlayerCommandsContext)
  if (!commands) {
    throw new Error('usePlayerCommands must be used within PlayerHost')
  }
  return commands
}

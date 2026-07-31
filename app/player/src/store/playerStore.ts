import type { CommentEntity } from '@danmaku-anywhere/danmaku-converter'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { immer } from 'zustand/middleware/immer'
import type { PickedMedia } from '@/platform/types'
import {
  type DanmakuSettings,
  DEFAULT_DANMAKU,
  DEFAULT_PLAYBACK,
  DEFAULT_UPSCALE,
  type PlaybackSettings,
  type UpscaleSettings,
  type UpscaleSettingsPatch,
} from './settings'

export type UpscaleStatus = 'idle' | 'initializing' | 'active' | 'error'
export type InterpolationStatus = 'off' | 'active' | 'fallback'

/** Playlist item: a queued media file. */
export interface PlaylistItem {
  url: string
  name: string
  path?: string
}

/** Persisted resume point for a local file (keyed by absolute path). */
export interface ResumeEntry {
  /** last playback position in seconds. */
  time: number
  /** media duration in seconds (to compute near-end and show progress). */
  duration: number
  /** epoch ms of the last write (for future pruning). */
  updatedAt: number
}

/** Live playback state mirrored from the <video> element (not persisted). */
export interface PlaybackState {
  ready: boolean
  playing: boolean
  currentTime: number
  duration: number
  volume: number
  muted: boolean
  playbackRate: number
  bufferedEnd: number
  videoWidth: number
  videoHeight: number
  fullscreen: boolean
}

export interface DanmakuSource {
  label: string
  count: number
}

/** Live renderer statistics for the HUD (session-only, ~1s cadence). */
export interface UpscaleStats {
  /** presented frames per second over the report window. */
  fps: number
  /** average CPU cost per frame in ms. */
  cpuFrameMs: number
  /** interpolation-generated frames per second (0 when off). */
  generatedFps: number
}

export interface OsdMessage {
  id: number
  text: string
  /** optional short glyph/emoji rendered before the text */
  icon?: string
}

const INITIAL_PLAYBACK: PlaybackState = {
  ready: false,
  playing: false,
  currentTime: 0,
  duration: 0,
  volume: 1,
  muted: false,
  playbackRate: 1,
  bufferedEnd: 0,
  videoWidth: 0,
  videoHeight: 0,
  fullscreen: false,
}

export interface PlayerStore {
  // --- media / danmaku ---
  media: PickedMedia | null
  /**
   * Why the current media failed to load (missing file, unsupported codec, …),
   * or null. The persistent history means stale paths are normal, so a failure
   * must be visible instead of leaving a black screen.
   */
  mediaError: string | null
  comments: CommentEntity[]
  danmakuSource: DanmakuSource | null

  // --- source HDR (detected from the decoded frame; session-only) ---
  isHdr: boolean
  hdrTransfer: string | null

  // --- live playback ---
  playback: PlaybackState

  // --- engine status ---
  upscaleStatus: UpscaleStatus
  upscaleError: string | null
  interpolationStatus: InterpolationStatus
  /** live HUD stats, null while the renderer is off. */
  upscaleStats: UpscaleStats | null
  /** A/B compare split ratio (0..1 = position of the divider), null = off. */
  compareRatio: number | null

  // --- transient UI ---
  osd: OsdMessage | null
  settingsOpen: boolean
  /** which page the settings window shows (also used to deep-link into it). */
  settingsSection: string
  danmakuDialogOpen: boolean

  // --- playlist (session-only) ---
  playlist: PlaylistItem[]
  playlistIndex: number
  playlistOpen: boolean

  // --- resume history (persisted, keyed by absolute file path) ---
  progress: Record<string, ResumeEntry>

  // --- persisted settings ---
  upscale: UpscaleSettings
  danmakuSettings: DanmakuSettings
  playbackSettings: PlaybackSettings

  // --- actions ---
  setMedia: (media: PickedMedia | null) => void
  /** record (or clear, with null) why the current media could not be played. */
  setMediaError: (message: string | null) => void
  setComments: (comments: CommentEntity[], source: DanmakuSource | null) => void
  clearDanmaku: () => void
  /** record the detected HDR transfer ('pq'/'hlg') or null for SDR. */
  setHdr: (transfer: string | null) => void

  patchPlayback: (partial: Partial<PlaybackState>) => void

  setUpscaleStatus: (status: UpscaleStatus, error?: string | null) => void
  setInterpolationStatus: (status: InterpolationStatus) => void
  setUpscaleStats: (stats: UpscaleStats | null) => void
  /** move the A/B divider; null exits compare mode. */
  setCompareRatio: (ratio: number | null) => void

  showOsd: (text: string, icon?: string) => void
  clearOsd: () => void
  setSettingsOpen: (open: boolean) => void
  setSettingsSection: (section: string) => void
  /** open the settings window directly on a given page. */
  openSettingsAt: (section: string) => void
  setDanmakuDialogOpen: (open: boolean) => void

  updateUpscale: (partial: UpscaleSettingsPatch) => void
  updateDanmakuSettings: (partial: Partial<DanmakuSettings>) => void
  updatePlaybackSettings: (partial: Partial<PlaybackSettings>) => void
  toggleDanmakuVisible: () => void

  // --- playlist actions ---
  setPlaylist: (items: PlaylistItem[], startIndex?: number) => void
  /**
   * Open media by ADDING it to the (persistent) playlist rather than replacing
   * it, so the list acts as a running history that survives restarts. Items
   * already present (by path, or url for blobs) are not duplicated; the first
   * opened item becomes the current one and starts playing.
   */
  openMedia: (items: PlaylistItem[]) => void
  appendToPlaylist: (items: PlaylistItem[]) => void
  playPlaylistIndex: (index: number) => void
  removePlaylistIndex: (index: number) => void
  clearPlaylist: () => void
  setPlaylistOpen: (open: boolean) => void

  // --- resume actions ---
  /** record/refresh the resume point for a local file. */
  saveProgress: (path: string, time: number, duration: number) => void
  /** forget the resume point for a local file (e.g. watched to the end). */
  clearProgress: (path: string) => void
}

let osdSeq = 0

/** Upper bound on the persisted history playlist (oldest entries are dropped). */
const PLAYLIST_MAX = 200
/** Upper bound on persisted resume points (least recently updated are dropped). */
const PROGRESS_MAX = 500

/** Dedup key for a playlist item: absolute path when local, else the url. */
const playlistKey = (item: PlaylistItem): string => item.path ?? item.url

/**
 * Clamp a number between min and max (inclusive).
 */
function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

/**
 * Switching media invalidates the live playback mirror and the detected HDR
 * state; reset both the same way `setMedia` does (volume/mute are user prefs
 * and survive the switch).
 */
function resetPlaybackForNewMedia(s: PlayerStore): void {
  s.isHdr = false
  s.hdrTransfer = null
  s.mediaError = null
  s.playback = {
    ...INITIAL_PLAYBACK,
    volume: s.playback.volume,
    muted: s.playback.muted,
  }
}

export const usePlayerStore = create<PlayerStore>()(
  persist(
    immer((set) => ({
      media: null,
      mediaError: null,
      comments: [],
      danmakuSource: null,

      isHdr: false,
      hdrTransfer: null,

      playback: INITIAL_PLAYBACK,

      upscaleStatus: 'idle',
      upscaleError: null,
      interpolationStatus: 'off',
      upscaleStats: null,
      compareRatio: null,

      osd: null,
      settingsOpen: false,
      settingsSection: 'shortcuts',
      danmakuDialogOpen: false,

      playlist: [],
      playlistIndex: -1,
      playlistOpen: false,

      progress: {},

      upscale: DEFAULT_UPSCALE,
      danmakuSettings: DEFAULT_DANMAKU,
      playbackSettings: DEFAULT_PLAYBACK,

      setMedia: (media) =>
        set((s) => {
          s.media = media
          // new source: HDR is unknown until the first frame is decoded, and
          // any previous load failure no longer applies
          resetPlaybackForNewMedia(s)
        }),

      setMediaError: (message) =>
        set((s) => {
          s.mediaError = message
        }),

      setComments: (comments, source) =>
        set((s) => {
          s.comments = comments
          s.danmakuSource = source
        }),

      clearDanmaku: () =>
        set((s) => {
          s.comments = []
          s.danmakuSource = null
        }),

      setHdr: (transfer) =>
        set((s) => {
          s.hdrTransfer = transfer
          s.isHdr = transfer !== null
        }),

      patchPlayback: (partial) =>
        set((s) => {
          Object.assign(s.playback, partial)
        }),

      setUpscaleStatus: (status, error = null) =>
        set((s) => {
          s.upscaleStatus = status
          s.upscaleError = error
        }),

      setInterpolationStatus: (status) =>
        set((s) => {
          s.interpolationStatus = status
        }),

      setUpscaleStats: (stats) =>
        set((s) => {
          s.upscaleStats = stats
        }),

      setCompareRatio: (ratio) =>
        set((s) => {
          s.compareRatio = ratio
        }),

      showOsd: (text, icon) =>
        set((s) => {
          osdSeq += 1
          s.osd = { id: osdSeq, text, icon }
        }),

      clearOsd: () =>
        set((s) => {
          s.osd = null
        }),

      setSettingsOpen: (open) =>
        set((s) => {
          s.settingsOpen = open
        }),

      setSettingsSection: (section) =>
        set((s) => {
          s.settingsSection = section
        }),

      openSettingsAt: (section) =>
        set((s) => {
          s.settingsSection = section
          s.settingsOpen = true
        }),

      setDanmakuDialogOpen: (open) =>
        set((s) => {
          s.danmakuDialogOpen = open
        }),

      updateUpscale: (partial) =>
        set((s) => {
          s.upscale = {
            ...s.upscale,
            ...partial,
            frameInterpolation: {
              ...s.upscale.frameInterpolation,
              ...(partial.frameInterpolation ?? {}),
            },
          }
        }),

      updateDanmakuSettings: (partial) =>
        set((s) => {
          Object.assign(s.danmakuSettings, partial)
        }),

      updatePlaybackSettings: (partial) =>
        set((s) => {
          Object.assign(s.playbackSettings, partial)
        }),

      toggleDanmakuVisible: () =>
        set((s) => {
          s.danmakuSettings.visible = !s.danmakuSettings.visible
        }),

      setPlaylist: (items, startIndex) =>
        set((s) => {
          if (items.length === 0) {
            s.playlist = []
            s.playlistIndex = -1
          } else {
            s.playlist = items
            s.playlistIndex = clamp(startIndex ?? 0, 0, items.length - 1)
            s.media = items[s.playlistIndex]
            s.comments = []
            s.danmakuSource = null
            resetPlaybackForNewMedia(s)
          }
        }),

      openMedia: (items) =>
        set((s) => {
          if (items.length === 0) return
          // Append any not-already-present items (history semantics), dedup by key.
          const keys = new Set(s.playlist.map(playlistKey))
          for (const item of items) {
            const key = playlistKey(item)
            if (!keys.has(key)) {
              s.playlist.push(item)
              keys.add(key)
            }
          }
          const firstKey = playlistKey(items[0])
          let idx = s.playlist.findIndex((i) => playlistKey(i) === firstKey)
          // Cap the history by dropping the oldest entries, never the one we
          // are about to play.
          let over = s.playlist.length - PLAYLIST_MAX
          if (over > 0) {
            const fromFront = Math.min(over, idx)
            if (fromFront > 0) {
              s.playlist.splice(0, fromFront)
              idx -= fromFront
              over -= fromFront
            }
            // Re-opening the oldest entry leaves nothing in front of it, so the
            // cap would never be enforced; drop the next-oldest entries instead.
            if (over > 0) s.playlist.splice(1, over)
          }
          s.playlistIndex = idx
          // Fresh object reference so re-opening the current file still re-runs
          // the load + resume effects (which key off a media identity change).
          s.media = { ...s.playlist[idx] }
          s.comments = []
          s.danmakuSource = null
          resetPlaybackForNewMedia(s)
        }),

      appendToPlaylist: (items) =>
        set((s) => {
          if (items.length === 0) {
            return
          }
          const keys = new Set(s.playlist.map(playlistKey))
          const fresh = items.filter((item) => {
            const key = playlistKey(item)
            if (keys.has(key)) return false
            keys.add(key)
            return true
          })
          if (fresh.length === 0) return
          const wasEmpty = s.playlist.length === 0
          const indexOfFirst = s.playlist.length
          s.playlist.push(...fresh)
          if (wasEmpty && s.media === null) {
            s.playlistIndex = indexOfFirst
            s.media = { ...s.playlist[indexOfFirst] }
            s.comments = []
            s.danmakuSource = null
            resetPlaybackForNewMedia(s)
          }
        }),

      playPlaylistIndex: (index) =>
        set((s) => {
          if (index < 0 || index >= s.playlist.length) {
            return
          }
          s.playlistIndex = index
          // Fresh copy so re-selecting the entry that is already playing still
          // re-runs the load + resume effects (they key off media identity).
          s.media = { ...s.playlist[index] }
          s.comments = []
          s.danmakuSource = null
          resetPlaybackForNewMedia(s)
        }),

      removePlaylistIndex: (index) =>
        set((s) => {
          if (index < 0 || index >= s.playlist.length) {
            return
          }
          s.playlist.splice(index, 1)
          if (index < s.playlistIndex) {
            s.playlistIndex -= 1
          } else if (index === s.playlistIndex) {
            // Removing what is playing leaves it playing, but park the cursor
            // just before the freed slot so next/auto-advance carry on with
            // whatever moved into it instead of going dead.
            s.playlistIndex = index - 1
          }
        }),

      clearPlaylist: () =>
        set((s) => {
          s.playlist = []
          s.playlistIndex = -1
        }),

      setPlaylistOpen: (open) =>
        set((s) => {
          s.playlistOpen = open
        }),

      saveProgress: (path, time, duration) =>
        set((s) => {
          if (!path || !Number.isFinite(time)) return
          s.progress[path] = {
            time,
            duration: Number.isFinite(duration) ? duration : 0,
            updatedAt: Date.now(),
          }
          // Bound the history so it cannot grow forever in localStorage.
          const paths = Object.keys(s.progress)
          if (paths.length > PROGRESS_MAX) {
            const stale = paths
              .sort((a, b) => s.progress[a].updatedAt - s.progress[b].updatedAt)
              .slice(0, paths.length - PROGRESS_MAX)
            for (const key of stale) delete s.progress[key]
          }
        }),

      clearProgress: (path) =>
        set((s) => {
          if (path in s.progress) delete s.progress[path]
        }),
    })),
    {
      name: 'danmaku-player-settings',
      version: 1,
      // Persist user settings + the local-file playlist and resume history.
      // Blob-backed items (browser File opens, no `path`) can't be revived
      // across launches, so only path-backed items are kept.
      partialize: (state) => ({
        upscale: state.upscale,
        danmakuSettings: state.danmakuSettings,
        playbackSettings: state.playbackSettings,
        playlist: state.playlist.filter((i) => !!i.path),
        progress: state.progress,
      }),
      // Deep-merge persisted settings over defaults so settings fields ADDED in
      // newer versions (e.g. playbackSettings.autoAdvance) keep their default
      // instead of being wiped by an older persisted object (zustand's default
      // merge is shallow and would replace each settings object wholesale).
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as {
          upscale?: Partial<UpscaleSettings>
          danmakuSettings?: Partial<DanmakuSettings>
          playbackSettings?: Partial<PlaybackSettings>
          playlist?: PlaylistItem[]
          progress?: Record<string, ResumeEntry>
        }
        return {
          ...current,
          upscale: {
            ...current.upscale,
            ...p.upscale,
            frameInterpolation: {
              ...current.upscale.frameInterpolation,
              ...p.upscale?.frameInterpolation,
            },
          },
          danmakuSettings: { ...current.danmakuSettings, ...p.danmakuSettings },
          playbackSettings: {
            ...current.playbackSettings,
            ...p.playbackSettings,
          },
          // Restore the queue but start detached: nothing plays until the user
          // clicks an item (which then resumes from `progress`). Media is never
          // auto-loaded on launch so a moved/deleted file can't wedge startup.
          playlist: Array.isArray(p.playlist)
            ? p.playlist.filter((i) => i && !!i.path)
            : current.playlist,
          playlistIndex: -1,
          progress:
            p.progress && typeof p.progress === 'object'
              ? p.progress
              : current.progress,
        }
      },
    }
  )
)

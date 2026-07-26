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
} from './settings'

export type UpscaleStatus = 'idle' | 'initializing' | 'active' | 'error'
export type InterpolationStatus = 'off' | 'active' | 'fallback'

/** Playlist item: a queued media file. */
export interface PlaylistItem {
  url: string
  name: string
  path?: string
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

  // --- transient UI ---
  osd: OsdMessage | null
  settingsOpen: boolean
  danmakuDialogOpen: boolean

  // --- playlist (session-only) ---
  playlist: PlaylistItem[]
  playlistIndex: number
  playlistOpen: boolean

  // --- persisted settings ---
  upscale: UpscaleSettings
  danmakuSettings: DanmakuSettings
  playbackSettings: PlaybackSettings

  // --- actions ---
  setMedia: (media: PickedMedia | null) => void
  setComments: (comments: CommentEntity[], source: DanmakuSource | null) => void
  clearDanmaku: () => void
  /** record the detected HDR transfer ('pq'/'hlg') or null for SDR. */
  setHdr: (transfer: string | null) => void

  patchPlayback: (partial: Partial<PlaybackState>) => void

  setUpscaleStatus: (status: UpscaleStatus, error?: string | null) => void
  setInterpolationStatus: (status: InterpolationStatus) => void

  showOsd: (text: string, icon?: string) => void
  clearOsd: () => void
  setSettingsOpen: (open: boolean) => void
  setDanmakuDialogOpen: (open: boolean) => void

  updateUpscale: (partial: Partial<UpscaleSettings>) => void
  updateDanmakuSettings: (partial: Partial<DanmakuSettings>) => void
  updatePlaybackSettings: (partial: Partial<PlaybackSettings>) => void
  toggleDanmakuVisible: () => void

  // --- playlist actions ---
  setPlaylist: (items: PlaylistItem[], startIndex?: number) => void
  appendToPlaylist: (items: PlaylistItem[]) => void
  playPlaylistIndex: (index: number) => void
  removePlaylistIndex: (index: number) => void
  clearPlaylist: () => void
  setPlaylistOpen: (open: boolean) => void
}

let osdSeq = 0

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
      comments: [],
      danmakuSource: null,

      isHdr: false,
      hdrTransfer: null,

      playback: INITIAL_PLAYBACK,

      upscaleStatus: 'idle',
      upscaleError: null,
      interpolationStatus: 'off',

      osd: null,
      settingsOpen: false,
      danmakuDialogOpen: false,

      playlist: [],
      playlistIndex: -1,
      playlistOpen: false,

      upscale: DEFAULT_UPSCALE,
      danmakuSettings: DEFAULT_DANMAKU,
      playbackSettings: DEFAULT_PLAYBACK,

      setMedia: (media) =>
        set((s) => {
          s.media = media
          // new source: HDR is unknown until the first frame is decoded
          s.isHdr = false
          s.hdrTransfer = null
          // reset live playback for the new media
          s.playback = {
            ...INITIAL_PLAYBACK,
            volume: s.playback.volume,
            muted: s.playback.muted,
          }
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

      appendToPlaylist: (items) =>
        set((s) => {
          if (items.length === 0) {
            return
          }
          const wasEmpty = s.playlist.length === 0
          const indexOfFirst = s.playlist.length
          s.playlist = [...s.playlist, ...items]
          if (wasEmpty && s.media === null) {
            s.playlistIndex = indexOfFirst
            s.media = items[0]
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
          s.media = s.playlist[index]
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
            s.playlistIndex = -1
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
    })),
    {
      name: 'danmaku-player-settings',
      version: 1,
      // Only persist user settings, never transient/live state.
      partialize: (state) => ({
        upscale: state.upscale,
        danmakuSettings: state.danmakuSettings,
        playbackSettings: state.playbackSettings,
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
        }
      },
    }
  )
)

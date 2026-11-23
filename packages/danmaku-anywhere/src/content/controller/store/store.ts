import type {
  CommentEntity,
  GenericEpisode,
} from '@danmaku-anywhere/danmaku-converter'
import { enableMapSet } from 'immer'
import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import type { MatchEpisodeResult } from '@/common/anime/dto'
import { localizedDanmakuSourceType } from '@/common/danmaku/enums'
import { i18n } from '@/common/localization/i18n'
import { playerRpcClient } from '@/common/rpcClient/background/client'
import type { VideoInfo } from '@/common/rpcClient/background/types'
import { createSelectors } from '@/common/utils/createSelectors'
import { mergeComments } from '@/common/utils/utils'
import type { MediaInfo } from '@/content/controller/danmaku/integration/models/MediaInfo'

export interface DanmakuSource {
  label: string
  commentCount: number
}

/**
 * Build a human-readable source label that includes the provider name.
 * e.g. "Bilibili - Episode Title" or "DanDanPlay - 3 episodes"
 */
const buildSourceLabel = (episodes: GenericEpisode[]): string => {
  if (episodes.length === 0) return ''
  // All episodes in a single load share the same provider
  const providerName = localizedDanmakuSourceType(episodes[0].provider)
  const title =
    episodes.length === 1
      ? episodes[0].title
      : i18n.t('danmaku.commentCountedEpisodes', {
          count: episodes.length,
          defaultValue: '{{count}} episodes',
        })
  return `${providerName} - ${title}`
}

enableMapSet()

export type { VideoInfo }

export interface FrameState {
  frameId: number
  // The url of the frame
  url: string
  // Whether the danmaku manager has started in this frame
  started: boolean
  // Whether danmaku is mounted in this frame
  mounted: boolean
  // Whether a video element is detected in this frame
  hasVideo: boolean
  // Info about the active video element
  videoInfo?: VideoInfo
  // Monotonic counter incremented each time a new video is detected in this frame
  videoChangeCount: number
  // Timestamp of when the video last started playing (used for hysteresis)
  lastPlayTimestamp: number
}

interface StoreState {
  /**
   * Is the page disconnected from the background?
   */
  isDisconnected: boolean
  setIsDisconnected: (disconnected: boolean) => void

  danmaku: {
    isMounted: boolean
    /**
     * For filtering the episode list in the mount controller
     */
    filter: string
    setFilter: (filter: string) => void

    mount: (episodes: GenericEpisode[]) => void
    /**
     * Merge new episodes into the currently mounted danmaku, deduplicating comments.
     */
    mergeMount: (episodes: GenericEpisode[]) => void
    unmount: () => void

    /**
     * Whether danmaku should be visible
     */
    isVisible: boolean
    toggleVisible: (visible?: boolean) => void

    /**
     * Danmaku to be displayed
     */
    comments: CommentEntity[]

    /**
     * Information about the current danmaku. This is an array since multiple episodes can be mounted at once.
     */
    episodes?: GenericEpisode[]
    setEpisodes: (episodes: GenericEpisode[] | undefined) => void

    /**
     * Whether the danmaku is manually set
     * When true, integration will not be used
     */
    isManual: boolean
    toggleManualMode: (manual?: boolean) => void

    /**
     * Loaded danmaku sources for multi-source merging
     */
    sources: DanmakuSource[]
  }

  seekToTime: (time: number) => void
  debugShowSkipButton: (frameId: number) => void

  /**
   * Media information for pages with integration
   */
  integration: {
    active: boolean
    activate: () => void
    deactivate: () => void
    foundElements: boolean
    setFoundElements: (foundElements: boolean) => void
    errorMessage?: string
    setErrorMessage: (errMessage?: string) => void
    mediaInfo?: MediaInfo
    setMediaInfo: (mediaInfo: MediaInfo) => void
    matchResult?: MatchEpisodeResult
    setMatchResult: (result?: MatchEpisodeResult) => void
    resetIntegration: () => void
  }

  /**
   * Whether the active frame has a video element.
   */
  hasVideo: () => boolean

  /**
   * State of each frame in the page
   */
  frame: {
    allFrames: Map<number, FrameState>
    activeFrame?: FrameState
    getActiveFrame: () => FrameState | undefined
    /**
     * Same as `getActiveFrame`, but throws instead of returning undefined.
     * For callers that cannot proceed without a frame (mount/seek/calibrate).
     */
    mustGetActiveFrame: () => FrameState
    setActiveFrame: (frameId: number) => void
    addFrame: (init: Pick<FrameState, 'frameId' | 'url'>) => void
    removeFrame: (frameId: number) => void
    updateFrame: (
      frameId: number,
      nextState: Partial<FrameState> | ((prev: FrameState) => FrameState)
    ) => void
  }

  /**
   * Form state
   */
  integrationForm: {
    showEditor: boolean
    toggleEditor: (show?: boolean) => void
    showAiEditor: boolean
    toggleAiEditor: (show?: boolean) => void
    isPicking: boolean
    setIsPicking: (picking: boolean) => void
  }
}

const useStoreBase = create<StoreState>()(
  immer((set, get) => ({
    isDisconnected: false,
    setIsDisconnected: (disconnected) => {
      set((state) => {
        state.isDisconnected = disconnected
      })
    },

    danmaku: {
      isMounted: false,

      filter: '',
      setFilter: (filter) => {
        set((state) => {
          state.danmaku.filter = filter
        })
      },

      mount: (episodes) => {
        set((state) => {
          state.danmaku.isMounted = true
          state.danmaku.episodes = episodes
          state.danmaku.comments =
            episodes.length === 1
              ? episodes[0].comments
              : episodes.flatMap((episode) => {
                  return episode.comments
                })
          // Reset sources on fresh mount
          const totalComments = state.danmaku.comments.length
          const label = buildSourceLabel(episodes)
          state.danmaku.sources = [{ label, commentCount: totalComments }]
        })
      },
      mergeMount: (episodes) => {
        set((state) => {
          const incoming: CommentEntity[] =
            episodes.length === 1
              ? episodes[0].comments
              : episodes.flatMap((episode) => episode.comments)
          const merged = mergeComments(state.danmaku.comments, incoming)
          state.danmaku.comments = merged

          // Append episodes to the existing list
          const existingEpisodes = state.danmaku.episodes ?? []
          state.danmaku.episodes = [...existingEpisodes, ...episodes]

          // Track the new source
          const label = buildSourceLabel(episodes)
          state.danmaku.sources.push({
            label,
            commentCount: incoming.length,
          })
        })
      },
      unmount: () => {
        set((state) => {
          state.danmaku.isMounted = false
          state.danmaku.episodes = undefined
          state.danmaku.comments = []
          state.danmaku.sources = []
        })
      },
      isVisible: true,
      toggleVisible: (visible) => {
        set((state) => {
          state.danmaku.isVisible = visible ?? !state.danmaku.isVisible
        })
      },

      comments: [],
      episodes: undefined,
      setEpisodes: (episodes) => {
        set((state) => {
          state.danmaku.episodes = episodes
        })
      },

      isManual: false,
      toggleManualMode: (manual) => {
        set((state) => {
          state.danmaku.isManual = manual ?? !state.danmaku.isManual
        })
      },

      sources: [],
    },

    seekToTime: (time) => {
      const activeFrame = get().frame.getActiveFrame()
      if (!activeFrame) {
        return
      }
      void playerRpcClient.player['relay:command:seek']({
        frameId: activeFrame.frameId,
        data: time,
      })
    },

    debugShowSkipButton: (frameId) => {
      void playerRpcClient.player['relay:command:debugSkipButton']({
        frameId,
      })
    },

    integration: {
      active: false,
      activate: () =>
        set((state) => {
          state.integration.active = true
        }),
      deactivate: () => {
        set((state) => {
          state.integration.active = false
        })
      },
      foundElements: false,
      setFoundElements: (foundElements) =>
        set((state) => {
          state.integration.foundElements = foundElements
        }),
      errorMessage: undefined,
      setErrorMessage: (errMessage) => {
        set((state) => {
          state.integration.errorMessage = errMessage
        })
      },
      mediaInfo: undefined,
      setMediaInfo: (mediaInfo) =>
        set((state) => {
          state.integration.mediaInfo = mediaInfo
        }),
      matchResult: undefined,
      setMatchResult: (result) =>
        set((state) => {
          state.integration.matchResult = result
        }),
      resetIntegration: () =>
        set((state) => {
          state.integration.mediaInfo = undefined
          state.integration.foundElements = false
          state.integration.errorMessage = undefined
          state.integration.matchResult = undefined
        }),
    },

    hasVideo: () => {
      return get().frame.activeFrame?.hasVideo ?? false
    },

    frame: {
      allFrames: new Map<number, FrameState>(),
      activeFrame: undefined,
      getActiveFrame: () => {
        return get().frame.activeFrame
      },
      mustGetActiveFrame: () => {
        const activeFrame = get().frame.activeFrame

        if (!activeFrame) {
          throw new Error('No active frame')
        }

        return activeFrame
      },
      setActiveFrame: (frameId) => {
        set((state) => {
          const selectedFrame = state.frame.allFrames.get(frameId)

          if (!selectedFrame) {
            throw new Error(
              `Error setting active frame: Frame ${frameId} not found`
            )
          }

          state.frame.activeFrame = selectedFrame
        })
      },
      addFrame: ({ frameId, url }) => {
        set((state) => {
          state.frame.allFrames.set(frameId, {
            frameId,
            url,
            started: false,
            mounted: false,
            hasVideo: false,
            videoChangeCount: 0,
            lastPlayTimestamp: 0,
          })
        })
      },
      removeFrame: (frameId) => {
        const frame = get().frame.allFrames.get(frameId)

        if (!frame) {
          throw new Error(
            `Failed to remove frame ${frameId}: frame not found in store`
          )
        }

        if (frame.mounted) {
          get().danmaku.unmount()
        }

        set((state) => {
          state.frame.allFrames.delete(frameId)

          if (frameId === state.frame.activeFrame?.frameId) {
            state.frame.activeFrame = undefined
          }
        })
      },
      updateFrame: (frameId, nextState) => {
        set((prev) => {
          const frame = prev.frame.allFrames.get(frameId)

          if (!frame) {
            throw new Error(`Updating frame ${frameId} failed. Frame not found`)
          }

          const nextFrame =
            typeof nextState === 'function'
              ? nextState(frame)
              : { ...frame, ...nextState }

          prev.frame.allFrames.set(frameId, nextFrame)

          if (frameId === prev.frame.activeFrame?.frameId) {
            prev.frame.activeFrame = nextFrame
          }
        })
      },
    },
    integrationForm: {
      showEditor: false,
      toggleEditor: (show) => {
        set((state) => {
          state.integrationForm.showEditor =
            show ?? !state.integrationForm.showEditor
        })
      },
      showAiEditor: false,
      toggleAiEditor: (show) => {
        set((state) => {
          state.integrationForm.showAiEditor =
            show ?? !state.integrationForm.showAiEditor
        })
      },
      isPicking: false,
      setIsPicking: (picking) => {
        set((state) => {
          state.integrationForm.isPicking = picking
        })
      },
    },
  }))
)

export const useStore = createSelectors(useStoreBase)

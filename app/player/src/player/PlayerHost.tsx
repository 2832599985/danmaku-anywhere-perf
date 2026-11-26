import { Alert, Box, createTheme, ThemeProvider, useTheme } from '@mui/material'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { aiExtractTitle } from '@/danmaku/ai'
import {
  autoMatch,
  resolveEpisodeTarget,
  targetEpisode,
} from '@/danmaku/autoMatch'
import {
  dirname,
  learnRule,
  matchRule,
  REASON_RULE_EPISODE_MISSING,
  unmatchedRuleHint,
} from '@/danmaku/filenameRules'
import { filterComments } from '@/danmaku/filter'
import { parseDanmakuText } from '@/danmaku/parse'
import { parseReleaseName } from '@/danmaku/releaseName'
import {
  adapterFor,
  dedupeByPM,
  enabledSources,
  SOURCE_LABELS,
  searchAll,
  searchEpisodesAcross,
  seasonFromRule,
} from '@/danmaku/sources'
import {
  extOf,
  type Platform,
  readFileText,
  SUBTITLE_EXTENSIONS,
  VIDEO_EXTENSIONS,
} from '@/platform'
import { type PlaylistItem, usePlayerStore } from '@/store/playerStore'
import {
  type EmbeddedMountResult,
  loadEmbeddedTracks,
  mountEmbeddedTrack,
  pickDefaultTrack,
  trackName,
} from '@/subtitle/embedded'
import { parseSubtitleText } from '@/subtitle/format'
import {
  bindGenerationPlayer,
  onUserSeek,
  resetGeneration,
  restoreGeneratedTrack,
} from '@/subtitle/generate'
import { focusEmbeddedExtraction } from '@/subtitle/native'
import { rankSiblingSubtitles } from '@/subtitle/siblings'
import { STAGE_Z } from '@/theme/theme'
import { AiSubtitleOverlay } from '@/ui/AiSubtitleOverlay'
import { CompareDivider } from '@/ui/CompareDivider'
import { Controls } from '@/ui/Controls'
import { DanmakuSourceDialog } from '@/ui/DanmakuSourceDialog'
import { DropOverlay } from '@/ui/DropOverlay'
import { EmptyState } from '@/ui/EmptyState'
import { MiniControls } from '@/ui/MiniControls'
import { Osd } from '@/ui/Osd'
import { PlaylistDrawer } from '@/ui/PlaylistDrawer'
import { SettingsDrawer } from '@/ui/SettingsDrawer'
import { TopBar } from '@/ui/TopBar'
import {
  type PlayerCommands,
  PlayerCommandsContext,
  usePlayerCommands,
} from './commands'
import { DanmakuController } from './danmaku/DanmakuController'
import { detectHdrTransfer } from './detectHdr'
import { FullscreenPortalContext } from './fullscreenPortal'
import {
  effectiveDanmakuSettings,
  effectiveSubtitleSettings,
  miniWindowSize,
} from './mini/miniPlayer'
import { snapshotThumb } from './resumeThumbs'
import {
  captureVideoFrame,
  formatScreenshotOsd,
  screenshotFileName,
} from './screenshot'
import { type SiblingEpisode, selectBatch } from './siblingEpisodes'
import { SubtitleController } from './subtitle/SubtitleController'
import { SubtitleRenderer } from './subtitle/SubtitleRenderer'
import { UpscaleController } from './upscale/UpscaleController'
import { useKeyboardControls } from './useKeyboardControls'
import { useOpEdMarks } from './useOpEdMarks'
import { useVideoElement } from './useVideoElement'

const DANMAKU_EXTENSIONS = new Set(['xml', 'json', 'txt'])
/** Longest a window close waits for the last resume frame to be stored. */
const CLOSE_SAVE_MS = 1500
/** Fallback cadence of the resume-card frame capture while playing. */
const THUMB_PERIOD_MS = 15_000
/** Long enough to rule out a double-click, short enough not to feel late. */
const SINGLE_CLICK_DELAY_MS = 250

const basename = (p: string): string => p.split(/[\\/]/).pop() || p

/**
 * Headless OP auto-skipper mounted at stage level so it works in Mini Player
 * too, runs inside `useEffect` (never during render), and only auto-skips once
 * per loaded media key so manually seeking back into the OP never loops.
 */
const AutoSkipOp = () => {
  const commands = usePlayerCommands()
  const skipOpEd = usePlayerStore((s) => s.playbackSettings.skipOpEd)
  const mediaKey = usePlayerStore((s) =>
    s.media ? (s.media.path ?? s.media.url) : null
  )
  const comments = usePlayerStore((s) => s.comments)
  const duration = usePlayerStore((s) => s.playback.duration)
  const currentTime = usePlayerStore((s) =>
    s.playbackSettings.skipOpEd === 'auto' ? s.playback.currentTime : 0
  )
  const { opEnd } = useOpEdMarks(comments, duration)
  const skippedMediaRef = useRef<string | null>(null)

  useEffect(() => {
    if (mediaKey === null) {
      skippedMediaRef.current = null
      return
    }
    if (
      skipOpEd === 'auto' &&
      opEnd !== null &&
      currentTime > 1 &&
      currentTime < opEnd &&
      skippedMediaRef.current !== mediaKey
    ) {
      skippedMediaRef.current = mediaKey
      commands.seekTo(opEnd)
    }
  }, [skipOpEd, mediaKey, opEnd, currentTime, commands])

  return null
}

/**
 * Pause until the browser is idle (or `delayMs` has passed). Used after the
 * video's first frame is on screen to stagger heavy open-time tasks (WebGPU
 * shader compile, ffprobe/ffmpeg child spawns, AI sidecar restore, online
 * danmaku matching, folder scans) so they never pile onto the cold-launch
 * decode spike at once.
 */
const waitForSettle = (
  delayMs: number,
  isStale: () => boolean
): Promise<boolean> =>
  new Promise((resolve) => {
    const timer = window.setTimeout(() => {
      if (isStale()) {
        resolve(false)
        return
      }
      const win = window as Window & {
        requestIdleCallback?: (
          cb: () => void,
          opts?: { timeout: number }
        ) => number
      }
      if (typeof win.requestIdleCallback === 'function') {
        win.requestIdleCallback(() => resolve(!isStale()), { timeout: 600 })
      } else {
        resolve(!isStale())
      }
    }, delayMs)
    if (isStale()) {
      window.clearTimeout(timer)
      resolve(false)
    }
  })

const formatClock = (input: number): string => {
  const sec = Number.isFinite(input) && input > 0 ? input : 0
  const s = Math.floor(sec % 60)
  const m = Math.floor((sec / 60) % 60)
  const h = Math.floor(sec / 3600)
  const pad = (n: number) => n.toString().padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
}

interface PlayerHostProps {
  platform: Platform
}

export const PlayerHost = ({ platform }: PlayerHostProps) => {
  const stageRef = useRef<HTMLDivElement>(null)
  // State mirror of the stage element so MUI overlays can portal INTO it (they
  // otherwise render to document.body, which is hidden under the fullscreen
  // element). Also lets effects re-run once the stage actually mounts.
  const [stageEl, setStageEl] = useState<HTMLDivElement | null>(null)
  const setStageRef = useCallback((el: HTMLDivElement | null) => {
    stageRef.current = el
    setStageEl(el)
  }, [])
  const danmakuLayerRef = useRef<HTMLDivElement>(null)
  const subtitleLayerRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  // State-backed so hooks/effects re-run once the element actually mounts.
  const [video, setVideoState] = useState<HTMLVideoElement | null>(null)
  const setVideoRef = useCallback((el: HTMLVideoElement | null) => {
    videoRef.current = el
    setVideoState(el)
  }, [])

  const upscaleCtrlRef = useRef<UpscaleController | null>(null)
  const danmakuCtrlRef = useRef<DanmakuController | null>(null)
  const subtitleCtrlRef = useRef<SubtitleController | null>(null)
  const subtitleRendererRef = useRef<SubtitleRenderer | null>(null)

  // Every MUI overlay portals to document.body by default, and document.body is
  // hidden behind the fullscreen element (only the fullscreen subtree renders in
  // the top layer). Defaulting the portal container for Modal/Popover/Popper at
  // the theme level fixes drawers, dialogs, menus and tooltips at once — and
  // keeps future overlays fixed by construction rather than per call site.
  const baseTheme = useTheme()
  const themeWithPortal = useMemo(() => {
    if (!stageEl) return baseTheme
    return createTheme(baseTheme, {
      components: {
        MuiModal: { defaultProps: { container: stageEl } },
        MuiPopover: { defaultProps: { container: stageEl } },
        MuiPopper: { defaultProps: { container: stageEl } },
      },
    })
  }, [baseTheme, stageEl])

  // Key (`path`, else `url`) of the media the <video> element actually holds.
  // Set only AFTER the platform resolved the source, so no effect mounts
  // danmaku/subtitles, detects HDR or restores a resume point against the
  // OUTGOING file while a container remux is in flight (FLV/TS/AVI).
  const [sourceKey, setSourceKey] = useState<string | null>(null)
  // Key of the media whose first decoded frame has arrived (and whose HDR
  // transfer check has completed). Staggering WebGPU upscale initialization and
  // heavy background tasks (ffprobe/ffmpeg, AI subtitle restore, online match,
  // folder scans) behind the first frame keeps cold-launch video decode from
  // colliding with shader compilation and child process spawns.
  const [firstFrameKey, setFirstFrameKey] = useState<string | null>(null)

  const media = usePlayerStore((s) => s.media)
  const mediaKey = media ? (media.path ?? media.url) : null
  const sourceReady = mediaKey !== null && sourceKey === mediaKey
  const firstFrameReady = sourceReady && firstFrameKey === mediaKey
  const mediaError = usePlayerStore((s) => s.mediaError)
  const comments = usePlayerStore((s) => s.comments)
  const danmakuSettings = usePlayerStore((s) => s.danmakuSettings)
  const subtitleCues = usePlayerStore((s) => s.subtitleCues)
  const subtitleSettings = usePlayerStore((s) => s.subtitleSettings)
  const miniPlayer = usePlayerStore((s) => s.miniPlayer)
  const videoWidth = usePlayerStore((s) => s.playback.videoWidth)
  const videoHeight = usePlayerStore((s) => s.playback.videoHeight)
  const upscale = usePlayerStore((s) => s.upscale)
  const isHdr = usePlayerStore((s) => s.isHdr)
  const playing = usePlayerStore((s) => s.playback.playing)
  const controlsHoldCount = usePlayerStore((s) => s.controlsHoldCount)
  const overlayModalOpen = usePlayerStore(
    (s) => s.settingsOpen || s.playlistOpen || s.danmakuDialogOpen
  )
  const compareRatio = usePlayerStore((s) => s.compareRatio)
  const autoAddSiblings = usePlayerStore(
    (s) => s.playbackSettings.autoAddSiblings
  )

  // Blocked words + duplicate merging run BEFORE the renderer; the unfiltered
  // list stays in the store so loosening a rule brings comments back.
  const visibleComments = useMemo(
    () =>
      filterComments(
        comments,
        danmakuSettings.filters,
        danmakuSettings.mergeDuplicates
      ),
    [comments, danmakuSettings.filters, danmakuSettings.mergeDuplicates]
  )

  const [controlsVisible, setControlsVisible] = useState(true)
  const hideTimer = useRef<number | null>(null)
  const pointerInsideStageRef = useRef(false)
  const prevHoldCountRef = useRef(0)
  const prevOverlayModalRef = useRef(false)
  /** Window geometry changes are async; ignore a second toggle mid-flight. */
  const miniBusyRef = useRef(false)
  // A single click on the picture plays/pauses only once it is certain not
  // to be the first half of a double-click (fullscreen); acting at once made
  // every double-click pause and resume the video on its way to fullscreen.
  const clickTimerRef = useRef<number | null>(null)

  useVideoElement(video)

  // --- instantiate engine controllers once the stage DOM + video exist ---
  useEffect(() => {
    const stage = stageRef.current
    const layer = danmakuLayerRef.current
    const subtitleLayer = subtitleLayerRef.current
    if (!video || !stage || !layer || !subtitleLayer) return
    const store = usePlayerStore.getState()
    const upscaleCtrl = new UpscaleController(video, stage, {
      onStatus: (status, error) => store.setUpscaleStatus(status, error),
      onInterpolationStatus: (status) => store.setInterpolationStatus(status),
      onStats: (stats) => usePlayerStore.getState().setUpscaleStats(stats),
    })
    const danmakuCtrl = new DanmakuController(layer)
    // Timing → DOM directly: the controller hands each change of the
    // on-screen lines to the renderer in the same task (a frame callback, a
    // seek command). No store write, no React render per subtitle line.
    const subtitleRenderer = new SubtitleRenderer(subtitleLayer)
    subtitleRenderer.applySettings(
      effectiveSubtitleSettings(store.subtitleSettings, store.miniPlayer)
    )
    const subtitleCtrl = new SubtitleController({
      onActiveChange: (active) => subtitleRenderer.render(active),
    })
    subtitleCtrl.updateStyle({ offset: store.subtitleSettings.offset })
    upscaleCtrlRef.current = upscaleCtrl
    danmakuCtrlRef.current = danmakuCtrl
    subtitleCtrlRef.current = subtitleCtrl
    subtitleRendererRef.current = subtitleRenderer
    return () => {
      upscaleCtrl.destroy()
      danmakuCtrl.destroy()
      subtitleCtrl.destroy()
      subtitleRenderer.destroy()
      upscaleCtrlRef.current = null
      danmakuCtrlRef.current = null
      subtitleCtrlRef.current = null
      subtitleRendererRef.current = null
    }
  }, [video])

  // --- media -> <video>.src, then rebuild upscale/danmaku for the new source ---
  // The URL comes from the platform adapter: containers WebView2 cannot demux
  // (FLV/TS/AVI) are remuxed losslessly first, which takes a fraction of a
  // second. `sourceKey` is cleared while that runs so nothing below binds to
  // the outgoing file, then set once the element actually holds the new source.
  useEffect(() => {
    if (!video) return
    if (!media) {
      setSourceKey(null)
      setFirstFrameKey(null)
      video.removeAttribute('src')
      video.load()
      upscaleCtrlRef.current?.reset()
      return
    }
    const key = media.path ?? media.url
    let stale = false
    setSourceKey(null)
    setFirstFrameKey(null)
    upscaleCtrlRef.current?.reset()
    void platform
      .prepareMediaUrl(media)
      .then((prepared) => {
        if (stale) return
        video.src = prepared.url
        video.load()
        // Keep the user's session playback rate across episode switches.
        if (video.defaultPlaybackRate && video.defaultPlaybackRate !== 1) {
          video.playbackRate = video.defaultPlaybackRate
        }
        // Desktop-player behavior: start playing as soon as a file is opened.
        // (The exe allows this via --autoplay-policy; browsers may reject →
        // ignore.)
        void video.play().catch(() => undefined)
        if (prepared.remuxed) {
          usePlayerStore
            .getState()
            .showOsd(`已转换容器 · ${extOf(key).toUpperCase()}`, '📦')
        }
        setSourceKey(key)
      })
      .catch((error: unknown) => {
        if (stale) return
        usePlayerStore
          .getState()
          .setMediaError(
            `无法转换该文件的容器格式：${
              error instanceof Error ? error.message : String(error)
            }`
          )
      })
    return () => {
      stale = true
    }
  }, [media, video, platform])

  // --- detect HDR from the first decoded frame (drives the upscale decision) ---
  useEffect(() => {
    if (!video || !media || !sourceReady) return
    const key = media.path ?? media.url
    let cancelled = false
    let settled = false
    const detect = () => {
      if (cancelled || settled) return
      settled = true
      const transfer = detectHdrTransfer(video)
      const store = usePlayerStore.getState()
      store.setHdr(transfer)
      if (transfer && store.upscale.enabled) {
        store.showOsd(
          `${transfer === 'hlg' ? 'HLG' : 'HDR10'} 片源 · 已暂停超分`,
          '🌈'
        )
      }
      setFirstFrameKey(key)
    }
    type RVFC = HTMLVideoElement & {
      requestVideoFrameCallback?: (cb: () => void) => number
    }
    const v = video as RVFC
    if (typeof v.requestVideoFrameCallback === 'function') {
      v.requestVideoFrameCallback(detect)
    }
    // Also listen on loadeddata + fallback timer so a paused video or a custom
    // protocol where rVFC waits for playback still unlocks upscale and
    // background tasks promptly once a frame is decoded.
    video.addEventListener('loadeddata', detect, { once: true })
    if (video.readyState >= 2) {
      detect()
    }
    const fallbackTimer = window.setTimeout(() => {
      if (!cancelled && !settled && video.readyState >= 1) detect()
    }, 1500)
    return () => {
      cancelled = true
      window.clearTimeout(fallbackTimer)
      video.removeEventListener('loadeddata', detect)
    }
  }, [media, video, sourceReady])

  // --- comments (post-filter) -> mount / clear danmaku ---
  useEffect(() => {
    const danmaku = danmakuCtrlRef.current
    if (!video || !danmaku) return
    if (!visibleComments.length) {
      danmaku.clear()
      return
    }
    // Comments are timed to a source: mount only once the element holds it.
    if (!sourceReady) return
    danmaku.setComments(
      video,
      visibleComments,
      effectiveDanmakuSettings(
        usePlayerStore.getState().danmakuSettings,
        usePlayerStore.getState().miniPlayer
      )
    )
  }, [visibleComments, video, sourceReady])

  // --- danmaku settings -> live update ---
  useEffect(() => {
    // The mini player shrinks the text for the engine only; the stored
    // settings stay what the user chose.
    danmakuCtrlRef.current?.updateSettings(
      effectiveDanmakuSettings(danmakuSettings, miniPlayer)
    )
  }, [danmakuSettings, miniPlayer])

  // --- subtitles: mount cues / forward settings into controller + renderer ---
  // The controller finds the on-screen lines frame by frame and hands CHANGES
  // straight to the renderer; nothing on this path re-renders React.
  useEffect(() => {
    const ctrl = subtitleCtrlRef.current
    if (!video || !ctrl) return
    if (!subtitleCues.length) {
      ctrl.clear()
      return
    }
    if (!sourceReady) return
    ctrl.setCues(video, subtitleCues)
  }, [subtitleCues, video, sourceReady])

  useEffect(() => {
    subtitleCtrlRef.current?.updateStyle({
      offset: subtitleSettings.offset,
    })
  }, [subtitleSettings.offset])

  // Visibility is a style switch on lines that stay laid out, so toggling
  // subtitles on shows the current line in the very next frame. (The toggle
  // command also applies it synchronously — see `toggleSubtitles`.)
  useEffect(() => {
    subtitleRendererRef.current?.applySettings(
      effectiveSubtitleSettings(subtitleSettings, miniPlayer)
    )
  }, [subtitleSettings, miniPlayer, video])

  useEffect(() => {
    subtitleRendererRef.current?.setVideoSize(videoWidth, videoHeight)
  }, [videoWidth, videoHeight, video])

  // --- keep danmaku laid out correctly across container/fullscreen resizes ---
  // The danmaku engine caches the container width when tracks are created; on a
  // resize (window drag OR entering/leaving fullscreen) it must re-measure or
  // new comments spawn from a stale x-position. Nothing else calls resize(), so
  // observe the overlay and forward size changes (rAF-coalesced).
  useEffect(() => {
    const layer = danmakuLayerRef.current
    if (!layer) return
    let raf = 0
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => danmakuCtrlRef.current?.resize())
    })
    observer.observe(layer)
    return () => {
      cancelAnimationFrame(raf)
      observer.disconnect()
    }
  }, [])

  // --- upscale decision: apply, but SUPPRESS on HDR sources ---
  // The Anime4K path renders through an 8-bit sRGB WebGPU canvas, which would
  // clip/mangle HDR (PQ/BT.2020). So for HDR sources we keep the native <video>
  // (which WebView2 outputs/tone-maps correctly) and skip upscaling.
  // Gated on `firstFrameReady` so:
  //   1. The native <video> gets its hardware decoder up and paints its first
  //      frame before WebGPU requests a device and compiles shaders.
  //   2. HDR transfer detection has already run, so an HDR source never
  //      spins up a WebGPU pipeline just to immediately tear it down.
  useEffect(() => {
    const ctrl = upscaleCtrlRef.current
    if (!ctrl || !video || !media || !firstFrameReady) return
    if (isHdr && upscale.enabled) {
      // disable() (not reset()) so the reported status matches reality — the
      // panel would otherwise keep claiming upscale/interpolation are running.
      ctrl.disable()
      return
    }
    void ctrl.apply(upscale)
  }, [upscale, isHdr, media, video, firstFrameReady])

  // --- A/B compare split -> controller clip-path ---
  useEffect(() => {
    upscaleCtrlRef.current?.setCompareRatio(compareRatio)
  }, [compareRatio])

  // Exiting upscale (or losing the media) also exits compare mode.
  useEffect(() => {
    if ((!upscale.enabled || !media) && compareRatio !== null) {
      usePlayerStore.getState().setCompareRatio(null)
    }
  }, [upscale.enabled, media, compareRatio])

  // --- fullscreen state mirror ---
  useEffect(() => {
    const onFs = () =>
      usePlayerStore.getState().patchPlayback({
        fullscreen: document.fullscreenElement === stageRef.current,
      })
    document.addEventListener('fullscreenchange', onFs)
    return () => document.removeEventListener('fullscreenchange', onFs)
  }, [])

  // --- playlist auto-advance when the current video ends ---
  useEffect(() => {
    if (!video) return
    const onEnded = () => {
      const s = usePlayerStore.getState()
      // Finishing a video drops its resume point. This has to live in an effect
      // keyed on the ELEMENT, not on `media`: the moment a listener switches
      // media, React flushes synchronously and tears down the media-keyed
      // effects, and a listener removed mid-dispatch is never called — which is
      // exactly what silently killed the clear when it lived next to the
      // resume/save handlers.
      const finished = s.media?.path
      if (finished) {
        s.clearProgress(finished)
        void platform.deleteResumeThumb(finished).catch(() => undefined)
      }
      if (!s.playbackSettings.autoAdvance) return
      // playlistIndex can be -1 after the current entry was removed from the
      // list; advancing from there to 0 is still the right continuation.
      if (s.playlistIndex < s.playlist.length - 1) {
        const next = s.playlist[s.playlistIndex + 1]
        s.playPlaylistIndex(s.playlistIndex + 1)
        s.showOsd(next.name, '⏭')
      }
    }
    video.addEventListener('ended', onEnded)
    return () => video.removeEventListener('ended', onEnded)
  }, [video])

  // --- auto-load a sibling danmaku file (video.xml / video.json) on Tauri ---
  useEffect(() => {
    if (!platform.isTauri || !media?.path) return
    const videoPath = media.path
    const base = videoPath.replace(/\.[^./\\]+$/, '')
    let stale = false
    void (async () => {
      for (const ext of ['.xml', '.json']) {
        const candidate = `${base}${ext}`
        let text: string
        try {
          text = await platform.readTextFile(candidate)
        } catch {
          continue // no sibling file with this extension
        }
        try {
          if (stale) return
          const { comments: parsed } = await parseDanmakuText(
            text,
            basename(candidate)
          )
          const s = usePlayerStore.getState()
          // Skip if the video changed meanwhile or danmaku was loaded explicitly.
          if (stale || s.media?.path !== videoPath || s.danmakuSource) return
          if (!parsed.length) continue
          s.setComments(parsed, {
            label: basename(candidate),
            count: parsed.length,
          })
          s.showOsd(`自动加载弹幕 · ${parsed.length} 条`, '💬')
          return
        } catch {
          // unparsable sibling — try the next extension
        }
      }

      // --- online auto-match fallback (no sibling file was mounted) ---
      // Parse the filename, search DanDanPlay, resolve season + episode with
      // the SAME helpers the extension uses, and mount. Runs ONLY inside this
      // IIFE so it inherits the sibling effect's `stale` guard and ordering
      // (sibling wins; this fires only when the loop above mounted nothing).
      // Every await boundary re-reads the store and re-checks identity so a
      // media switch or an explicit load mid-flight can't be clobbered.
      //
      // Deferred briefly behind playback start so network requests, AI title
      // extraction and JSON parsing don't compete with cold-launch video decode
      // and WebGPU initialization.
      if (!(await waitForSettle(400, () => stale))) return

      // When the match is not decisive we OPEN THE PICKER instead of guessing:
      // the dialog comes up pre-searched on the parsed title with the episode
      // we believe we want highlighted. A filename with no episode/season/movie
      // signal AND no AI title (a lecture recording, say) stays silent.
      let s = usePlayerStore.getState()
      if (
        stale ||
        s.media?.path !== videoPath ||
        s.danmakuSource ||
        !s.danmakuSettings.autoOnlineMatch
      ) {
        return
      }
      // --- learned file-name rules (no sibling file, no AI yet) ---
      // A rule is a shape the user already resolved BY HAND once; replaying it
      // skips both the model call and the search, so it outranks the AI and
      // works offline. (See `src/danmaku/filenameRules.ts`.)
      if (s.danmakuSettings.learnFilenamePatterns) {
        const hit = matchRule(s.filenameRules, videoPath)
        if (hit) {
          try {
            const adapter = adapterFor(hit.rule.season.source)
            const list = await adapter.episodes(seasonFromRule(hit.rule.season))
            s = usePlayerStore.getState()
            if (stale || s.media?.path !== videoPath || s.danmakuSource) return

            const resolved = resolveEpisodeTarget(list, hit.episode)
            if (!resolved) {
              // The shape matched but that number is not in the learned season:
              // ask, prefilled on the season we know — never guess.
              s.setDanmakuDialogOpen(true, {
                keyword: hit.rule.season.title,
                targetEpisode: hit.episode,
                note: REASON_RULE_EPISODE_MISSING,
              })
              s.showOsd(`${REASON_RULE_EPISODE_MISSING} · 请选择`, '❓')
              return
            }
            const episode = resolved.episode

            const comments = await adapter.comments(episode)
            s = usePlayerStore.getState()
            if (stale || s.media?.path !== videoPath || s.danmakuSource) return
            if (!comments.length) {
              // The rule resolved the episode correctly — DanDanPlay just has
              // nothing for it (a freshly aired episode). Say so instead of
              // looking stuck.
              s.showOsd(`第${hit.episode}集暂无弹幕`, '💬')
              return
            }
            s.setComments(comments, {
              label: `${hit.rule.season.title} · ${episode.title}`,
              count: comments.length,
            })
            s.recordFilenameRuleHit(hit.rule.id)
            s.showOsd(
              `${hit.exact ? '按命名格式匹配' : '按命名格式匹配（宽松）'} · 第${hit.episode}集${
                resolved.mode === 'offset'
                  ? `（站内第${episode.episodeNumber}话）`
                  : ''
              } · ${comments.length} 条`,
              '📐'
            )
            return
          } catch {
            // Season gone / offline: fall through to the deterministic
            // pipeline, which ends in the picker rather than in nothing.
          }
        }
      }

      // The AI is an ENHANCER, not a gate. A 500 from the proxy (which
      // `[LoliHouse]` filenames trigger) or an offline machine used to abort
      // this whole block; the deterministic parser + search below still work.
      // Pass the full path so `parseReleaseName` can fall back to the parent
      // folder when the file itself is just `01.mp4` / `EP05.mkv`.
      const release = parseReleaseName(videoPath)
      const info = await aiExtractTitle(videoPath)
      s = usePlayerStore.getState()
      if (
        stale ||
        s.media?.path !== videoPath ||
        s.danmakuSource ||
        s.mediaError
      ) {
        return
      }

      const hasSearchSignal =
        release.episode > 0 ||
        release.isMovie ||
        release.season !== null ||
        release.title.length > 0 ||
        info !== null
      if (!hasSearchSignal) {
        if (s.danmakuSettings.autoOpenPickerOnMiss) {
          s.setDanmakuDialogOpen(true, {
            keyword: '',
            targetEpisode: 0,
            note: '未能从文件名识别番剧，请手动搜索',
          })
          s.showOsd('未识别到番剧 · 请手动搜索', '❓')
        }
        return
      }

      const sources = enabledSources(s.danmakuSettings, platform.isTauri)
      const outcome = await autoMatch(videoPath, info, {
        search: (keyword, index) => searchAll(keyword, sources, index),
        episodes: (season) => adapterFor(season.source).episodes(season),
        searchEpisodes: searchEpisodesAcross,
        mergeSources: s.danmakuSettings.mergeSources,
      })
      s = usePlayerStore.getState()
      if (
        stale ||
        s.media?.path !== videoPath ||
        s.danmakuSource ||
        s.mediaError
      ) {
        return
      }

      if (outcome.status !== 'matched') {
        if (!s.danmakuSettings.autoOpenPickerOnMiss) return
        // If this folder HAS learned rules and none matched, that is almost
        // certainly why we are asking — say so, or "it never learned" is the
        // only thing the user can conclude.
        const hint = unmatchedRuleHint(s.filenameRules, videoPath)
        const prefillKeyword = outcome.keyword || release.title || ''
        s.setDanmakuDialogOpen(true, {
          keyword: prefillKeyword,
          targetEpisode:
            outcome.status === 'ambiguous'
              ? outcome.targetEpisode
              : release.episode,
          note: hint ? `${outcome.reason} · ${hint}` : outcome.reason,
        })
        s.showOsd(`${outcome.reason} · 请选择`, '❓')
        return
      }

      const matches = [
        { season: outcome.season, episode: outcome.episode },
        ...outcome.extraMatches,
      ]
      const settled = await Promise.allSettled(
        matches.map((match) =>
          adapterFor(match.season.source).comments(match.episode)
        )
      )
      s = usePlayerStore.getState()
      if (stale || s.media?.path !== videoPath || s.danmakuSource) return
      const comments = dedupeByPM(
        settled.flatMap((result) =>
          result.status === 'fulfilled' ? result.value : []
        )
      )
      const localEpisode = release.episode || targetEpisode(videoPath, info)
      if (!comments.length) {
        const failed = settled.every((result) => result.status === 'rejected')
        s.showOsd(
          failed
            ? '弹幕获取失败 · 请检查网络'
            : `${localEpisode > 0 ? `第${localEpisode}集` : '该集'}暂无弹幕`,
          failed ? '⚠' : '💬'
        )
        return
      }
      s.setComments(comments, {
        label: `${outcome.season.title} · ${outcome.episode.title}`,
        count: comments.length,
      })

      // A confident match is knowledge worth keeping: the next file of this
      // batch then resolves through the learned rule (no AI, no search).
      // `default-season` is excluded — the season was inferred from the search
      // order, so it must not become a permanent rule before the user confirms.
      if (
        s.danmakuSettings.learnFilenamePatterns &&
        localEpisode > 0 &&
        outcome.matchMode !== 'default-season'
      ) {
        const rule = learnRule({
          filePath: videoPath,
          episode: localEpisode,
          season: {
            source: outcome.season.source,
            bangumiId: outcome.season.id,
            title: outcome.season.title,
            episodeCount: outcome.season.episodeCount,
          },
        })
        if (rule) s.addFilenameRule(rule)
      }

      const sourceLabel = [
        ...new Set(matches.map((match) => SOURCE_LABELS[match.season.source])),
      ].join(' + ')
      s.showOsd(
        `自动匹配 · ${sourceLabel} · ${outcome.season.title} · ${
          localEpisode > 0 ? `第${localEpisode}集` : '该集'
        }${
          outcome.episodeMode === 'offset'
            ? `（站内第${outcome.episode.episodeNumber}话）`
            : ''
        }${outcome.matchMode === 'default-season' ? '（未标季）' : ''} · ${
          comments.length
        } 条`,
        '🤖'
      )
    })()
    return () => {
      stale = true
    }
  }, [media, platform])

  // --- sibling episodes -> playlist (Tauri; same folder; rules-aware) ---
  // Opening one episode of a downloaded batch should not mean playing ONE
  // episode: find the rest of the batch next to it and arrange it around the
  // current file — earlier episodes in front, later ones behind — so autoplay
  // carries on into the NEXT episode (not back to episode 1). The batch is
  // identified by the file name's literal head (see siblingEpisodes.ts), so a
  // folder holding many shows contributes only its own episodes. Files whose
  // episode number cannot be determined are skipped, never guessed.
  useEffect(() => {
    if (
      !platform.isTauri ||
      !media?.path ||
      !autoAddSiblings ||
      !firstFrameReady
    )
      return
    const videoPath = media.path
    let stale = false
    void (async () => {
      if (!(await waitForSettle(350, () => stale))) return
      const paths = await platform.listVideoFiles(dirname(videoPath))
      if (stale) return
      const batch = selectBatch(
        videoPath,
        paths,
        (path) =>
          matchRule(usePlayerStore.getState().filenameRules, path)?.episode ??
          null
      )
      if (!batch || (batch.before.length === 0 && batch.after.length === 0)) {
        return
      }
      const store = usePlayerStore.getState()
      if (store.media?.path !== videoPath) return
      const toItem = (sibling: SiblingEpisode): PlaylistItem => ({
        url: platform.mediaUrlForPath(sibling.path),
        name: sibling.name,
        path: sibling.path,
      })
      const known = new Set(store.playlist.map((item) => item.path))
      const fresh = [...batch.before, ...batch.after].filter(
        (sibling) => !known.has(sibling.path)
      )
      store.placeAroundCurrent(
        batch.before.map(toItem),
        batch.after.map(toItem)
      )
      if (fresh.length > 0) {
        usePlayerStore
          .getState()
          .showOsd(`已加入 ${fresh.length} 集到播放列表`, '📃')
      }
    })()
    return () => {
      stale = true
    }
  }, [media, platform, autoAddSiblings, firstFrameReady])

  // --- auto-load subtitles: sibling file first, then the container's own ---
  // Two sources, in that order. A subtitle file next to the video
  // (`<video>.srt`, or fansub-tagged `<video>.sc.ass` …, best language first)
  // is the more explicit choice, so it wins; otherwise the best track INSIDE
  // the container is mounted (fansub MKVs carry 简体/繁體 streams, and the
  // webview can never see them — Rust demuxes them, see `subtitle/embedded.ts`).
  // Same identity-recheck discipline as the danmaku sibling loader above: an
  // explicit mount or a media switch mid-read must not be clobbered.
  useEffect(() => {
    // Invalidate every pending window/timer of the generated-subtitle
    // scheduler — the runWindow callbacks capture mediaSession and stop
    // acting on a stale generation (a media switch mid-window otherwise
    // still mounts the old video's cues when the window resolves).
    resetGeneration()
    if (!platform.isTauri) return
    // Probes and extractions still reading the PREVIOUS file stop now instead
    // of competing with this one for the disk.
    void focusEmbeddedExtraction(media?.path ?? '').catch(() => undefined)
    if (!media?.path || !firstFrameReady) return
    const videoPath = media.path
    let stale = false
    void (async () => {
      // Check fast local sibling subtitle files first without spawning ffprobe,
      // so cold-launch playback + WebGPU initialization aren't hit by an extra
      // child process at t=0.
      const siblings = rankSiblingSubtitles(
        videoPath,
        await platform.listSubtitleFiles(dirname(videoPath))
      )
      let mountedSibling = false
      for (const candidate of siblings) {
        if (stale) return
        let text: string
        try {
          text = await platform.readTextFile(candidate)
        } catch {
          continue // vanished or unreadable — try the next one
        }
        if (stale) return
        const cues = parseSubtitleText(text, basename(candidate))
        const s = usePlayerStore.getState()
        if (stale || s.media?.path !== videoPath || s.subtitleSource) return
        if (!cues.length) continue
        s.setSubtitles(cues, {
          label: basename(candidate),
          count: cues.length,
          kind: 'file',
        })
        s.showOsd(`自动加载字幕 · ${cues.length} 条`, '🎬')
        mountedSibling = true
        break
      }
      // Stagger the ffprobe child-process spawn behind the initial frame /
      // WebGPU setup spike. If a sibling file already mounted, we can wait a
      // bit longer before populating the embedded track picker in the background.
      if (!(await waitForSettle(mountedSibling ? 900 : 250, () => stale)))
        return
      const tracks = await loadEmbeddedTracks(videoPath)
      if (stale || mountedSibling) return
      const pick = pickDefaultTrack(tracks)
      if (!pick) return
      let result: EmbeddedMountResult
      try {
        // `auto`: a subtitle mounted while ffmpeg runs (a file dropped in with
        // the video, a pick in 设置 → 字幕) is kept, never replaced.
        result = await mountEmbeddedTrack(pick.index, { auto: true })
      } catch (error) {
        // ffmpeg missing, or the stream could not be converted: say so once on
        // screen, and keep the detail for 设置 → 字幕. Same media-identity guard
        // as every other hop in this effect — a switch mid-extraction must not
        // staple the failure onto the NEXT file.
        const store = usePlayerStore.getState()
        if (stale || store.media?.path !== videoPath) return
        store.setEmbeddedError(
          error instanceof Error ? error.message : String(error)
        )
        store.showOsd('内封字幕加载失败', '🎬')
        return
      }
      if (stale || result !== 'mounted') return
      const source = usePlayerStore.getState().subtitleSource
      if (!source) return
      usePlayerStore
        .getState()
        .showOsd(`内封字幕 · ${trackName(pick)} · ${source.count} 条`, '🎬')
    })().finally(() => {
      // Lowest priority: AI subtitles generated for this video before (cache
      // under the data dir) come back, and generation resumes on the CPU.
      // Deferred so whisper-server / llama-server never spawn on top of the
      // initial cold-start commit-charge peak.
      if (stale || usePlayerStore.getState().subtitleSource) return
      void (async () => {
        if (!(await waitForSettle(800, () => stale))) return
        if (stale || usePlayerStore.getState().subtitleSource) return
        const restored = await restoreGeneratedTrack(videoPath)
        if (restored && !stale) {
          usePlayerStore.getState().showOsd('已恢复 AI 字幕', '🎬')
        }
      })().catch(() => undefined)
    })
    return () => {
      stale = true
    }
  }, [media, platform, firstFrameReady])

  // --- resume history: restore last position on open, persist while watching ---
  // Only local files (with a stable `path`) are tracked; browser blob opens have
  // no durable key. Saves are throttled; the cleanup captures the position when
  // switching away, and `pagehide` covers a hard app close.
  useEffect(() => {
    const path = media?.path
    if (!video || !path || !sourceReady) return
    const store = usePlayerStore.getState

    let resumed = false
    const onMeta = () => {
      if (resumed) return
      resumed = true
      const entry = store().progress[path]
      if (!entry || !(entry.time > 3)) return
      const dur = Number.isFinite(video.duration)
        ? video.duration
        : entry.duration
      // Don't resume if we were essentially at the end (let it replay).
      if (dur && entry.time >= dur * 0.95) return
      video.currentTime = entry.time
      store().showOsd(`已恢复到 ${formatClock(entry.time)}`, '⏱')
    }

    const save = () => {
      // Finished playback clears the resume point; without this guard the
      // cleanup that runs when auto-advance switches media would immediately
      // write it back at ~100%.
      if (video.ended) return
      const t = video.currentTime
      if (t > 1 && Number.isFinite(t)) {
        store().saveProgress(path, t, video.duration)
      }
    }
    // The "continue watching" card shows the frame you left on. Captured on
    // pause, on leaving the video and on close; the periodic one only covers
    // an exit that never runs a handler (crash, killed process).
    const snapshot = () => {
      if (!video.ended) void snapshotThumb(platform, path, video)
    }
    let lastSave = 0
    let lastSnapshot = 0
    const onTimeUpdate = () => {
      const now = performance.now()
      if (now - lastSnapshot >= THUMB_PERIOD_MS) {
        lastSnapshot = now
        snapshot()
      }
      if (now - lastSave < 3000) return
      lastSave = now
      save()
    }
    const onPause = () => {
      save()
      snapshot()
    }
    // NOTE: clearing on 'ended' deliberately lives in the element-keyed
    // auto-advance effect above — a listener registered here is torn down
    // mid-dispatch as soon as the video finishes and media switches.

    video.addEventListener('loadedmetadata', onMeta, { once: true })
    if (video.readyState >= 1) onMeta()
    video.addEventListener('timeupdate', onTimeUpdate)
    video.addEventListener('pause', onPause)
    return () => {
      video.removeEventListener('loadedmetadata', onMeta)
      video.removeEventListener('timeupdate', onTimeUpdate)
      video.removeEventListener('pause', onPause)
      // Capture the outgoing position (and frame) before the media effect
      // swaps the src.
      save()
      snapshot()
    }
  }, [media, video, sourceReady])

  // --- persist the resume point when the app window is closing ---
  useEffect(() => {
    const onHide = () => {
      const s = usePlayerStore.getState()
      const v = videoRef.current
      if (s.media?.path && v && !v.ended && v.currentTime > 1) {
        s.saveProgress(s.media.path, v.currentTime, v.duration)
      }
    }
    window.addEventListener('pagehide', onHide)
    return () => window.removeEventListener('pagehide', onHide)
  }, [])

  // --- the window is closing: last frame for the resume card ---
  // pagehide is too late for it (the write never reaches disk), so the close
  // is held until the frame is stored — capped, a close must never hang.
  useEffect(
    () =>
      platform.onCloseRequested(async () => {
        const s = usePlayerStore.getState()
        const v = videoRef.current
        if (!s.media?.path || !v || v.ended || !(v.currentTime > 1)) return
        s.saveProgress(s.media.path, v.currentTime, v.duration)
        await Promise.race([
          snapshotThumb(platform, s.media.path, v),
          new Promise((resolve) => window.setTimeout(resolve, CLOSE_SAVE_MS)),
        ])
      }),
    [platform]
  )

  // --- imperative commands ---
  const commands = useMemo<PlayerCommands>(() => {
    const getVideo = () => videoRef.current
    const store = () => usePlayerStore.getState()

    const loadDanmakuFromText = async (text: string, name: string) => {
      const { comments: parsed } = await parseDanmakuText(text, name)
      store().setComments(parsed, { label: name, count: parsed.length })
    }

    const loadSubtitleFromText = async (text: string, name: string) => {
      const cues = parseSubtitleText(text, name)
      if (!cues.length) {
        throw new Error(`未解析到字幕内容：${name}`)
      }
      store().setSubtitles(cues, {
        label: name,
        count: cues.length,
        kind: 'file',
      })
    }

    const itemFromPath = (path: string): PlaylistItem => ({
      url: platform.mediaUrlForPath(path),
      name: basename(path),
      path,
    })
    const itemFromFile = (file: File): PlaylistItem => ({
      url: URL.createObjectURL(file),
      name: file.name,
    })
    const playlistStep = (delta: -1 | 1, icon: string) => {
      const s = store()
      const next = s.playlistIndex + delta
      // A detached cursor (-1, after a restore or after removing the playing
      // entry) may still step forward into the list.
      if (next < 0 || next >= s.playlist.length) return
      s.playPlaylistIndex(next)
      s.showOsd(s.playlist[next].name, icon)
    }

    return {
      play: () =>
        void getVideo()
          ?.play()
          .catch(() => undefined),
      pause: () => getVideo()?.pause(),
      togglePlay: () => {
        const v = getVideo()
        if (!v) return
        if (v.paused || v.ended) void v.play().catch(() => undefined)
        else v.pause()
      },
      seekTo: (seconds) => {
        const v = getVideo()
        if (!v) return
        const dur = Number.isFinite(v.duration)
          ? v.duration
          : Number.POSITIVE_INFINITY
        const next = Math.max(0, Math.min(seconds, dur))
        v.currentTime = next
        // The target's lines go up with this keypress, not after the decoder.
        subtitleCtrlRef.current?.seekTo(next)
        onUserSeek(next)
      },
      seekBy: (delta) => {
        const v = getVideo()
        if (!v) return
        const dur = Number.isFinite(v.duration)
          ? v.duration
          : Number.POSITIVE_INFINITY
        const next = Math.max(0, Math.min(v.currentTime + delta, dur))
        v.currentTime = next
        subtitleCtrlRef.current?.seekTo(next)
        store().showOsd(formatClock(next), delta >= 0 ? '⏩' : '⏪')
        onUserSeek(next)
      },
      setVolume: (volume) => {
        const v = getVideo()
        if (!v) return
        const clamped = Math.max(0, Math.min(1, volume))
        v.volume = clamped
        if (clamped > 0) v.muted = false
        store().updatePlaybackSettings({ volume: v.volume, muted: v.muted })
      },
      changeVolume: (delta) => {
        const v = getVideo()
        if (!v) return
        const next = Math.max(0, Math.min(1, v.volume + delta))
        v.volume = next
        if (next > 0) v.muted = false
        store().updatePlaybackSettings({ volume: v.volume, muted: v.muted })
        store().showOsd(`${Math.round(next * 100)}%`, next === 0 ? '🔇' : '🔊')
      },
      toggleMute: () => {
        const v = getVideo()
        if (!v) return
        v.muted = !v.muted
        store().updatePlaybackSettings({ muted: v.muted })
        store().showOsd(v.muted ? '静音' : '取消静音', v.muted ? '🔇' : '🔊')
      },
      setPlaybackRate: (rate, options) => {
        const v = getVideo()
        if (!v) return
        if (!options?.temporary) v.defaultPlaybackRate = rate
        v.playbackRate = rate
      },
      takeScreenshot: async () => {
        const v = getVideo()
        const s = store()
        if (!v || !s.media) return
        const {
          saveScreenshotToFile,
          screenshotDir,
          screenshotSource,
          screenshotIncludeDanmaku,
          screenshotIncludeSubtitles,
        } = s.playbackSettings
        const wantOriginal = screenshotSource === 'original'
        try {
          const frame = await captureVideoFrame(
            v,
            wantOriginal ? null : (upscaleCtrlRef.current?.getCanvas() ?? null),
            {
              encodePng: !platform.isTauri || saveScreenshotToFile,
              stageEl: stageRef.current,
              danmakuLayer:
                screenshotIncludeDanmaku && s.danmakuSettings.visible
                  ? danmakuLayerRef.current
                  : null,
              subtitleLayer:
                screenshotIncludeSubtitles && s.subtitleSettings.visible
                  ? subtitleLayerRef.current
                  : null,
              subtitleSettings: s.subtitleSettings,
            }
          )
          let copied = false
          let copyError: unknown = null
          try {
            await platform.copyImageToClipboard(
              frame.width,
              frame.height,
              frame.rgba,
              frame.pngBlob ?? new Blob([], { type: 'image/png' })
            )
            copied = true
          } catch (err) {
            copyError = err
          }

          let saved = false
          if (saveScreenshotToFile && frame.pngBytes) {
            const name = screenshotFileName(s.media.name, v.currentTime)
            await platform.saveScreenshot(
              name,
              frame.pngBytes,
              screenshotDir || undefined
            )
            saved = true
          }

          if (!copied && !saved) {
            throw copyError ?? new Error('剪贴板写入失败')
          }

          store().showOsd(
            formatScreenshotOsd({
              upscaled: frame.upscaled,
              requestedOriginal: wantOriginal,
              drewDanmaku: frame.drewDanmaku,
              drewSubtitles: frame.drewSubtitles,
              copied,
              saved,
            }),
            '📷'
          )
        } catch (err) {
          store().showOsd(
            `截图失败：${err instanceof Error ? err.message : String(err)}`,
            '⚠️'
          )
        }
      },
      toggleFullscreen: () => {
        const stage = stageRef.current
        if (!stage) return
        // Fullscreen and the mini window are opposite ends; the mini window
        // has to be left first (its restore puts the geometry back).
        if (store().miniPlayer) return
        if (document.fullscreenElement) void document.exitFullscreen()
        else void stage.requestFullscreen().catch(() => undefined)
      },
      toggleMiniPlayer: async () => {
        if (miniBusyRef.current) return
        miniBusyRef.current = true
        try {
          if (store().miniPlayer) {
            await platform.exitMiniWindow()
            store().setMiniPlayer(false)
            return
          }
          if (document.fullscreenElement) {
            await document.exitFullscreen().catch(() => undefined)
          }
          // Drawers and dialogs have no room in a 480px window.
          store().setSettingsOpen(false)
          store().setPlaylistOpen(false)
          const { videoWidth, videoHeight } = store().playback
          const size = miniWindowSize(videoWidth, videoHeight)
          if (await platform.enterMiniWindow(size.width, size.height)) {
            store().setMiniPlayer(true)
          } else {
            store().showOsd('小窗仅在桌面版可用', '🪟')
          }
        } catch (error) {
          // A half-applied geometry change must not leave the window stuck
          // top-most and tiny: try to put it back, then report.
          await platform.exitMiniWindow().catch(() => undefined)
          store().setMiniPlayer(false)
          store().showOsd(
            `小窗切换失败：${error instanceof Error ? error.message : String(error)}`,
            '⚠️'
          )
        } finally {
          miniBusyRef.current = false
        }
      },
      toggleDanmaku: () => {
        store().toggleDanmakuVisible()
        const visible = store().danmakuSettings.visible
        store().showOsd(visible ? '弹幕开' : '弹幕关', '💬')
      },
      toggleUpscale: () => {
        const enabled = !store().upscale.enabled
        store().updateUpscale({ enabled })
        store().showOsd(enabled ? '超分开' : '超分关', '✨')
      },
      toggleCompare: () => {
        const s = store()
        if (s.compareRatio !== null) {
          s.setCompareRatio(null)
          s.showOsd('退出对比', '⇔')
        } else if (s.upscale.enabled && s.upscaleStatus === 'active') {
          s.setCompareRatio(0.5)
          s.showOsd('增强 ⇔ 原片 对比', '⇔')
        } else {
          s.showOsd('超分未运行，无法对比', '⇔')
        }
      },
      openVideo: async () => {
        const picked = await platform.pickVideoFiles()
        if (picked.length) store().openMedia(picked)
      },
      openVideoFromPath: (path) => {
        store().openMedia([itemFromPath(path)])
      },
      openVideoFromFile: (file) => {
        store().openMedia([itemFromFile(file)])
      },
      openVideosFromPaths: (paths) => {
        if (paths.length) store().openMedia(paths.map(itemFromPath))
      },
      openVideosFromFiles: (files) => {
        if (files.length) store().openMedia(files.map(itemFromFile))
      },
      addVideosToPlaylist: async () => {
        const picked = await platform.pickVideoFiles()
        if (!picked.length) return
        store().appendToPlaylist(picked)
        store().showOsd(`已添加 ${picked.length} 个视频`, '📃')
      },
      playlistPrev: () => playlistStep(-1, '⏮'),
      playlistNext: () => playlistStep(1, '⏭'),
      playlistPlayAt: (index) => {
        store().playPlaylistIndex(index)
      },
      togglePlaylist: () => {
        store().setPlaylistOpen(!store().playlistOpen)
      },
      loadDanmakuFromFile: async () => {
        const picked = await platform.pickDanmakuFile()
        if (picked) await loadDanmakuFromText(picked.text, picked.name)
      },
      loadDanmakuFromText,
      loadDanmakuFromPath: async (path) => {
        const text = await platform.readTextFile(path)
        await loadDanmakuFromText(text, basename(path))
      },
      toggleSubtitles: () => {
        store().toggleSubtitleVisible()
        const settings = store().subtitleSettings
        // Applied here, synchronously, rather than by the settings effect
        // after React's next render: the lines are already laid out, so they
        // are on screen in the very next frame.
        subtitleRendererRef.current?.applySettings(
          effectiveSubtitleSettings(settings, store().miniPlayer)
        )
        store().showOsd(settings.visible ? '字幕开' : '字幕关', '🎬')
      },
      loadSubtitleFromFile: async () => {
        const picked = await platform.pickSubtitleFile()
        if (picked) await loadSubtitleFromText(picked.text, picked.name)
      },
      loadSubtitleFromText,
      loadSubtitleFromPath: async (path) => {
        const text = await platform.readTextFile(path)
        await loadSubtitleFromText(text, basename(path))
      },
    }
  }, [platform])

  // The AI subtitle burst pauses/resumes through the same commands as the UI.
  useEffect(() => {
    bindGenerationPlayer({ play: commands.play, pause: commands.pause })
    return () => bindGenerationPlayer(null)
  }, [commands])

  useKeyboardControls(commands)

  // Expose store + commands for e2e/debugging (harmless in production).
  useEffect(() => {
    ;(window as unknown as Record<string, unknown>).__player = {
      store: usePlayerStore,
      commands,
      // Engine internals for probes: interpolation outcome counters.
      engine: () => upscaleCtrlRef.current?.getEngineDebug() ?? null,
    }
  }, [commands])

  // --- native (Tauri) OS drag-drop and 「打开方式」 (command-line files) ---
  useEffect(() => {
    if (!platform.isTauri) return
    const openPaths = (paths: string[]) => {
      // Videos first (they reset the playlist + danmaku), then danmaku and
      // subtitle files.
      const videos = paths.filter((p) => VIDEO_EXTENSIONS.has(extOf(p)))
      const danmaku = paths.filter((p) => DANMAKU_EXTENSIONS.has(extOf(p)))
      const subtitles = paths.filter((p) => SUBTITLE_EXTENSIONS.has(extOf(p)))
      if (videos.length) commands.openVideosFromPaths(videos)
      for (const path of danmaku) void commands.loadDanmakuFromPath(path)
      for (const path of subtitles) void commands.loadSubtitleFromPath(path)
    }
    const offDrop = platform.onFileDrop(openPaths)
    const offOpen = platform.onOpenFiles(openPaths)
    return () => {
      offDrop()
      offOpen()
    }
  }, [platform, commands])

  // --- browser drag-over hint ---
  // Tauri's native drop does not produce DOM drag events, so in the exe the
  // same state is driven by `onFileDragHover` below. `types` can still be
  // empty at the first event of a drag, so an empty list counts as a file drag.
  const [dragActive, setDragActive] = useState(false)
  const isFileDrag = (event: React.DragEvent): boolean => {
    const types = Array.from(event.dataTransfer?.types ?? [])
    return types.length === 0 || types.includes('Files')
  }

  // --- browser drag-drop ---
  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault()
      setDragActive(false)
      const files = Array.from(event.dataTransfer.files)
      const videos = files.filter(
        (f) =>
          VIDEO_EXTENSIONS.has(extOf(f.name)) || f.type.startsWith('video/')
      )
      const danmaku = files.filter((f) => DANMAKU_EXTENSIONS.has(extOf(f.name)))
      const subtitles = files.filter((f) =>
        SUBTITLE_EXTENSIONS.has(extOf(f.name))
      )
      if (videos.length) commands.openVideosFromFiles(videos)
      for (const file of danmaku) {
        void readFileText(file).then((text) =>
          commands.loadDanmakuFromText(text, file.name)
        )
      }
      for (const file of subtitles) {
        void readFileText(file)
          .then((text) => commands.loadSubtitleFromText(text, file.name))
          .catch(() => undefined)
      }
    },
    [commands]
  )

  // Native (Tauri) drag-over: the stage never receives DOM drag events under
  // Tauri's own drop handling, so the same dashed hint is driven from the
  // window's drag events. (Browser builds get it from the stage handlers.)
  useEffect(() => platform.onFileDragHover(setDragActive), [platform])

  // --- controls auto-hide (both playing and paused) ---
  // Pausing no longer pins the chrome permanently: controls appear briefly on
  // pause or mouse movement, stay locked only while a popover/menu is open or
  // the seek thumb is dragged (`controlsHoldCount > 0`), and fade out after
  // 2.6s of inactivity (or immediately when the pointer leaves the window).
  const clearHideTimer = useCallback(() => {
    if (hideTimer.current !== null) {
      window.clearTimeout(hideTimer.current)
      hideTimer.current = null
    }
  }, [])

  const revealControls = useCallback(() => {
    setControlsVisible(true)
    clearHideTimer()
    hideTimer.current = window.setTimeout(() => {
      hideTimer.current = null
      if (usePlayerStore.getState().controlsHoldCount === 0) {
        setControlsVisible(false)
      }
    }, 2600)
  }, [clearHideTimer])

  // Show chrome briefly on play/pause transitions so pausing confirms state
  // then fades out cleanly after 2.6s.
  useEffect(() => {
    if (!media) return
    revealControls()
  }, [playing, media, revealControls])

  // When the last popover/menu/drag lock releases, either start a fresh
  // countdown (pointer inside) or hide right away (pointer already left).
  useEffect(() => {
    const prev = prevHoldCountRef.current
    prevHoldCountRef.current = controlsHoldCount
    if (!media || prev === 0 || controlsHoldCount > 0) return
    if (pointerInsideStageRef.current) {
      revealControls()
    } else {
      clearHideTimer()
      setControlsVisible(false)
    }
  }, [controlsHoldCount, media, revealControls, clearHideTimer])

  // Returning from Settings / Playlist / Danmaku dialog reveals the controls
  // briefly (then lets the normal 2.6s timer fade them out).
  useEffect(() => {
    const prev = prevOverlayModalRef.current
    prevOverlayModalRef.current = overlayModalOpen
    if (prev && !overlayModalOpen && media) {
      revealControls()
    }
  }, [overlayModalOpen, media, revealControls])

  useEffect(() => {
    return () => {
      clearHideTimer()
      if (clickTimerRef.current) window.clearTimeout(clickTimerRef.current)
    }
  }, [clearHideTimer])

  const onStageWheel = useCallback(
    (event: React.WheelEvent<HTMLDivElement>) => {
      if (!event.deltaY) return
      const s = usePlayerStore.getState()
      if (!s.media || s.settingsOpen || s.playlistOpen || s.danmakuDialogOpen) {
        return
      }
      if (
        event.target instanceof HTMLElement &&
        event.target.closest(
          '.MuiModal-root, .MuiPopover-root, .MuiDrawer-root'
        ) !== null
      ) {
        return
      }
      const step = s.playbackSettings.volumeStep
      commands.changeVolume(event.deltaY < 0 ? step : -step)
    },
    [commands]
  )

  const cancelPendingClick = useCallback(() => {
    if (clickTimerRef.current === null) return
    window.clearTimeout(clickTimerRef.current)
    clickTimerRef.current = null
  }, [])

  const onVideoClick = useCallback(
    (event: React.MouseEvent) => {
      // detail counts the clicks of this burst: the 2nd click belongs to the
      // double-click, which goes fullscreen and must not toggle playback.
      cancelPendingClick()
      if (event.detail !== 1) return
      clickTimerRef.current = window.setTimeout(() => {
        clickTimerRef.current = null
        commands.togglePlay()
      }, SINGLE_CLICK_DELAY_MS)
    },
    [commands, cancelPendingClick]
  )

  const onStageDoubleClick = useCallback(() => {
    cancelPendingClick()
    commands.toggleFullscreen()
  }, [commands, cancelPendingClick])

  // Mini: the picture moves the window. Tauri's own drag region is NOT used —
  // its script turns a double-click into toggle-maximize and swallows the
  // event, which fought our double-click-to-restore.
  const onMiniMouseDown = useCallback(
    (event: React.MouseEvent) => {
      if (event.button !== 0 || event.target !== event.currentTarget) return
      if (event.detail === 2) {
        void commands.toggleMiniPlayer()
      } else if (event.detail === 1) {
        event.preventDefault()
        platform.startWindowDrag()
      }
    },
    [commands, platform]
  )

  const overlaysVisible = controlsVisible || !media || controlsHoldCount > 0

  // Move the subtitle rows clear of the bottom controls while they show.
  useEffect(() => {
    subtitleRendererRef.current?.setLifted(
      overlaysVisible && !!media && !miniPlayer
    )
  }, [overlaysVisible, media, video, miniPlayer])

  // The bar measures itself and reports; the lift clears exactly its height.
  const onControlsHeight = useCallback((height: number) => {
    subtitleRendererRef.current?.setControlBarHeight(height)
  }, [])

  return (
    <PlayerCommandsContext.Provider value={commands}>
      <ThemeProvider theme={themeWithPortal}>
        <FullscreenPortalContext.Provider value={stageEl}>
          <div
            ref={setStageRef}
            data-player-stage
            onMouseEnter={() => {
              pointerInsideStageRef.current = true
            }}
            onMouseMove={() => {
              pointerInsideStageRef.current = true
              revealControls()
            }}
            onWheel={onStageWheel}
            onMouseLeave={() => {
              pointerInsideStageRef.current = false
              const s = usePlayerStore.getState()
              if (
                s.controlsHoldCount === 0 &&
                !s.settingsOpen &&
                !s.playlistOpen &&
                !s.danmakuDialogOpen
              ) {
                clearHideTimer()
                setControlsVisible(false)
              }
            }}
            onDragEnter={(event) => {
              if (miniPlayer || !isFileDrag(event)) return
              event.preventDefault()
              setDragActive(true)
            }}
            onDragOver={(event) => {
              if (isFileDrag(event)) event.preventDefault()
            }}
            onDragLeave={(event) => {
              // Still inside the stage (moving across a child) — not a leave.
              const next = event.relatedTarget as Node | null
              if (next && event.currentTarget.contains(next)) return
              setDragActive(false)
            }}
            onDrop={onDrop}
            // While mini, the picture itself moves the window and a
            // double-click brings the normal window back (onMiniMouseDown)
            // instead of going fullscreen.
            onMouseDown={miniPlayer ? onMiniMouseDown : undefined}
            onDoubleClick={miniPlayer ? undefined : onStageDoubleClick}
            style={{
              position: 'relative',
              width: '100%',
              height: '100%',
              overflow: 'hidden',
              background: '#000',
              cursor: overlaysVisible ? 'default' : 'none',
            }}
          >
            <video
              ref={setVideoRef}
              crossOrigin="anonymous"
              playsInline
              // Mini: a click is the start of a window drag, not play/pause
              // (the hover strip has the button). pointer-events off lets
              // the press reach the stage's mousedown handler.
              onClick={miniPlayer ? undefined : onVideoClick}
              style={{
                pointerEvents: miniPlayer ? 'none' : undefined,
                position: 'absolute',
                inset: 0,
                width: '100%',
                height: '100%',
                objectFit: 'contain',
                background: '#000',
                zIndex: STAGE_Z.VIDEO,
              }}
            />
            {/* upscale <canvas> is injected here (zIndex 1) by UpscaleController */}
            <div
              ref={danmakuLayerRef}
              style={{
                position: 'absolute',
                inset: 0,
                zIndex: STAGE_Z.DANMAKU,
                pointerEvents: 'none',
                overflow: 'hidden',
              }}
            />
            {/* Subtitle layer (zIndex 3): above danmaku, below error/chrome.
                React renders NOTHING into it: SubtitleRenderer owns its
                content and the SubtitleController drives it frame by frame
                (styles: `.sub-*` in public/app.css). Hidden with no media. */}
            <div
              ref={subtitleLayerRef}
              data-subtitle-layer
              style={{
                position: 'absolute',
                inset: 0,
                zIndex: STAGE_Z.SUBTITLE,
                pointerEvents: 'none',
                overflow: 'hidden',
                display: media ? undefined : 'none',
              }}
            />

            {!media && <EmptyState />}

            {!miniPlayer && <CompareDivider />}

            {!miniPlayer && <DropOverlay visible={dragActive} />}

            {mediaError && (
              <Alert
                severity="error"
                variant="filled"
                onClose={() => usePlayerStore.getState().setMediaError(null)}
                sx={{
                  position: 'absolute',
                  top: '50%',
                  left: '50%',
                  transform: 'translate(-50%, -50%)',
                  zIndex: STAGE_Z.MEDIA_ERROR,
                  maxWidth: 'min(560px, 88%)',
                }}
              >
                {mediaError}
                {media?.path ? (
                  <Box
                    component="div"
                    sx={{
                      mt: 0.5,
                      fontSize: 12,
                      opacity: 0.85,
                      wordBreak: 'break-all',
                    }}
                  >
                    {media.path}
                  </Box>
                ) : null}
              </Alert>
            )}

            <AutoSkipOp />
            <Osd />
            <AiSubtitleOverlay />
            {miniPlayer ? (
              <MiniControls visible={controlsVisible} />
            ) : (
              <>
                <TopBar visible={overlaysVisible} platform={platform} />
                {/* No media -> nothing to control; the idle stage stands alone. */}
                {media && (
                  <Controls
                    visible={overlaysVisible}
                    onHeightChange={onControlsHeight}
                  />
                )}
              </>
            )}
          </div>

          <SettingsDrawer />
          <PlaylistDrawer />
          <DanmakuSourceDialog />
        </FullscreenPortalContext.Provider>
      </ThemeProvider>
    </PlayerCommandsContext.Provider>
  )
}

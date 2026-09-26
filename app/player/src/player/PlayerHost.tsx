import { findEpisodeByNumber } from '@danmaku-anywhere/media-parser'
import { Alert, Box, createTheme, ThemeProvider, useTheme } from '@mui/material'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { aiExtractTitle } from '@/danmaku/ai'
import { autoMatch } from '@/danmaku/autoMatch'
import {
  fetchEpisodeComments,
  fetchSeasonEpisodes,
  searchSeasons,
} from '@/danmaku/ddp'
import {
  dirname,
  matchRule,
  REASON_RULE_EPISODE_MISSING,
  unmatchedRuleHint,
} from '@/danmaku/filenameRules'
import { filterComments } from '@/danmaku/filter'
import { parseDanmakuText } from '@/danmaku/parse'
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
import { onUserSeek, resetGeneration } from '@/subtitle/generate'
import { focusEmbeddedExtraction } from '@/subtitle/native'
import { rankSiblingSubtitles } from '@/subtitle/siblings'
import { Controls } from '@/ui/Controls'
import { DanmakuSourceDialog } from '@/ui/DanmakuSourceDialog'
import { EmptyState } from '@/ui/EmptyState'
import { Osd } from '@/ui/Osd'
import { PlaylistDrawer } from '@/ui/PlaylistDrawer'
import { SettingsDrawer } from '@/ui/SettingsDrawer'
import { TopBar } from '@/ui/TopBar'
import { type PlayerCommands, PlayerCommandsContext } from './commands'
import { DanmakuController } from './danmaku/DanmakuController'
import { detectHdrTransfer } from './detectHdr'
import { FullscreenPortalContext } from './fullscreenPortal'
import { type SiblingEpisode, selectBatch } from './siblingEpisodes'
import { SubtitleController } from './subtitle/SubtitleController'
import { SubtitleRenderer } from './subtitle/SubtitleRenderer'
import { UpscaleController } from './upscale/UpscaleController'
import { useKeyboardControls } from './useKeyboardControls'
import { useVideoElement } from './useVideoElement'

const DANMAKU_EXTENSIONS = new Set(['xml', 'json', 'txt'])

const basename = (p: string): string => p.split(/[\\/]/).pop() || p
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

  const media = usePlayerStore((s) => s.media)
  const mediaError = usePlayerStore((s) => s.mediaError)
  const comments = usePlayerStore((s) => s.comments)
  const danmakuSettings = usePlayerStore((s) => s.danmakuSettings)
  const subtitleCues = usePlayerStore((s) => s.subtitleCues)
  const subtitleSettings = usePlayerStore((s) => s.subtitleSettings)
  const videoWidth = usePlayerStore((s) => s.playback.videoWidth)
  const videoHeight = usePlayerStore((s) => s.playback.videoHeight)
  const upscale = usePlayerStore((s) => s.upscale)
  const isHdr = usePlayerStore((s) => s.isHdr)
  const playing = usePlayerStore((s) => s.playback.playing)
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
    subtitleRenderer.applySettings(store.subtitleSettings)
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
  useEffect(() => {
    if (!video) return
    if (!media) {
      video.removeAttribute('src')
      video.load()
      upscaleCtrlRef.current?.reset()
      return
    }
    video.src = media.url
    video.load()
    // Desktop-player behavior: start playing as soon as a file is opened.
    // (The exe allows this via --autoplay-policy; browsers may reject → ignore.)
    void video.play().catch(() => undefined)
    upscaleCtrlRef.current?.reset()
    // Upscale is (re)applied by the HDR-aware decision effect below, once the
    // source's HDR state is known.
    const store = usePlayerStore.getState()
    if (store.comments.length) {
      danmakuCtrlRef.current?.setComments(
        video,
        filterComments(
          store.comments,
          store.danmakuSettings.filters,
          store.danmakuSettings.mergeDuplicates
        ),
        store.danmakuSettings
      )
    }
  }, [media, video])

  // --- detect HDR from the first decoded frame (drives the upscale decision) ---
  useEffect(() => {
    if (!video || !media) return
    let cancelled = false
    const detect = () => {
      if (cancelled) return
      const transfer = detectHdrTransfer(video)
      const store = usePlayerStore.getState()
      store.setHdr(transfer)
      if (transfer && store.upscale.enabled) {
        store.showOsd(
          `${transfer === 'hlg' ? 'HLG' : 'HDR10'} 片源 · 已暂停超分`,
          '🌈'
        )
      }
    }
    type RVFC = HTMLVideoElement & {
      requestVideoFrameCallback?: (cb: () => void) => number
    }
    const v = video as RVFC
    if (typeof v.requestVideoFrameCallback === 'function') {
      v.requestVideoFrameCallback(detect)
    } else {
      video.addEventListener('loadeddata', detect, { once: true })
    }
    return () => {
      cancelled = true
      video.removeEventListener('loadeddata', detect)
    }
  }, [media, video])

  // --- comments (post-filter) -> mount / clear danmaku ---
  useEffect(() => {
    const danmaku = danmakuCtrlRef.current
    if (!video || !danmaku) return
    if (visibleComments.length) {
      danmaku.setComments(
        video,
        visibleComments,
        usePlayerStore.getState().danmakuSettings
      )
    } else {
      danmaku.clear()
    }
  }, [visibleComments, video])

  // --- danmaku settings -> live update ---
  useEffect(() => {
    danmakuCtrlRef.current?.updateSettings(danmakuSettings)
  }, [danmakuSettings])

  // --- subtitles: mount cues / forward settings into controller + renderer ---
  // The controller finds the on-screen lines frame by frame and hands CHANGES
  // straight to the renderer; nothing on this path re-renders React.
  useEffect(() => {
    const ctrl = subtitleCtrlRef.current
    if (!video || !ctrl) return
    if (subtitleCues.length) ctrl.setCues(video, subtitleCues)
    else ctrl.clear()
  }, [subtitleCues, video])

  useEffect(() => {
    subtitleCtrlRef.current?.updateStyle({
      offset: subtitleSettings.offset,
    })
  }, [subtitleSettings.offset])

  // Visibility is a style switch on lines that stay laid out, so toggling
  // subtitles on shows the current line in the very next frame. (The toggle
  // command also applies it synchronously — see `toggleSubtitles`.)
  useEffect(() => {
    subtitleRendererRef.current?.applySettings(subtitleSettings)
  }, [subtitleSettings, video])

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
  useEffect(() => {
    const ctrl = upscaleCtrlRef.current
    if (!ctrl || !video || !media) return
    if (isHdr && upscale.enabled) {
      // disable() (not reset()) so the reported status matches reality — the
      // panel would otherwise keep claiming upscale/interpolation are running.
      ctrl.disable()
      return
    }
    void ctrl.apply(upscale)
  }, [upscale, isHdr, media, video])

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
      if (finished) s.clearProgress(finished)
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

      // --- AI auto-match fallback (no sibling file was mounted) ---
      // Parse the filename, search DanDanPlay, resolve season + episode with
      // the SAME helpers the extension uses, and mount. Runs ONLY inside this
      // IIFE so it inherits the sibling effect's `stale` guard and ordering
      // (sibling wins; this fires only when the loop above mounted nothing).
      // Every await boundary re-reads the store and re-checks identity so a
      // media switch or an explicit load mid-flight can't be clobbered.
      //
      // When the match is not decisive we OPEN THE PICKER instead of guessing:
      // the dialog comes up pre-searched on the parsed title with the episode
      // we believe we want highlighted. A filename the AI does not recognise as
      // a show (a lecture recording, say) stays silent — no picker for those.
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
            const list = await fetchSeasonEpisodes(hit.rule.season)
            s = usePlayerStore.getState()
            if (stale || s.media?.path !== videoPath || s.danmakuSource) return

            const episode = findEpisodeByNumber(list, hit.episode)
            if (!episode) {
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

            const comments = await fetchEpisodeComments(episode.episodeId)
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
              `${hit.exact ? '按命名格式匹配' : '按命名格式匹配（宽松）'} · 第${hit.episode}集 · ${comments.length} 条`,
              '📐'
            )
            return
          } catch {
            // Season gone / offline: fall through to the AI path, which ends in
            // the picker rather than in nothing.
          }
        }
      }

      const info = await aiExtractTitle(basename(videoPath))
      if (!info) return
      s = usePlayerStore.getState()
      if (stale || s.media?.path !== videoPath || s.danmakuSource) return

      const outcome = await autoMatch(basename(videoPath), info, {
        search: searchSeasons,
        episodes: fetchSeasonEpisodes,
      })
      s = usePlayerStore.getState()
      if (stale || s.media?.path !== videoPath || s.danmakuSource) return

      if (outcome.status !== 'matched') {
        if (!outcome.keyword) return
        // If this folder HAS learned rules and none matched, that is almost
        // certainly why we are asking — say so, or "it never learned" is the
        // only thing the user can conclude.
        const hint = unmatchedRuleHint(s.filenameRules, videoPath)
        s.setDanmakuDialogOpen(true, {
          keyword: outcome.keyword,
          targetEpisode:
            outcome.status === 'ambiguous' ? outcome.targetEpisode : 0,
          note: hint ? `${outcome.reason} · ${hint}` : outcome.reason,
        })
        s.showOsd(`${outcome.reason} · 请选择`, '❓')
        return
      }

      let comments
      try {
        comments = await fetchEpisodeComments(outcome.episode.episodeId)
      } catch {
        return
      }
      s = usePlayerStore.getState()
      if (stale || s.media?.path !== videoPath || s.danmakuSource) return
      if (!comments.length) {
        s.showOsd(`${outcome.episode.title || '该集'}暂无弹幕`, '💬')
        return
      }
      s.setComments(comments, {
        label: `${outcome.season.title} · ${outcome.episode.title}`,
        count: comments.length,
      })
      s.showOsd(`AI 匹配弹幕 · ${comments.length} 条`, '🤖')
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
    if (!platform.isTauri || !media?.path || !autoAddSiblings) return
    const videoPath = media.path
    let stale = false
    void (async () => {
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
  }, [media, platform, autoAddSiblings])

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
    if (!media?.path) return
    const videoPath = media.path
    let stale = false
    void (async () => {
      // Probe the embedded tracks on EVERY open, whatever ends up mounted: the
      // picker in 设置 → 字幕 must offer them even when a sibling file wins, and
      // "没有内封字幕" has to mean "we looked", not "we never tried". Started
      // now but NOT awaited yet — a slow ffprobe (network share, a virus
      // scanner's first look) must not hold up an ordinary `.srt`.
      const probing = loadEmbeddedTracks(videoPath)
      const siblings = rankSiblingSubtitles(
        videoPath,
        await platform.listSubtitleFiles(dirname(videoPath))
      )
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
        return
      }
      const tracks = await probing
      if (stale) return
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
    })()
    return () => {
      stale = true
    }
  }, [media, platform])

  // --- resume history: restore last position on open, persist while watching ---
  // Only local files (with a stable `path`) are tracked; browser blob opens have
  // no durable key. Saves are throttled; the cleanup captures the position when
  // switching away, and `pagehide` covers a hard app close.
  useEffect(() => {
    const path = media?.path
    if (!video || !path) return
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
    let lastSave = 0
    const onTimeUpdate = () => {
      const now = performance.now()
      if (now - lastSave < 3000) return
      lastSave = now
      save()
    }
    const onPause = () => save()
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
      // Capture the outgoing position before the media effect swaps the src.
      save()
    }
  }, [media, video])

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
        throw new Error(`未解析到字幕内容: ${name}`)
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
      },
      changeVolume: (delta) => {
        const v = getVideo()
        if (!v) return
        const next = Math.max(0, Math.min(1, v.volume + delta))
        v.volume = next
        if (next > 0) v.muted = false
        store().showOsd(`${Math.round(next * 100)}%`, next === 0 ? '🔇' : '🔊')
      },
      toggleMute: () => {
        const v = getVideo()
        if (!v) return
        v.muted = !v.muted
        store().showOsd(v.muted ? '静音' : '取消静音', v.muted ? '🔇' : '🔊')
      },
      setPlaybackRate: (rate) => {
        const v = getVideo()
        if (v) v.playbackRate = rate
      },
      toggleFullscreen: () => {
        const stage = stageRef.current
        if (!stage) return
        if (document.fullscreenElement) void document.exitFullscreen()
        else void stage.requestFullscreen().catch(() => undefined)
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
          s.showOsd('超分未运行,无法对比', '⇔')
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
        subtitleRendererRef.current?.applySettings(settings)
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

  useKeyboardControls(commands)

  // Expose store + commands for e2e/debugging (harmless in production).
  useEffect(() => {
    ;(window as unknown as Record<string, unknown>).__player = {
      store: usePlayerStore,
      commands,
    }
  }, [commands])

  // --- native (Tauri) OS drag-drop ---
  useEffect(() => {
    if (!platform.isTauri) return
    return platform.onFileDrop((paths) => {
      // Videos first (they reset the playlist + danmaku), then danmaku and
      // subtitle files.
      const videos = paths.filter((p) => VIDEO_EXTENSIONS.has(extOf(p)))
      const danmaku = paths.filter((p) => DANMAKU_EXTENSIONS.has(extOf(p)))
      const subtitles = paths.filter((p) => SUBTITLE_EXTENSIONS.has(extOf(p)))
      if (videos.length) commands.openVideosFromPaths(videos)
      for (const path of danmaku) void commands.loadDanmakuFromPath(path)
      for (const path of subtitles) void commands.loadSubtitleFromPath(path)
    })
  }, [platform, commands])

  // --- browser drag-drop ---
  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault()
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

  // --- controls auto-hide ---
  const revealControls = useCallback(() => {
    setControlsVisible(true)
    if (hideTimer.current) window.clearTimeout(hideTimer.current)
    hideTimer.current = window.setTimeout(() => {
      if (usePlayerStore.getState().playback.playing) setControlsVisible(false)
    }, 2600)
  }, [])

  useEffect(() => {
    return () => {
      if (hideTimer.current) window.clearTimeout(hideTimer.current)
    }
  }, [])

  const overlaysVisible = controlsVisible || !playing || !media

  // Move the subtitle rows clear of the bottom controls while they show.
  useEffect(() => {
    subtitleRendererRef.current?.setLifted(overlaysVisible && !!media)
  }, [overlaysVisible, media, video])

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
            onMouseMove={revealControls}
            onMouseLeave={() => {
              if (usePlayerStore.getState().playback.playing) {
                setControlsVisible(false)
              }
            }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={onDrop}
            onDoubleClick={commands.toggleFullscreen}
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
              onClick={commands.togglePlay}
              style={{
                position: 'absolute',
                inset: 0,
                width: '100%',
                height: '100%',
                objectFit: 'contain',
                background: '#000',
                zIndex: 0,
              }}
            />
            {/* upscale <canvas> is injected here (zIndex 1) by UpscaleController */}
            <div
              ref={danmakuLayerRef}
              style={{
                position: 'absolute',
                inset: 0,
                zIndex: 2,
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
                zIndex: 3,
                pointerEvents: 'none',
                overflow: 'hidden',
                display: media ? undefined : 'none',
              }}
            />

            {!media && <EmptyState />}

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
                  zIndex: 6,
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

            <Osd />
            <TopBar visible={overlaysVisible} platform={platform} />
            {/* No media -> nothing to control; the idle stage stands alone. */}
            {media && (
              <Controls
                visible={overlaysVisible}
                onHeightChange={onControlsHeight}
              />
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

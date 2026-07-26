import { Alert, Box, createTheme, ThemeProvider, useTheme } from '@mui/material'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { parseDanmakuText } from '@/danmaku/parse'
import type { Platform } from '@/platform'
import { type PlaylistItem, usePlayerStore } from '@/store/playerStore'
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
import { UpscaleController } from './upscale/UpscaleController'
import { useKeyboardControls } from './useKeyboardControls'
import { useVideoElement } from './useVideoElement'

const VIDEO_EXTENSIONS = new Set([
  'mp4',
  'm4v',
  'webm',
  'mkv',
  'mov',
  'avi',
  'ts',
  'flv',
  'ogv',
])
const DANMAKU_EXTENSIONS = new Set(['xml', 'json', 'ass', 'txt'])

const basename = (p: string): string => p.split(/[\\/]/).pop() || p
const extOf = (name: string): string =>
  name.split('.').pop()?.toLowerCase() ?? ''
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
  const videoRef = useRef<HTMLVideoElement | null>(null)
  // State-backed so hooks/effects re-run once the element actually mounts.
  const [video, setVideoState] = useState<HTMLVideoElement | null>(null)
  const setVideoRef = useCallback((el: HTMLVideoElement | null) => {
    videoRef.current = el
    setVideoState(el)
  }, [])

  const upscaleCtrlRef = useRef<UpscaleController | null>(null)
  const danmakuCtrlRef = useRef<DanmakuController | null>(null)

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
  const upscale = usePlayerStore((s) => s.upscale)
  const isHdr = usePlayerStore((s) => s.isHdr)
  const playing = usePlayerStore((s) => s.playback.playing)

  const [controlsVisible, setControlsVisible] = useState(true)
  const hideTimer = useRef<number | null>(null)

  useVideoElement(video)

  // --- instantiate engine controllers once the stage DOM + video exist ---
  useEffect(() => {
    const stage = stageRef.current
    const layer = danmakuLayerRef.current
    if (!video || !stage || !layer) return
    const store = usePlayerStore.getState()
    const upscaleCtrl = new UpscaleController(video, stage, {
      onStatus: (status, error) => store.setUpscaleStatus(status, error),
      onInterpolationStatus: (status) => store.setInterpolationStatus(status),
    })
    const danmakuCtrl = new DanmakuController(layer)
    upscaleCtrlRef.current = upscaleCtrl
    danmakuCtrlRef.current = danmakuCtrl
    return () => {
      upscaleCtrl.destroy()
      danmakuCtrl.destroy()
      upscaleCtrlRef.current = null
      danmakuCtrlRef.current = null
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
        store.comments,
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

  // --- comments -> mount / clear danmaku ---
  useEffect(() => {
    const danmaku = danmakuCtrlRef.current
    if (!video || !danmaku) return
    if (comments.length) {
      danmaku.setComments(
        video,
        comments,
        usePlayerStore.getState().danmakuSettings
      )
    } else {
      danmaku.clear()
    }
  }, [comments, video])

  // --- danmaku settings -> live update ---
  useEffect(() => {
    danmakuCtrlRef.current?.updateSettings(danmakuSettings)
  }, [danmakuSettings])

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
        v.currentTime = Math.max(0, Math.min(seconds, dur))
      },
      seekBy: (delta) => {
        const v = getVideo()
        if (!v) return
        const dur = Number.isFinite(v.duration)
          ? v.duration
          : Number.POSITIVE_INFINITY
        const next = Math.max(0, Math.min(v.currentTime + delta, dur))
        v.currentTime = next
        store().showOsd(formatClock(next), delta >= 0 ? '⏩' : '⏪')
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
      // Videos first (they reset the playlist + danmaku), then danmaku files.
      const videos = paths.filter((p) => VIDEO_EXTENSIONS.has(extOf(p)))
      const danmaku = paths.filter((p) => DANMAKU_EXTENSIONS.has(extOf(p)))
      if (videos.length) commands.openVideosFromPaths(videos)
      for (const path of danmaku) void commands.loadDanmakuFromPath(path)
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
      if (videos.length) commands.openVideosFromFiles(videos)
      for (const file of danmaku) {
        void file
          .text()
          .then((text) => commands.loadDanmakuFromText(text, file.name))
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
            {/** biome-ignore lint/a11y/useMediaCaption: danmaku overlay player, no caption track */}
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
            <TopBar visible={overlaysVisible} />
            <Controls visible={overlaysVisible} />
          </div>

          <SettingsDrawer />
          <PlaylistDrawer />
          <DanmakuSourceDialog />
        </FullscreenPortalContext.Provider>
      </ThemeProvider>
    </PlayerCommandsContext.Provider>
  )
}

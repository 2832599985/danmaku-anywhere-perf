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

  const media = usePlayerStore((s) => s.media)
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

  // --- upscale decision: apply, but SUPPRESS on HDR sources ---
  // The Anime4K path renders through an 8-bit sRGB WebGPU canvas, which would
  // clip/mangle HDR (PQ/BT.2020). So for HDR sources we keep the native <video>
  // (which WebView2 outputs/tone-maps correctly) and skip upscaling.
  useEffect(() => {
    const ctrl = upscaleCtrlRef.current
    if (!ctrl || !video || !media) return
    if (isHdr && upscale.enabled) {
      ctrl.reset()
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
      if (!s.playbackSettings.autoAdvance) return
      if (s.playlistIndex >= 0 && s.playlistIndex < s.playlist.length - 1) {
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
      if (s.playlistIndex < 0 || next < 0 || next >= s.playlist.length) return
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
        if (picked.length) store().setPlaylist(picked, 0)
      },
      openVideoFromPath: (path) => {
        store().setPlaylist([itemFromPath(path)], 0)
      },
      openVideoFromFile: (file) => {
        store().setPlaylist([itemFromFile(file)], 0)
      },
      openVideosFromPaths: (paths) => {
        if (paths.length) store().setPlaylist(paths.map(itemFromPath), 0)
      },
      openVideosFromFiles: (files) => {
        if (files.length) store().setPlaylist(files.map(itemFromFile), 0)
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
      <div
        ref={stageRef}
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

        <Osd />
        <TopBar visible={overlaysVisible} />
        <Controls visible={overlaysVisible} />
      </div>

      <SettingsDrawer />
      <PlaylistDrawer />
      <DanmakuSourceDialog />
    </PlayerCommandsContext.Provider>
  )
}

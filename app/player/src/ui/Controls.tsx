import { alpha, Box, Menu, MenuItem } from '@mui/material'
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { usePlayerCommands } from '@/player/commands'
import { useOpEdMarks } from '@/player/useOpEdMarks'
import { usePlayerStore } from '@/store/playerStore'
import type { TargetResolution } from '@/store/settings'
import {
  INK,
  MONO,
  OVERLAY_GRADIENT,
  PAPER,
  SERIF_JP,
  VERMILION,
} from '@/theme/theme'
import { ProgressBar } from './ProgressBar'
import {
  DanmakuQuickButton,
  SubtitleQuickButton,
  UpscaleQuickButton,
} from './QuickButtons'
import { TimeDisplay } from './TimeDisplay'
import { VolumeControl } from './VolumeControl'

const PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 2] as const

/** Human label for the render target shown in the HUD. */
const SCALE_LABEL: Record<TargetResolution, string> = {
  x2: '2×',
  x4: '4×',
  x8: '8×',
  '720p': '720P',
  '1080p': '1080P',
  '2k': '2K',
  '4k': '4K',
  native: '原生',
}

// Keep stage overlays below the top bar's 48px hit area.
const TOP_BAR_HEIGHT = 48
const OVERLAY_TOP = TOP_BAR_HEIGHT + 14

/** 38×38 outlined square — the secondary control shape. */
const squareSx = {
  appearance: 'none',
  width: 38,
  height: 38,
  border: `2px solid ${alpha(PAPER, 0.6)}`,
  background: 'transparent',
  color: PAPER,
  fontSize: 13,
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0,
  padding: 0,
  lineHeight: 1,
  transition: 'background-color 100ms steps(1), color 100ms steps(1)',
  '&:hover': { background: PAPER, color: INK },
  '&:disabled': { opacity: 0.35, cursor: 'default' },
  '&:disabled:hover': { background: 'transparent', color: PAPER },
} as const

interface ControlsProps {
  /** When false, the bar fades and slides out (parent owns the hide timer). */
  visible: boolean
  /**
   * Reports the bar's measured height in px whenever it changes, so the
   * subtitle layer can lift its rows clear of it. The bar's height is a
   * constant (padding + content) while the stage is not, so a percentage
   * lift is wrong at the sizes it was not tuned for.
   */
  onHeightChange?: (height: number) => void
}

export const Controls = ({ visible, onHeightChange }: ControlsProps) => {
  const commands = usePlayerCommands()
  const playing = usePlayerStore((s) => s.playback.playing)
  const fullscreen = usePlayerStore((s) => s.playback.fullscreen)
  const playbackRate = usePlayerStore((s) => s.playback.playbackRate)
  const duration = usePlayerStore((s) => s.playback.duration)
  const danmakuSource = usePlayerStore((s) => s.danmakuSource)
  const comments = usePlayerStore((s) => s.comments)
  const playlist = usePlayerStore((s) => s.playlist)
  const playlistIndex = usePlayerStore((s) => s.playlistIndex)
  const upscale = usePlayerStore((s) => s.upscale)
  const upscaleStatus = usePlayerStore((s) => s.upscaleStatus)

  const [rateAnchor, setRateAnchor] = useState<HTMLElement | null>(null)
  const barRef = useRef<HTMLDivElement | null>(null)
  const [barHeight, setBarHeight] = useState(0)

  // The bar's height depends on its own content (the danmaku density strip
  // appears once comments load, the status capsules come and go), so the
  // subtitle layer needs the measured value — not a percentage of the stage.
  //
  // Measuring it is fussier than it looks: the bar's height is mostly
  // *padding* (`52px 24px 16px`), and `ResizeObserver`'s `contentRect` (what
  // most examples reach for) reports the content box only — 74px against the
  // real 142px border box. Worse, a padding-only height never re-fires the
  // observer, so the value would freeze at whatever it was on first paint.
  // The observer entry's `borderBoxSize` is the honest box; a layout effect
  // measures it again after every commit, which is when the density strip
  // actually arrives.
  const measureBar = useCallback(() => {
    const bar = barRef.current
    if (!bar) return
    // `offsetHeight` rounds to an integer and includes padding + border.
    const height = bar.offsetHeight
    if (height > 0) {
      onHeightChange?.(height)
      setBarHeight((prev) => (prev === height ? prev : height))
    }
  }, [onHeightChange])

  useLayoutEffect(() => {
    measureBar()
  })

  useEffect(() => {
    const bar = barRef.current
    if (!bar) return
    // The observer covers changes that do not re-render this component (the
    // density strip's own resize, a font swap); the layout effect covers the
    // ones that do.
    const observer = new ResizeObserver(measureBar)
    observer.observe(bar)
    return () => observer.disconnect()
  }, [measureBar])

  const canPrev = playlistIndex > 0
  const canNext = playlistIndex >= 0 && playlistIndex < playlist.length - 1

  // 48-bucket danmaku density. Recomputed only when the comment set or the
  // (rounded) duration changes — never per frame.
  const durationKey = Math.round(duration)
  const density = useMemo(() => {
    if (durationKey <= 0 || comments.length === 0) return null
    const BUCKETS = 48
    const bins = new Array<number>(BUCKETS).fill(0)
    for (const c of comments) {
      const t = Number.parseFloat(c.p)
      if (!Number.isFinite(t) || t < 0) continue
      const idx = Math.min(BUCKETS - 1, Math.floor((t / durationKey) * BUCKETS))
      bins[idx] += 1
    }
    let peakIdx = 0
    for (let i = 1; i < BUCKETS; i++) if (bins[i] > bins[peakIdx]) peakIdx = i
    const max = bins[peakIdx]
    if (max === 0) return null
    return {
      bins,
      max,
      peakCount: max,
      peakTime: (peakIdx / BUCKETS) * durationKey,
    }
  }, [comments, durationKey])

  const fi = upscale.frameInterpolation
  const upscaleStats = usePlayerStore((s) => s.upscaleStats)
  const interpolationStatus = usePlayerStore((s) => s.interpolationStatus)
  const playbackSettings = usePlayerStore((s) => s.playbackSettings)
  const currentTime = usePlayerStore((s) => s.playback.currentTime)

  // The "弹幕已挂载" banner confirms a mount, then gets out of the picture.
  // It used to stay up every time the controls showed, parked over the top
  // centre of the video, repeating what the top-bar badge and the danmaku
  // button already say.
  const [bannerVisible, setBannerVisible] = useState(false)
  const sourceKey = danmakuSource
    ? `${danmakuSource.label}|${danmakuSource.count}`
    : null
  useEffect(() => {
    if (!sourceKey) {
      setBannerVisible(false)
      return
    }
    setBannerVisible(true)
    const timer = window.setTimeout(() => setBannerVisible(false), 3500)
    return () => window.clearTimeout(timer)
  }, [sourceKey])
  const showBanner = danmakuSource !== null && bannerVisible

  // OP/ED marks for the skip-OP button.
  const { opEnd } = useOpEdMarks(comments, duration)
  const showSkipOp =
    playbackSettings.skipOpEd !== 'off' && opEnd !== null && currentTime < opEnd
  const autoSkippedRef = useRef(false)

  // Auto-skip OP when mode is 'auto' and we're in the OP zone.
  if (
    playbackSettings.skipOpEd === 'auto' &&
    opEnd !== null &&
    currentTime > 1 &&
    currentTime < opEnd &&
    !autoSkippedRef.current
  ) {
    autoSkippedRef.current = true
    commands.seekTo(opEnd)
  }
  // Reset auto-skip flag when media changes or OP ends.
  if (currentTime >= (opEnd ?? Number.POSITIVE_INFINITY) || currentTime < 1) {
    autoSkippedRef.current = false
  }

  const peakClock = (sec: number) => {
    const s = Math.max(0, Math.floor(sec))
    return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`
  }

  const fade = {
    opacity: visible ? 1 : 0,
    transition: 'opacity 220ms ease',
    pointerEvents: visible ? ('auto' as const) : ('none' as const),
  }

  return (
    <>
      {/* 「再生中」 vertical status flag (design: left rail while playing) */}
      {playing && (
        <Box
          sx={{
            position: 'absolute',
            left: 26,
            top: 96,
            zIndex: 15,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '8px',
            background: alpha(INK, 0.6),
            borderLeft: `3px solid ${VERMILION}`,
            padding: '10px 6px',
            ...fade,
          }}
        >
          <Box
            component="span"
            sx={{
              writingMode: 'vertical-rl',
              fontFamily: SERIF_JP,
              fontSize: 15,
              letterSpacing: '0.3em',
              color: PAPER,
            }}
          >
            再生中
          </Box>
          <Box
            component="span"
            sx={{
              width: 7,
              height: 7,
              background: VERMILION,
              borderRadius: '50%',
              animation: 'ink-blink 1.4s steps(1) infinite',
            }}
          />
        </Box>
      )}

      {/* mounted-danmaku confirmation: shown for a few seconds after a mount,
          on its own timer (independent of the controls' fade) */}
      {showBanner && danmakuSource && (
        <Box
          sx={{
            position: 'absolute',
            top: OVERLAY_TOP,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 15,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '2px',
            background: alpha(INK, 0.7),
            border: `2px solid ${PAPER}`,
            padding: '4px 12px 6px',
            pointerEvents: 'none',
          }}
        >
          <Box
            component="span"
            sx={{
              fontFamily: MONO,
              fontSize: 9,
              letterSpacing: '0.3em',
              color: VERMILION,
              fontWeight: 700,
            }}
          >
            DANMAKU
          </Box>
          <Box
            component="span"
            sx={{
              fontSize: 12,
              fontWeight: 700,
              color: PAPER,
              letterSpacing: '0.12em',
              maxWidth: 420,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            弹幕已挂载 · {danmakuSource.label}
          </Box>
        </Box>
      )}

      {/* Real-time HUD (top-right, below the top bar) */}
      {upscaleStatus === 'active' && upscaleStats !== null && (
        <Box
          sx={{
            position: 'absolute',
            top: OVERLAY_TOP,
            right: 26,
            zIndex: 15,
            background: alpha(INK, 0.82),
            border: `2px solid ${PAPER}`,
            padding: '8px 12px 10px',
            display: 'flex',
            gap: '18px',
            alignItems: 'flex-end',
            ...fade,
          }}
        >
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: '1px' }}>
            <Box
              component="span"
              sx={{
                fontFamily: MONO,
                fontSize: 9,
                letterSpacing: '0.22em',
                color: alpha(PAPER, 0.5),
              }}
            >
              OUTPUT FPS
            </Box>
            <Box
              component="span"
              sx={{
                fontFamily: MONO,
                fontSize: 24,
                fontWeight: 700,
                color: PAPER,
                lineHeight: 1,
              }}
            >
              {upscaleStats.fps}
            </Box>
            {/* The composition, so the big number is never mistaken for the
                display refresh or for the interpolated rate alone. Stated
                factually rather than as a warning: 0 interpolated frames is
                legitimate while paused, on a static passage, or in the first
                second after enabling, so alarming wording would cry wolf. A
                persistent "补帧 0" while playing is the real signal. The one
                definitive failure the engine reports is its fallback state. */}
            {fi.enabled && (
              <Box
                component="span"
                sx={{
                  fontFamily: MONO,
                  fontSize: 8,
                  letterSpacing: '0.1em',
                  color:
                    interpolationStatus === 'fallback'
                      ? VERMILION
                      : alpha(PAPER, 0.45),
                }}
              >
                {interpolationStatus === 'fallback'
                  ? '补帧不可用'
                  : `源 ${upscaleStats.sourceFps} + 补帧 ${upscaleStats.generatedFps}`}
              </Box>
            )}
          </Box>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: '1px' }}>
            <Box
              component="span"
              sx={{
                fontFamily: MONO,
                fontSize: 9,
                letterSpacing: '0.22em',
                color: alpha(PAPER, 0.5),
              }}
            >
              SCALE
            </Box>
            <Box
              component="span"
              sx={{
                fontFamily: MONO,
                fontSize: 15,
                fontWeight: 700,
                color: PAPER,
                lineHeight: 1.6,
              }}
            >
              {SCALE_LABEL[upscale.targetResolution]}
            </Box>
          </Box>
          {/* Mini EQ bars (decorative) */}
          <Box
            sx={{
              display: 'flex',
              gap: '2px',
              alignItems: 'flex-end',
              height: 30,
            }}
          >
            {[0, 1, 2, 3].map((i) => (
              <Box
                key={`hud-bar-${i}`}
                component="span"
                sx={{
                  width: 4,
                  height: '100%',
                  background: i < 2 ? VERMILION : PAPER,
                  transformOrigin: 'bottom',
                  animation: `ink-bar 0.9s ease-in-out ${i * 0.15}s infinite`,
                }}
              />
            ))}
          </Box>
        </Box>
      )}

      {/* Skip OP: bottom-right, just above the control bar — where streaming
          players put it. It does NOT fade with the controls: in 询问 mode the
          point is to offer the skip during the OP, and the controls hide 2.6 s
          after the mouse stops, long before the OP ends. */}
      {showSkipOp && (
        <Box
          component="button"
          type="button"
          onClick={() => {
            if (opEnd !== null) commands.seekTo(opEnd)
          }}
          sx={{
            position: 'absolute',
            right: 30,
            bottom: (visible ? barHeight : 0) + 18,
            zIndex: 31,
            appearance: 'none',
            border: `2px solid ${PAPER}`,
            background: alpha(INK, 0.78),
            color: PAPER,
            fontSize: 13,
            fontWeight: 700,
            padding: '8px 14px',
            cursor: 'pointer',
            letterSpacing: '0.06em',
            boxShadow: `4px 4px 0 ${VERMILION}`,
            transition:
              'background-color 100ms steps(1), color 100ms steps(1), bottom 220ms ease',
            '&:hover': { background: PAPER, color: INK },
          }}
        >
          跳过 OP ▶︎{' '}
          <Box
            component="span"
            sx={{
              fontFamily: MONO,
              fontSize: 11,
              opacity: 0.7,
            }}
          >
            {peakClock(opEnd ?? 0)}
          </Box>
        </Box>
      )}

      {/* bottom bar — gradient only, no frame (per design) */}
      <Box
        ref={barRef}
        data-controls-bar
        sx={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 30,
          padding: '52px 24px 16px',
          background: OVERLAY_GRADIENT,
          opacity: visible ? 1 : 0,
          transform: visible ? 'translateY(0)' : 'translateY(12px)',
          transition: 'opacity 220ms ease, transform 220ms ease',
          pointerEvents: visible ? 'auto' : 'none',
        }}
      >
        <Box sx={{ position: 'relative', margin: '0 6px 14px' }}>
          {density && (
            <>
              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'flex-end',
                  gap: '2px',
                  height: 34,
                  marginBottom: '5px',
                }}
              >
                {density.bins.map((count, i) => (
                  <Box
                    key={`bin-${i}`}
                    sx={{
                      flex: 1,
                      minHeight: 2,
                      height: `${(count / density.max) * 100}%`,
                      opacity: 0.9,
                      background: `linear-gradient(to top, ${VERMILION}, ${alpha(PAPER, 0.85)})`,
                    }}
                  />
                ))}
              </Box>
              <Box
                sx={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  marginBottom: '6px',
                }}
              >
                <Box
                  component="span"
                  sx={{
                    fontFamily: MONO,
                    fontSize: 9,
                    letterSpacing: '0.22em',
                    color: alpha(PAPER, 0.42),
                  }}
                >
                  DANMAKU DENSITY / 弹幕密度
                </Box>
                <Box
                  component="span"
                  sx={{
                    fontFamily: MONO,
                    fontSize: 9,
                    letterSpacing: '0.22em',
                    color: VERMILION,
                  }}
                >
                  PEAK {peakClock(density.peakTime)} · {density.peakCount}
                </Box>
              </Box>
            </>
          )}

          <ProgressBar />
        </Box>

        {/* control row */}
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            '@media (max-width: 1000px)': { gap: '6px' },
            margin: '0 6px',
          }}
        >
          <Box
            component="button"
            type="button"
            aria-label={playing ? '暂停 / Pause' : '播放 / Play'}
            onClick={() => commands.togglePlay()}
            sx={{
              appearance: 'none',
              width: 46,
              height: 46,
              border: `2px solid ${PAPER}`,
              background: PAPER,
              color: INK,
              fontSize: 17,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
              padding: 0,
              lineHeight: 1,
              boxShadow: `4px 4px 0 ${VERMILION}`,
              transition:
                'background-color 100ms steps(1), color 100ms steps(1)',
              '&:hover': { background: VERMILION, color: PAPER },
            }}
          >
            {playing ? '❚❚' : '▶'}
          </Box>

          <Box
            component="button"
            type="button"
            aria-label="上一个 / Previous"
            disabled={!canPrev}
            onClick={() => commands.playlistPrev()}
            sx={{ ...squareSx, fontSize: 12 }}
          >
            |◀
          </Box>
          <Box
            component="button"
            type="button"
            aria-label="下一个 / Next"
            disabled={!canNext}
            onClick={() => commands.playlistNext()}
            sx={{ ...squareSx, fontSize: 12 }}
          >
            ▶|
          </Box>

          <TimeDisplay />
          <VolumeControl />

          <Box sx={{ flex: 1, minWidth: 8 }} />

          <Box
            component="button"
            type="button"
            aria-label="播放速度 / Speed"
            onClick={(e: React.MouseEvent<HTMLElement>) =>
              setRateAnchor(e.currentTarget)
            }
            sx={{
              appearance: 'none',
              border: `2px solid ${alpha(PAPER, 0.6)}`,
              background: 'transparent',
              color: playbackRate !== 1 ? VERMILION : PAPER,
              fontFamily: MONO,
              fontSize: 13,
              fontWeight: 700,
              padding: '8px 10px',
              cursor: 'pointer',
              flexShrink: 0,
              whiteSpace: 'nowrap',
              transition:
                'background-color 100ms steps(1), color 100ms steps(1)',
              '&:hover': { background: PAPER, color: INK },
            }}
          >
            {playbackRate}×
          </Box>
          <Menu
            anchorEl={rateAnchor}
            open={Boolean(rateAnchor)}
            onClose={() => setRateAnchor(null)}
            anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
            transformOrigin={{ vertical: 'bottom', horizontal: 'center' }}
          >
            {PLAYBACK_RATES.map((rate) => (
              <MenuItem
                key={rate}
                dense
                selected={rate === playbackRate}
                onClick={() => {
                  commands.setPlaybackRate(rate)
                  setRateAnchor(null)
                }}
                sx={{ fontFamily: MONO, fontWeight: 700 }}
              >
                {rate}×{rate === 1 ? ' 正常' : ''}
              </MenuItem>
            ))}
          </Menu>

          <UpscaleQuickButton />
          <DanmakuQuickButton />
          <SubtitleQuickButton />

          <Box
            component="button"
            type="button"
            aria-label={
              fullscreen ? '退出全屏 / Exit fullscreen' : '全屏 / Fullscreen'
            }
            onClick={() => commands.toggleFullscreen()}
            sx={squareSx}
          >
            ⛶
          </Box>
        </Box>
      </Box>
    </>
  )
}

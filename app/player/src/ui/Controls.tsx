import { alpha, Box, Menu, MenuItem } from '@mui/material'
import { useMemo, useRef, useState } from 'react'
import { usePlayerCommands } from '@/player/commands'
import { useOpEdMarks } from '@/player/useOpEdMarks'
import { usePlayerStore } from '@/store/playerStore'
import type { TargetResolution } from '@/store/settings'
import {
  GOLD,
  INK,
  MONO,
  OVERLAY_GRADIENT,
  PAPER,
  SERIF_JP,
  VERMILION,
} from '@/theme/theme'
import { ProgressBar } from './ProgressBar'
import { TimeDisplay } from './TimeDisplay'
import { VolumeControl } from './VolumeControl'

const PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 2] as const

/** Human label for the render target shown in the status capsule. */
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
}

export const Controls = ({ visible }: ControlsProps) => {
  const commands = usePlayerCommands()
  const playing = usePlayerStore((s) => s.playback.playing)
  const fullscreen = usePlayerStore((s) => s.playback.fullscreen)
  const playbackRate = usePlayerStore((s) => s.playback.playbackRate)
  const duration = usePlayerStore((s) => s.playback.duration)
  const danmakuVisible = usePlayerStore((s) => s.danmakuSettings.visible)
  const danmakuSource = usePlayerStore((s) => s.danmakuSource)
  const comments = usePlayerStore((s) => s.comments)
  const playlist = usePlayerStore((s) => s.playlist)
  const playlistIndex = usePlayerStore((s) => s.playlistIndex)
  const upscale = usePlayerStore((s) => s.upscale)
  const upscaleStatus = usePlayerStore((s) => s.upscaleStatus)
  const openSettingsAt = usePlayerStore((s) => s.openSettingsAt)

  const [rateAnchor, setRateAnchor] = useState<HTMLElement | null>(null)

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
  const playbackSettings = usePlayerStore((s) => s.playbackSettings)
  const currentTime = usePlayerStore((s) => s.playback.currentTime)
  const statusText =
    upscaleStatus === 'active'
      ? 'ACTIVE'
      : upscaleStatus === 'initializing'
        ? 'INIT'
        : upscaleStatus === 'error'
          ? 'ERR'
          : 'OFF'
  const statusColor =
    upscaleStatus === 'active'
      ? VERMILION
      : upscaleStatus === 'initializing'
        ? GOLD
        : alpha(PAPER, 0.5)

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

      {/* mounted-danmaku banner */}
      {danmakuSource && (
        <Box
          sx={{
            position: 'absolute',
            top: 68,
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
            ...fade,
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

      {/* Real-time HUD (top-right, per design: OUTPUT FPS / SCALE + mini bars) */}
      {upscaleStatus === 'active' && upscaleStats !== null && (
        <Box
          sx={{
            position: 'absolute',
            top: 22,
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

      {/* Skip OP button (top-right, below HUD) */}
      {showSkipOp && (
        <Box
          component="button"
          type="button"
          onClick={() => {
            if (opEnd !== null) commands.seekTo(opEnd)
          }}
          sx={{
            position: 'absolute',
            top: upscaleStatus === 'active' && upscaleStats !== null ? 74 : 22,
            right: 26,
            zIndex: 15,
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
            ...fade,
            transition:
              'background-color 100ms steps(1), color 100ms steps(1), opacity 220ms ease',
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

          {upscale.enabled && (
            <Box
              component="button"
              type="button"
              title="打开画质增强设置"
              onClick={() => openSettingsAt('upscale')}
              sx={{
                appearance: 'none',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                border: `2px solid ${VERMILION}`,
                background: alpha(VERMILION, 0.1),
                padding: '5px 10px',
                cursor: 'pointer',
                flexShrink: 0,
                whiteSpace: 'nowrap',
                transition: 'background-color 100ms steps(1)',
                '&:hover': { background: alpha(VERMILION, 0.24) },
              }}
            >
              <Box
                component="span"
                sx={{
                  width: 7,
                  height: 7,
                  background: VERMILION,
                  borderRadius: '50%',
                  animation:
                    upscaleStatus === 'active'
                      ? 'ink-blink 1.2s steps(1) infinite'
                      : 'none',
                }}
              />
              <Box
                component="span"
                sx={{ fontSize: 12, fontWeight: 700, color: PAPER }}
              >
                {SCALE_LABEL[upscale.targetResolution]} 超分
              </Box>
              {fi.enabled && (
                <>
                  <Box
                    component="span"
                    sx={{
                      // '1px' not 1 — MUI treats bare 0..1 as a percentage.
                      width: '1px',
                      height: 14,
                      background: alpha(PAPER, 0.3),
                    }}
                  />
                  <Box
                    component="span"
                    sx={{ fontSize: 12, fontWeight: 700, color: PAPER }}
                  >
                    补帧{' '}
                    {fi.mode === 'multiplier'
                      ? `${fi.multiplier}×`
                      : fi.targetFps}
                  </Box>
                </>
              )}
              <Box
                component="span"
                sx={{
                  fontFamily: MONO,
                  fontSize: 10,
                  color: statusColor,
                  letterSpacing: '0.1em',
                }}
              >
                {statusText}
              </Box>
            </Box>
          )}

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

          <Box
            component="button"
            type="button"
            onClick={() => commands.toggleDanmaku()}
            sx={{
              appearance: 'none',
              border: `2px solid ${danmakuVisible ? PAPER : alpha(PAPER, 0.6)}`,
              background: danmakuVisible ? PAPER : 'transparent',
              color: danmakuVisible ? INK : PAPER,
              fontSize: 13,
              fontWeight: 700,
              padding: '8px 12px',
              cursor: 'pointer',
              flexShrink: 0,
              whiteSpace: 'nowrap',
              transition:
                'background-color 100ms steps(1), color 100ms steps(1)',
              '&:hover': { background: VERMILION, color: PAPER },
            }}
          >
            弾 弹幕 {danmakuVisible ? 'ON' : 'OFF'}
          </Box>

          <Box
            component="button"
            type="button"
            aria-label="弹幕设置 / Danmaku settings"
            onClick={() => openSettingsAt('danmaku')}
            sx={squareSx}
          >
            ≡
          </Box>
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

import { Alert, Box, Stack, Typography } from '@mui/material'
import { alpha } from '@mui/material/styles'
import { usePlayerStore } from '@/store/playerStore'
import type {
  InterpolationMode,
  InterpolationMultiplier,
  InterpolationResolution,
  InterpolationTargetFps,
  PerformanceTier,
  TargetResolution,
  UpscaleModeId,
} from '@/store/settings'
import {
  GREEN,
  hardShadow,
  INK,
  LINE_STRONG,
  LINE_WEAK,
  MONO,
  PAPER,
  VERMILION,
} from '@/theme/theme'
import {
  InkBlinkDot,
  InkLabel,
  type InkOption,
  InkSection,
  InkSlider,
  InkStamp,
  InkSwitch,
  InkToggleGroup,
} from './ink'

const isWebGpuSupported = (): boolean =>
  typeof navigator !== 'undefined' &&
  'gpu' in navigator &&
  Boolean(navigator.gpu)

const MODES: InkOption<UpscaleModeId>[] = [
  { value: 'builtin-mode-a', label: 'A', mono: true },
  { value: 'builtin-mode-b', label: 'B', mono: true },
  { value: 'builtin-mode-c', label: 'C', mono: true },
  { value: 'builtin-mode-aa', label: 'A+A', mono: true },
  { value: 'builtin-mode-bb', label: 'B+B', mono: true },
  { value: 'builtin-mode-ca', label: 'C+A', mono: true },
]

const MODE_CAPTIONS: Record<UpscaleModeId, string> = {
  'builtin-mode-a': '还原型:适合大多数现代番剧',
  'builtin-mode-b': '去伪影:适合网络低码率片源',
  'builtin-mode-c': '强降噪:适合老片与实拍',
  'builtin-mode-aa': '双重还原:线条更锐利',
  'builtin-mode-bb': '双重去伪影:压缩痕迹重灾区',
  'builtin-mode-ca': '先降噪再锐化线稿,适合老番与低码率片源',
}

const TIERS: InkOption<PerformanceTier>[] = [
  { value: 'performance', label: '快速', mono: true },
  { value: 'balanced', label: '均衡', mono: true },
  { value: 'quality', label: '高质', mono: true },
  { value: 'ultra', label: '极致', mono: true },
]

const SCALES: InkOption<TargetResolution>[] = [
  { value: 'x2', label: '2×', mono: true },
  { value: 'x4', label: '4×', mono: true },
  { value: 'x8', label: '8×', mono: true },
  { value: '720p', label: '720p', mono: true },
  { value: '1080p', label: '1080p', mono: true },
  { value: '2k', label: '2K', mono: true },
  { value: '4k', label: '4K', mono: true },
  { value: 'native', label: '原生', mono: true },
]

const INTERP_MODES: InkOption<InterpolationMode>[] = [
  { value: 'multiplier', label: '倍率', mono: true },
  { value: 'targetFps', label: '目标帧率', mono: true },
]

const INTERP_MULTIPLIERS: InkOption<InterpolationMultiplier>[] = [
  { value: 2, label: '2×', mono: true },
  { value: 3, label: '3×', mono: true },
  { value: 4, label: '4×', mono: true },
]

const INTERP_TARGET_FPS: InkOption<InterpolationTargetFps>[] = [
  { value: 60, label: '60', mono: true },
  { value: 120, label: '120', mono: true },
  { value: 144, label: '144', mono: true },
  { value: 170, label: '170', mono: true },
]

/** Compute target resolution display (handles multipliers and presets). */
const computeTargetDisplay = (
  targetResolution: TargetResolution,
  videoWidth: number,
  videoHeight: number
): string => {
  if (targetResolution === 'native') return `${videoWidth}×${videoHeight}`
  if (targetResolution === 'x2') return `${videoWidth * 2}×${videoHeight * 2}`
  if (targetResolution === 'x4') return `${videoWidth * 4}×${videoHeight * 4}`
  if (targetResolution === 'x8') return `${videoWidth * 8}×${videoHeight * 8}`
  return targetResolution.toUpperCase()
}

export const UpscaleSettings = () => {
  const upscale = usePlayerStore((s) => s.upscale)
  const upscaleStatus = usePlayerStore((s) => s.upscaleStatus)
  const upscaleError = usePlayerStore((s) => s.upscaleError)
  const upscaleStats = usePlayerStore((s) => s.upscaleStats)
  const interpolationStatus = usePlayerStore((s) => s.interpolationStatus)
  const compareRatio = usePlayerStore((s) => s.compareRatio)
  const playback = usePlayerStore((s) => s.playback)
  const updateUpscale = usePlayerStore((s) => s.updateUpscale)
  const setCompareRatio = usePlayerStore((s) => s.setCompareRatio)

  const supported = isWebGpuSupported()
  const fi = upscale.frameInterpolation

  const interpolationCaption =
    interpolationStatus === 'active'
      ? '补帧运行中 · Active'
      : interpolationStatus === 'fallback'
        ? '已回退到 Anime4K（GPU 不支持）· Fell back'
        : null

  // Preset detection
  const presets: {
    id: UpscaleModeId
    name: string
    combo: string
    check: () => boolean
  }[] = [
    {
      id: 'builtin-mode-a',
      name: '省电',
      combo: 'A · 2× · OFF',
      check: () =>
        upscale.modeId === 'builtin-mode-a' &&
        upscale.targetResolution === 'x2' &&
        !fi.enabled,
    },
    {
      id: 'builtin-mode-b',
      name: '均衡',
      combo: 'B · 2× · 60',
      check: () =>
        upscale.modeId === 'builtin-mode-b' &&
        upscale.targetResolution === 'x2' &&
        fi.enabled &&
        fi.mode === 'targetFps' &&
        fi.targetFps === 60,
    },
    {
      id: 'builtin-mode-ca',
      name: '画质狂',
      combo: 'C+A · 4× · 120',
      check: () =>
        upscale.modeId === 'builtin-mode-ca' &&
        upscale.targetResolution === 'x4' &&
        fi.enabled &&
        fi.mode === 'targetFps' &&
        fi.targetFps === 120 &&
        upscale.performanceTier === 'ultra',
    },
  ]

  const activePreset = presets.find((p) => p.check())
  const glyphs = ['◐', '◑', '●']

  return (
    <Stack spacing={2.5}>
      {/* Preset cards */}
      <InkSection zh="一键预设" en="PRESET">
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: '8px',
          }}
        >
          {presets.map((preset, idx) => {
            const isActive = activePreset?.id === preset.id
            return (
              <Box
                key={preset.id}
                component="button"
                type="button"
                onClick={() => {
                  if (preset.id === 'builtin-mode-a') {
                    updateUpscale({
                      enabled: true,
                      modeId: 'builtin-mode-a',
                      targetResolution: 'x2',
                      frameInterpolation: { enabled: false },
                    })
                  } else if (preset.id === 'builtin-mode-b') {
                    updateUpscale({
                      enabled: true,
                      modeId: 'builtin-mode-b',
                      targetResolution: 'x2',
                      frameInterpolation: {
                        enabled: true,
                        mode: 'targetFps',
                        targetFps: 60,
                      },
                    })
                  } else if (preset.id === 'builtin-mode-ca') {
                    updateUpscale({
                      enabled: true,
                      modeId: 'builtin-mode-ca',
                      targetResolution: 'x4',
                      performanceTier: 'ultra',
                      frameInterpolation: {
                        enabled: true,
                        mode: 'targetFps',
                        targetFps: 120,
                      },
                    })
                  }
                }}
                sx={{
                  appearance: 'none',
                  cursor: 'pointer',
                  position: 'relative',
                  padding: '12px 8px',
                  border: isActive ? `3px solid ${VERMILION}` : LINE_WEAK,
                  background: isActive ? alpha(VERMILION, 0.12) : 'transparent',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: '4px',
                  transition:
                    'border 100ms steps(1), background-color 100ms steps(1)',
                  '&:hover': isActive
                    ? {}
                    : { borderColor: PAPER, borderStyle: 'solid' },
                  boxShadow: isActive ? hardShadow(4) : 'none',
                }}
              >
                {isActive && (
                  <InkStamp
                    rotate={-8}
                    sx={{
                      position: 'absolute',
                      top: -11,
                      right: -11,
                    }}
                  >
                    NOW
                  </InkStamp>
                )}
                <Typography
                  sx={{
                    fontSize: 18,
                    fontWeight: 700,
                    color: PAPER,
                  }}
                >
                  {glyphs[idx]}
                </Typography>
                <Typography
                  sx={{
                    fontSize: 12,
                    fontWeight: 700,
                    color: PAPER,
                  }}
                >
                  {preset.name}
                </Typography>
                <Typography
                  sx={{
                    fontFamily: MONO,
                    fontSize: 9,
                    fontWeight: 700,
                    color: alpha(PAPER, 0.6),
                  }}
                >
                  {preset.combo}
                </Typography>
              </Box>
            )
          })}
        </Box>
      </InkSection>

      {/* Master block */}
      <Box sx={{ border: LINE_STRONG, padding: '12px' }}>
        <Stack spacing={1.5}>
          <Stack
            direction="row"
            alignItems="center"
            justifyContent="space-between"
          >
            <InkLabel zh="超分辨率" en="ANIME4K / WEBGPU" size={13} />
            <InkSwitch
              checked={supported && upscale.enabled}
              disabled={!supported}
              onChange={(checked) => updateUpscale({ enabled: checked })}
              label="超分辨率"
            />
          </Stack>

          {!supported && (
            <Alert severity="warning" variant="outlined" sx={{ py: 0.5 }}>
              当前环境不支持 WebGPU，无法启用超分辨率。
              <br />
              WebGPU is not available in this browser.
            </Alert>
          )}

          {/* Status strip */}
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '6px 8px',
              background: INK,
              border: LINE_WEAK,
              minHeight: 28,
            }}
          >
            {upscaleStatus === 'active' && (
              <>
                <InkBlinkDot color={GREEN} size={6} />
                <Typography
                  sx={{
                    fontFamily: MONO,
                    fontSize: 11,
                    fontWeight: 700,
                    color: GREEN,
                    textTransform: 'uppercase',
                    letterSpacing: '0.08em',
                  }}
                >
                  ACTIVE
                </Typography>
                <Typography
                  sx={{
                    fontFamily: MONO,
                    fontSize: 10,
                    fontWeight: 700,
                    color: PAPER,
                    marginLeft: 'auto',
                  }}
                >
                  {playback.videoWidth}×{playback.videoHeight} →{' '}
                  {computeTargetDisplay(
                    upscale.targetResolution,
                    playback.videoWidth,
                    playback.videoHeight
                  )}
                </Typography>
              </>
            )}
            {upscaleStatus === 'initializing' && (
              <>
                <Typography
                  sx={{
                    fontFamily: MONO,
                    fontSize: 11,
                    fontWeight: 700,
                    color: alpha(PAPER, 0.6),
                  }}
                >
                  INIT…
                </Typography>
              </>
            )}
            {upscaleStatus === 'error' && (
              <>
                <Typography
                  sx={{
                    fontFamily: MONO,
                    fontSize: 11,
                    fontWeight: 700,
                    color: VERMILION,
                  }}
                >
                  ERR
                </Typography>
                <Typography
                  sx={{
                    fontFamily: MONO,
                    fontSize: 9,
                    color: VERMILION,
                    marginLeft: 'auto',
                  }}
                >
                  {upscaleError}
                </Typography>
              </>
            )}
            {upscaleStatus === 'idle' && (
              <Typography
                sx={{
                  fontFamily: MONO,
                  fontSize: 10,
                  color: alpha(PAPER, 0.35),
                  letterSpacing: '0.1em',
                }}
              >
                待机中 · STANDBY
              </Typography>
            )}
          </Box>
        </Stack>
      </Box>

      {/* Mode */}
      <InkSection zh="模式" en="MODE">
        <Stack spacing={1}>
          <InkToggleGroup
            options={MODES}
            value={upscale.modeId}
            onChange={(v) => updateUpscale({ modeId: v })}
            columns={3}
          />
          <Typography
            sx={{
              fontFamily: MONO,
              fontSize: 9,
              color: alpha(PAPER, 0.5),
              letterSpacing: '0.04em',
            }}
          >
            {MODE_CAPTIONS[upscale.modeId]}
          </Typography>
        </Stack>
      </InkSection>

      {/* Performance */}
      <InkSection zh="性能" en="PERFORMANCE">
        <InkToggleGroup
          options={TIERS}
          value={upscale.performanceTier}
          onChange={(v) => updateUpscale({ performanceTier: v })}
          columns={4}
        />
      </InkSection>

      {/* Scale */}
      <InkSection zh="缩放" en="SCALE">
        <InkToggleGroup
          options={SCALES}
          value={upscale.targetResolution}
          onChange={(v) => updateUpscale({ targetResolution: v })}
          columns={4}
        />
      </InkSection>

      {/* Divider */}
      <Box sx={{ borderTop: '2px dashed', borderColor: alpha(PAPER, 0.25) }} />

      {/* Frame interpolation */}
      <InkSection zh="补帧" en="FRAME INTERPOLATION · 过载自动跳过">
        <Stack spacing={1.5}>
          <Stack
            direction="row"
            alignItems="center"
            justifyContent="space-between"
          >
            <div />
            <InkSwitch
              checked={fi.enabled}
              onChange={(checked) =>
                updateUpscale({ frameInterpolation: { enabled: checked } })
              }
              label="补帧"
            />
          </Stack>

          {fi.enabled && (
            <>
              <Box>
                <Typography
                  sx={{
                    fontFamily: MONO,
                    fontSize: 9,
                    fontWeight: 700,
                    color: alpha(PAPER, 0.6),
                    textTransform: 'uppercase',
                    letterSpacing: '0.08em',
                    marginBottom: '8px',
                  }}
                >
                  RESOLUTION
                </Typography>
                <InkToggleGroup
                  options={[
                    {
                      value: '480p' as InterpolationResolution,
                      label: '480p',
                      mono: true,
                    },
                    {
                      value: '720p' as InterpolationResolution,
                      label: '720p',
                      mono: true,
                    },
                    {
                      value: '1080p' as InterpolationResolution,
                      label: '1080p',
                      mono: true,
                    },
                  ]}
                  value={fi.resolution}
                  onChange={(v) =>
                    updateUpscale({ frameInterpolation: { resolution: v } })
                  }
                  columns={3}
                />
              </Box>

              <Box>
                <Typography
                  sx={{
                    fontFamily: MONO,
                    fontSize: 9,
                    fontWeight: 700,
                    color: alpha(PAPER, 0.6),
                    textTransform: 'uppercase',
                    letterSpacing: '0.08em',
                    marginBottom: '8px',
                  }}
                >
                  MODE
                </Typography>
                <InkToggleGroup
                  options={INTERP_MODES}
                  value={fi.mode}
                  onChange={(v) =>
                    updateUpscale({ frameInterpolation: { mode: v } })
                  }
                  columns={2}
                />
              </Box>

              {fi.mode === 'multiplier' ? (
                <InkToggleGroup
                  options={INTERP_MULTIPLIERS}
                  value={fi.multiplier}
                  onChange={(v) =>
                    updateUpscale({ frameInterpolation: { multiplier: v } })
                  }
                  columns={3}
                />
              ) : (
                <InkToggleGroup
                  options={INTERP_TARGET_FPS}
                  value={fi.targetFps}
                  onChange={(v) =>
                    updateUpscale({ frameInterpolation: { targetFps: v } })
                  }
                  columns={4}
                  accent
                />
              )}

              <Typography
                sx={{
                  fontFamily: MONO,
                  fontSize: 9,
                  color: alpha(PAPER, 0.5),
                  letterSpacing: '0.04em',
                  lineHeight: 1.5,
                }}
              >
                {fi.mode === 'targetFps'
                  ? '实际倍率随片源帧率自动调整；输出帧率不会超过显示器刷新率。'
                  : '输出帧率 = 片源帧率 × 倍率，且不会超过显示器刷新率。'}
                {fi.resolution === '1080p' &&
                  ' 1080p 下补帧开销约为 720p 的 2 倍，倍率上限自动压到 4×。'}
              </Typography>
            </>
          )}

          {interpolationCaption && (
            <Typography
              sx={{
                fontFamily: MONO,
                fontSize: 9,
                fontWeight: 700,
                color:
                  interpolationStatus === 'fallback'
                    ? alpha(PAPER, 0.6)
                    : GREEN,
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
              }}
            >
              {interpolationCaption}
            </Typography>
          )}

          <Typography
            sx={{
              fontFamily: MONO,
              fontSize: 9,
              color: alpha(PAPER, 0.4),
            }}
          >
            补帧模型（Framegen）仅限个人非商业使用
          </Typography>
        </Stack>
      </InkSection>

      {/* Live HUD */}
      {upscaleStatus === 'active' && upscaleStats !== null && (
        <Box sx={{ border: LINE_STRONG, padding: '12px' }}>
          <Stack spacing={1.5}>
            <Stack
              direction="row"
              alignItems="center"
              justifyContent="space-between"
            >
              <Typography
                sx={{
                  fontFamily: MONO,
                  fontSize: 9,
                  fontWeight: 700,
                  color: alpha(PAPER, 0.6),
                  textTransform: 'uppercase',
                  letterSpacing: '0.08em',
                }}
              >
                LIVE / 实时
              </Typography>
              {interpolationStatus === 'active' && (
                <Typography
                  sx={{
                    fontFamily: MONO,
                    fontSize: 10,
                    fontWeight: 700,
                    color: GREEN,
                    textTransform: 'uppercase',
                    letterSpacing: '0.06em',
                  }}
                >
                  GENERATING {upscaleStats.generatedFps.toFixed(1)} F/S
                </Typography>
              )}
            </Stack>

            <Stack direction="row" spacing={2} alignItems="flex-end">
              <Box sx={{ flex: 1 }}>
                <Typography
                  sx={{
                    fontFamily: MONO,
                    fontSize: 26,
                    fontWeight: 700,
                    color: PAPER,
                  }}
                >
                  {upscaleStats.fps.toFixed(1)}
                </Typography>
                <Typography
                  sx={{
                    fontFamily: MONO,
                    fontSize: 10,
                    fontWeight: 700,
                    color: alpha(PAPER, 0.5),
                    letterSpacing: '0.08em',
                    textTransform: 'uppercase',
                  }}
                >
                  OUT FPS
                </Typography>
              </Box>

              <Box sx={{ flex: 1 }}>
                <Typography
                  sx={{
                    fontFamily: MONO,
                    fontSize: 26,
                    fontWeight: 700,
                    color: VERMILION,
                  }}
                >
                  {upscaleStats.cpuFrameMs.toFixed(1)}
                </Typography>
                <Typography
                  sx={{
                    fontFamily: MONO,
                    fontSize: 10,
                    fontWeight: 700,
                    color: alpha(PAPER, 0.5),
                    letterSpacing: '0.08em',
                    textTransform: 'uppercase',
                  }}
                >
                  MS / FRAME
                </Typography>
              </Box>

              <Stack
                direction="row"
                spacing={0.5}
                sx={{
                  flex: 1,
                  alignItems: 'flex-end',
                  height: 40,
                  gap: '2px',
                }}
              >
                {Array.from({ length: 14 }).map((_, i) => {
                  const height = 30 + ((i * 37) % 60)
                  const delay = i * 0.15
                  return (
                    <Box
                      key={i}
                      sx={{
                        flex: 1,
                        height: `${height}%`,
                        background: PAPER,
                        animation: 'ink-bar 0.8s ease-in-out infinite',
                        animationDelay: `${delay}s`,
                      }}
                    />
                  )
                })}
              </Stack>
            </Stack>
          </Stack>
        </Box>
      )}

      {/* A/B Compare */}
      <InkSection
        zh="A / B 对比"
        action={
          <Typography
            sx={{
              fontFamily: MONO,
              fontSize: 10,
              fontWeight: 700,
              color: VERMILION,
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
            }}
          >
            拖动分割线 ↔
          </Typography>
        }
      >
        <Stack spacing={1}>
          <Stack direction="row" alignItems="center" spacing={1}>
            <InkSwitch
              checked={compareRatio !== null}
              onChange={(checked) => setCompareRatio(checked ? 0.5 : null)}
              disabled={upscaleStatus !== 'active'}
              label="A/B compare"
            />
          </Stack>

          {compareRatio !== null && (
            <InkSlider
              value={compareRatio}
              min={0}
              max={1}
              step={0.01}
              onChange={setCompareRatio}
              aria-label="Compare split"
            />
          )}

          <Typography
            sx={{
              fontFamily: MONO,
              fontSize: 9,
              color: alpha(PAPER, 0.5),
              letterSpacing: '0.04em',
            }}
          >
            快捷键 C · 左增强 右原片
          </Typography>
        </Stack>
      </InkSection>
    </Stack>
  )
}

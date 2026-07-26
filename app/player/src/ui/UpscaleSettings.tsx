import { AutoAwesomeRounded } from '@mui/icons-material'
import {
  Alert,
  Box,
  Chip,
  Divider,
  Stack,
  Switch,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material'
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
import { toggleGridSx } from '@/theme/theme'
import { PanelSection } from './shared'

const isWebGpuSupported = (): boolean =>
  typeof navigator !== 'undefined' &&
  'gpu' in navigator &&
  Boolean(navigator.gpu)

const MODES: { value: UpscaleModeId; label: string }[] = [
  { value: 'builtin-mode-a', label: 'A' },
  { value: 'builtin-mode-b', label: 'B' },
  { value: 'builtin-mode-c', label: 'C' },
  { value: 'builtin-mode-aa', label: 'A+A' },
  { value: 'builtin-mode-bb', label: 'B+B' },
  { value: 'builtin-mode-ca', label: 'C+A' },
]

const TIERS: { value: PerformanceTier; label: string }[] = [
  { value: 'performance', label: '快速 Fast' },
  { value: 'balanced', label: '均衡 Balanced' },
  { value: 'quality', label: '高质 Quality' },
  { value: 'ultra', label: '极致 Ultra' },
]

const SCALES: { value: TargetResolution; label: string }[] = [
  { value: 'x2', label: '2×' },
  { value: 'x4', label: '4×' },
  { value: 'x8', label: '8×' },
  { value: '720p', label: '720p' },
  { value: '1080p', label: '1080p' },
  { value: '2k', label: '2K' },
  { value: '4k', label: '4K' },
  { value: 'native', label: '原生' },
]

const INTERP_MODES: { value: InterpolationMode; label: string }[] = [
  { value: 'multiplier', label: '倍率 Factor' },
  { value: 'targetFps', label: '目标帧率 Target' },
]

const INTERP_MULTIPLIERS: { value: InterpolationMultiplier; label: string }[] =
  [
    { value: 2, label: '2×' },
    { value: 3, label: '3×' },
    { value: 4, label: '4×' },
  ]

const INTERP_TARGET_FPS: { value: InterpolationTargetFps; label: string }[] = [
  { value: 60, label: '60' },
  { value: 120, label: '120' },
  { value: 144, label: '144' },
  { value: 170, label: '170' },
]

export const UpscaleSettings = () => {
  const upscale = usePlayerStore((s) => s.upscale)
  const upscaleStatus = usePlayerStore((s) => s.upscaleStatus)
  const upscaleError = usePlayerStore((s) => s.upscaleError)
  const interpolationStatus = usePlayerStore((s) => s.interpolationStatus)
  const updateUpscale = usePlayerStore((s) => s.updateUpscale)

  const supported = isWebGpuSupported()
  const fi = upscale.frameInterpolation

  const statusChip = () => {
    if (!upscale.enabled) return null
    if (upscaleStatus === 'initializing') {
      return <Chip size="small" color="warning" label="初始化中 Initializing" />
    }
    if (upscaleStatus === 'active') {
      return <Chip size="small" color="success" label="已启用 Active" />
    }
    if (upscaleStatus === 'error') {
      return (
        <Chip
          size="small"
          color="error"
          label={upscaleError ?? '错误 Error'}
          sx={{ maxWidth: 200 }}
        />
      )
    }
    return null
  }

  const interpolationCaption =
    interpolationStatus === 'active'
      ? '补帧运行中 · Active'
      : interpolationStatus === 'fallback'
        ? '已回退到 Anime4K（GPU 不支持）· Fell back'
        : null

  return (
    <Stack spacing={2}>
      {/* master switch */}
      <Stack
        direction="row"
        alignItems="center"
        justifyContent="space-between"
        spacing={1}
      >
        <Stack direction="row" alignItems="center" spacing={1}>
          <AutoAwesomeRounded sx={{ color: 'primary.light' }} />
          <Box>
            <Typography sx={{ fontWeight: 700 }}>超分辨率</Typography>
            <Typography variant="caption" color="text.secondary">
              Super resolution
            </Typography>
          </Box>
        </Stack>
        <Switch
          checked={supported && upscale.enabled}
          disabled={!supported}
          onChange={(_, enabled) => updateUpscale({ enabled })}
          inputProps={{ 'aria-label': '超分辨率 Super resolution' }}
        />
      </Stack>

      {statusChip() && <Box>{statusChip()}</Box>}

      {!supported && (
        <Alert severity="warning" variant="outlined" sx={{ py: 0.5 }}>
          当前环境不支持 WebGPU，无法启用超分辨率。
          <br />
          WebGPU is not available in this browser.
        </Alert>
      )}

      <Divider />

      <PanelSection label="模式 Mode">
        <ToggleButtonGroup
          exclusive
          size="small"
          value={upscale.modeId}
          sx={toggleGridSx(3)}
          onChange={(_, v: UpscaleModeId | null) => {
            if (v) updateUpscale({ modeId: v })
          }}
        >
          {MODES.map((m) => (
            <ToggleButton key={m.value} value={m.value}>
              {m.label}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
      </PanelSection>

      <PanelSection label="性能 Performance">
        <ToggleButtonGroup
          exclusive
          size="small"
          value={upscale.performanceTier}
          sx={toggleGridSx(2)}
          onChange={(_, v: PerformanceTier | null) => {
            if (v) updateUpscale({ performanceTier: v })
          }}
        >
          {TIERS.map((t) => (
            <ToggleButton key={t.value} value={t.value}>
              {t.label}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
      </PanelSection>

      <PanelSection label="缩放 Scale">
        <ToggleButtonGroup
          exclusive
          size="small"
          value={upscale.targetResolution}
          sx={toggleGridSx(4)}
          onChange={(_, v: TargetResolution | null) => {
            if (v) updateUpscale({ targetResolution: v })
          }}
        >
          {SCALES.map((s) => (
            <ToggleButton key={s.value} value={s.value}>
              {s.label}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
      </PanelSection>

      <Divider />

      {/* frame interpolation */}
      <Stack spacing={1.25}>
        <Stack
          direction="row"
          alignItems="center"
          justifyContent="space-between"
          spacing={1}
        >
          <Box>
            <Typography sx={{ fontWeight: 700 }}>补帧</Typography>
            <Typography variant="caption" color="text.secondary">
              Frame interpolation · 过载时自动跳过
            </Typography>
          </Box>
          <Switch
            checked={fi.enabled}
            onChange={(_, enabled) =>
              updateUpscale({ frameInterpolation: { enabled } })
            }
            inputProps={{ 'aria-label': '补帧 Frame interpolation' }}
          />
        </Stack>

        {fi.enabled && (
          <>
            <PanelSection label="补帧分辨率 Resolution">
              <ToggleButtonGroup
                exclusive
                size="small"
                value={fi.resolution}
                sx={toggleGridSx(3)}
                onChange={(_, v: InterpolationResolution | null) => {
                  if (v)
                    updateUpscale({ frameInterpolation: { resolution: v } })
                }}
              >
                <ToggleButton value="480p">480p</ToggleButton>
                <ToggleButton value="720p">720p</ToggleButton>
                <ToggleButton value="1080p">1080p</ToggleButton>
              </ToggleButtonGroup>
            </PanelSection>

            <PanelSection label="模式 Mode">
              <ToggleButtonGroup
                exclusive
                size="small"
                value={fi.mode}
                sx={toggleGridSx(2)}
                onChange={(_, v: InterpolationMode | null) => {
                  if (v) updateUpscale({ frameInterpolation: { mode: v } })
                }}
              >
                {INTERP_MODES.map((m) => (
                  <ToggleButton key={m.value} value={m.value}>
                    {m.label}
                  </ToggleButton>
                ))}
              </ToggleButtonGroup>
            </PanelSection>

            {fi.mode === 'multiplier' ? (
              <PanelSection label="倍率 Factor">
                <ToggleButtonGroup
                  exclusive
                  size="small"
                  value={fi.multiplier}
                  sx={toggleGridSx(3)}
                  onChange={(_, v: InterpolationMultiplier | null) => {
                    if (v)
                      updateUpscale({ frameInterpolation: { multiplier: v } })
                  }}
                >
                  {INTERP_MULTIPLIERS.map((m) => (
                    <ToggleButton key={m.value} value={m.value}>
                      {m.label}
                    </ToggleButton>
                  ))}
                </ToggleButtonGroup>
              </PanelSection>
            ) : (
              <PanelSection label="目标帧率 Target fps">
                <ToggleButtonGroup
                  exclusive
                  size="small"
                  value={fi.targetFps}
                  sx={toggleGridSx(4)}
                  onChange={(_, v: InterpolationTargetFps | null) => {
                    if (v)
                      updateUpscale({ frameInterpolation: { targetFps: v } })
                  }}
                >
                  {INTERP_TARGET_FPS.map((t) => (
                    <ToggleButton key={t.value} value={t.value}>
                      {t.label}
                    </ToggleButton>
                  ))}
                </ToggleButtonGroup>
              </PanelSection>
            )}

            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ opacity: 0.75 }}
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
            variant="caption"
            sx={{
              color:
                interpolationStatus === 'fallback'
                  ? 'warning.main'
                  : 'success.main',
              fontWeight: 600,
            }}
          >
            {interpolationCaption}
          </Typography>
        )}

        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ opacity: 0.7 }}
        >
          补帧模型（Framegen）仅限个人非商业使用
        </Typography>
      </Stack>
    </Stack>
  )
}

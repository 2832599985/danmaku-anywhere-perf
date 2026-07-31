import { ArrowForwardRounded } from '@mui/icons-material'
import { Box, Button, Modal, Stack, Typography } from '@mui/material'
import { alpha } from '@mui/material/styles'
import { usePlayerStore } from '@/store/playerStore'
import {
  INK,
  INK_STAGE,
  LINE_STRONG,
  MONO,
  PAPER,
  VERMILION,
} from '@/theme/theme'
import { DanmakuSettings } from './DanmakuSettings'
import { UpscaleSettings } from './UpscaleSettings'

type SettingsPage = 'shortcuts' | 'playback' | 'danmaku' | 'upscale' | 'about'

const SHORTCUTS: Array<{
  key: string
  zh: string
  en: string
}> = [
  { key: 'Space / K', zh: '播放暂停', en: 'PLAY' },
  { key: '← →', zh: '快退快进', en: 'SEEK' },
  { key: '↑ ↓', zh: '音量', en: 'VOLUME' },
  { key: 'F', zh: '全屏', en: 'FULLSCREEN' },
  { key: 'M', zh: '静音', en: 'MUTE' },
  { key: 'D', zh: '弹幕开关', en: 'DANMAKU' },
  { key: '[ ]', zh: '上一集下一集', en: 'PREV/NEXT' },
  { key: 'U', zh: '超分开关', en: 'UPSCALE' },
  { key: 'C', zh: '增强对比', en: 'COMPARE' },
]

interface StepperCardProps {
  label: string
  /** mono micro-label under the title (e.g. "SEEK STEP · ← / →"). */
  sub?: string
  unit?: string
  value: number
  min: number
  max: number
  onChange: (value: number) => void
}

const StepperCard = ({
  label,
  sub,
  unit = '',
  value,
  min,
  max,
  onChange,
}: StepperCardProps) => (
  // Bordered card per design (the old version had no frame at all).
  <Box
    sx={{
      flex: 1,
      border: LINE_STRONG,
      background: alpha(PAPER, 0.04),
      padding: '14px',
      display: 'flex',
      flexDirection: 'column',
      gap: '10px',
    }}
  >
    <Box sx={{ display: 'flex', flexDirection: 'column' }}>
      <Typography sx={{ fontSize: 14, fontWeight: 900, color: PAPER }}>
        {label}
      </Typography>
      {sub && (
        <Typography
          sx={{
            fontFamily: MONO,
            fontSize: 9,
            letterSpacing: '0.16em',
            color: alpha(PAPER, 0.45),
            textTransform: 'uppercase',
          }}
        >
          {sub}
        </Typography>
      )}
    </Box>
    <Stack
      direction="row"
      alignItems="center"
      justifyContent="center"
      spacing={1}
    >
      <Box
        component="button"
        type="button"
        onClick={() => onChange(Math.max(min, value - 1))}
        sx={{
          appearance: 'none',
          width: 40,
          height: 40,
          padding: 0,
          border: LINE_STRONG,
          background: 'transparent',
          color: PAPER,
          cursor: 'pointer',
          fontWeight: 700,
          transition: 'all 100ms steps(1)',
          '&:hover': {
            background: PAPER,
            color: INK,
          },
        }}
      >
        −
      </Box>
      <Box sx={{ minWidth: 74, textAlign: 'center' }}>
        <Typography
          sx={{
            fontFamily: MONO,
            fontSize: 26,
            fontWeight: 700,
            color: PAPER,
            lineHeight: 1.3,
            overflow: 'hidden',
          }}
        >
          {value}
          {unit && (
            <Box
              component="span"
              sx={{ fontSize: 13, color: alpha(PAPER, 0.5) }}
            >
              {' '}
              {unit}
            </Box>
          )}
        </Typography>
      </Box>
      <Box
        component="button"
        type="button"
        onClick={() => onChange(Math.min(max, value + 1))}
        sx={{
          appearance: 'none',
          width: 40,
          height: 40,
          padding: 0,
          border: LINE_STRONG,
          background: PAPER,
          color: INK,
          cursor: 'pointer',
          fontWeight: 700,
          boxShadow: `3px 3px 0 ${VERMILION}`,
          transition: 'all 100ms steps(1)',
          '&:hover': {
            background: VERMILION,
            color: PAPER,
            borderColor: VERMILION,
          },
        }}
      >
        ＋
      </Box>
    </Stack>
  </Box>
)

const PlaybackSettingsPage = () => {
  const playback = usePlayerStore((s) => s.playbackSettings)
  const updatePlaybackSettings = usePlayerStore((s) => s.updatePlaybackSettings)

  return (
    <Stack spacing={2}>
      <Stack direction="row" spacing={2}>
        <StepperCard
          label="快进步长"
          unit="SEC"
          value={playback.seekStepSec}
          min={1}
          max={120}
          onChange={(v) => updatePlaybackSettings({ seekStepSec: v })}
        />
        <StepperCard
          label="音量步长"
          unit="%"
          value={Math.round(playback.volumeStep * 100)}
          min={1}
          max={50}
          onChange={(v) => updatePlaybackSettings({ volumeStep: v / 100 })}
        />
      </Stack>

      <Box sx={{ border: LINE_STRONG, padding: '16px 12px' }}>
        <Stack
          direction="row"
          alignItems="center"
          justifyContent="space-between"
        >
          <Typography
            sx={{
              fontSize: 12,
              fontWeight: 700,
              color: PAPER,
            }}
          >
            自动连播
          </Typography>
          <Box
            component="button"
            type="button"
            onClick={() =>
              updatePlaybackSettings({
                autoAdvance: !playback.autoAdvance,
              })
            }
            sx={{
              appearance: 'none',
              cursor: 'pointer',
              padding: '4px 9px',
              border: LINE_STRONG,
              background: playback.autoAdvance ? VERMILION : 'transparent',
              color: playback.autoAdvance ? PAPER : alpha(PAPER, 0.4),
              fontFamily: MONO,
              fontSize: 11,
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              transition: 'all 100ms steps(1)',
              '&:hover': {
                borderColor: PAPER,
              },
            }}
          >
            {playback.autoAdvance ? 'ON' : 'OFF'}
          </Box>
        </Stack>
      </Box>
    </Stack>
  )
}

const ShortcutsPage = () => {
  const playback = usePlayerStore((s) => s.playbackSettings)
  const updatePlaybackSettings = usePlayerStore((s) => s.updatePlaybackSettings)

  return (
    <Stack spacing={3}>
      {/* Shortcuts table — 2 columns per design */}
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '10px 26px',
        }}
      >
        {SHORTCUTS.map((sc) => (
          <Box
            key={sc.key}
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              borderBottom: `1px dashed ${alpha(PAPER, 0.18)}`,
              paddingBottom: '9px',
            }}
          >
            <Box
              sx={{
                minWidth: 74,
                padding: '5px 9px',
                border: LINE_STRONG,
                background: alpha(PAPER, 0.08),
                textAlign: 'center',
                boxShadow: `3px 3px 0 ${alpha(PAPER, 0.25)}`,
              }}
            >
              <Typography
                sx={{
                  fontFamily: MONO,
                  fontSize: 13,
                  fontWeight: 700,
                  color: PAPER,
                }}
              >
                {sc.key}
              </Typography>
            </Box>
            <Typography
              sx={{ flex: 1, fontSize: 13, fontWeight: 700, color: PAPER }}
            >
              {sc.zh}
            </Typography>
            <Typography
              sx={{
                fontFamily: MONO,
                fontSize: 10,
                color: alpha(PAPER, 0.4),
                letterSpacing: '0.1em',
              }}
            >
              {sc.en}
            </Typography>
          </Box>
        ))}
      </Box>

      {/* Stepper cards — 3 across per design */}
      <Box sx={{ display: 'flex', gap: '18px' }}>
        <StepperCard
          label="快进步长"
          sub="SEEK STEP · ← / →"
          unit="秒"
          value={playback.seekStepSec}
          min={1}
          max={120}
          onChange={(v) => updatePlaybackSettings({ seekStepSec: v })}
        />
        <StepperCard
          label="音量步长"
          sub="VOLUME STEP · ↑ / ↓"
          unit="%"
          value={Math.round(playback.volumeStep * 100)}
          min={1}
          max={50}
          onChange={(v) => updatePlaybackSettings({ volumeStep: v / 100 })}
        />
        {/* Third card: skip OP/ED mode (design shows 自动/询问/关 switch) */}
        <Box
          sx={{
            flex: 1,
            border: LINE_STRONG,
            background: alpha(PAPER, 0.04),
            padding: '14px',
            display: 'flex',
            flexDirection: 'column',
            gap: '10px',
          }}
        >
          <Box sx={{ display: 'flex', flexDirection: 'column' }}>
            <Typography sx={{ fontSize: 14, fontWeight: 900, color: PAPER }}>
              跳过 OP / ED
            </Typography>
            <Typography
              sx={{
                fontFamily: MONO,
                fontSize: 9,
                letterSpacing: '0.16em',
                color: alpha(PAPER, 0.45),
                textTransform: 'uppercase',
              }}
            >
              SKIP OPENING · 90s
            </Typography>
          </Box>
          <Box
            sx={{
              display: 'flex',
              border: LINE_STRONG,
              cursor: 'pointer',
              alignSelf: 'flex-start',
            }}
          >
            {(['自动', '询问', '关'] as const).map((mode) => {
              const active =
                (mode === '自动' && playback.skipOpEd === 'auto') ||
                (mode === '询问' && playback.skipOpEd === 'ask') ||
                (mode === '关' && playback.skipOpEd === 'off')
              return (
                <Box
                  key={mode}
                  component="button"
                  type="button"
                  onClick={() =>
                    updatePlaybackSettings({
                      skipOpEd:
                        mode === '自动'
                          ? 'auto'
                          : mode === '询问'
                            ? 'ask'
                            : 'off',
                    })
                  }
                  sx={{
                    appearance: 'none',
                    border: 0,
                    padding: '5px 10px',
                    fontFamily: MONO,
                    fontSize: 11,
                    fontWeight: 700,
                    cursor: 'pointer',
                    background: active ? VERMILION : 'transparent',
                    color: active ? PAPER : alpha(PAPER, 0.4),
                    transition: 'all 100ms steps(1)',
                  }}
                >
                  {mode}
                </Box>
              )
            })}
          </Box>
        </Box>
      </Box>
    </Stack>
  )
}

const AboutPage = () => (
  <Stack spacing={2}>
    <Box>
      <Typography
        sx={{
          fontSize: 14,
          fontWeight: 700,
          marginBottom: '8px',
          color: PAPER,
        }}
      >
        弹幕播放器
      </Typography>
      <Typography
        sx={{
          fontFamily: MONO,
          fontSize: 10,
          fontWeight: 700,
          color: alpha(PAPER, 0.6),
          marginBottom: '2px',
        }}
      >
        v0.9.2 · Tauri 2 · WebGPU
      </Typography>
      <Typography
        sx={{
          fontFamily: MONO,
          fontSize: 10,
          fontWeight: 700,
          color: alpha(PAPER, 0.6),
        }}
      >
        HEVC HW · HDR10 ✓
      </Typography>
    </Box>

    <Box>
      <Typography
        sx={{
          fontFamily: MONO,
          fontSize: 9,
          color: alpha(PAPER, 0.4),
          lineHeight: 1.6,
        }}
      >
        补帧模型（Framegen）权重文件仅限个人、非商业使用。
        <br />
        The Framegen weights are licensed for personal, non-commercial use only.
      </Typography>
    </Box>
  </Stack>
)

export const SettingsDrawer = () => {
  const settingsOpen = usePlayerStore((s) => s.settingsOpen)
  const setSettingsOpen = usePlayerStore((s) => s.setSettingsOpen)
  // Section lives in the store so the top bar / controls can deep-link here.
  const page = usePlayerStore((s) => s.settingsSection) as SettingsPage
  const setPage = usePlayerStore((s) => s.setSettingsSection)

  const navItems: Array<{ id: SettingsPage; zh: string }> = [
    { id: 'shortcuts', zh: '快捷键' },
    { id: 'playback', zh: '播放' },
    { id: 'danmaku', zh: '弹幕' },
    { id: 'upscale', zh: '画质增强' },
    { id: 'about', zh: '关于' },
  ]

  const getTitle = (): string => {
    const item = navItems.find((n) => n.id === page)
    return item?.zh ?? ''
  }

  return (
    <Modal
      open={settingsOpen}
      onClose={() => setSettingsOpen(false)}
      slotProps={{
        backdrop: { sx: { backgroundColor: alpha(INK, 0.8) } },
      }}
    >
      <Box
        data-settings-page
        sx={{
          position: 'absolute',
          inset: 0,
          background: INK_STAGE,
          display: 'flex',
          zIndex: 1300,
        }}
      >
        {/* Left navigation rail */}
        <Box
          sx={{
            width: 210,
            background: INK,
            borderRight: LINE_STRONG,
            display: 'flex',
            flexDirection: 'column',
            padding: '18px 12px',
            gap: '16px',
            overflowY: 'auto',
          }}
        >
          {/* Header */}
          <Box>
            <Typography
              sx={{
                fontFamily: MONO,
                fontSize: 9,
                fontWeight: 700,
                color: VERMILION,
                textTransform: 'uppercase',
                letterSpacing: '0.28em',
                marginBottom: '4px',
              }}
            >
              SETTINGS
            </Typography>
            <Typography
              sx={{
                fontSize: 18,
                fontWeight: 900,
                color: PAPER,
                letterSpacing: '0.06em',
              }}
            >
              「設置」
            </Typography>
          </Box>

          {/* Navigation items */}
          <Stack spacing={0.5} sx={{ flex: 1 }}>
            {navItems.map((item) => {
              const isSelected = item.id === page
              return (
                <Box
                  component="button"
                  key={item.id}
                  type="button"
                  onClick={() => setPage(item.id)}
                  sx={{
                    appearance: 'none',
                    cursor: 'pointer',
                    padding: '10px 12px',
                    border: isSelected ? `5px solid ${VERMILION}` : 'none',
                    background: isSelected ? PAPER : 'transparent',
                    color: isSelected ? INK : alpha(PAPER, 0.5),
                    fontSize: 12,
                    fontWeight: 700,
                    textAlign: 'left',
                    transition: 'all 100ms steps(1)',
                    '&:hover': {
                      background: alpha(PAPER, 0.08),
                      color: PAPER,
                    },
                  }}
                >
                  {item.zh}
                </Box>
              )
            })}
          </Stack>

          {/* Bottom info */}
          <Stack spacing={0.5}>
            <Typography
              sx={{
                fontFamily: MONO,
                fontSize: 10,
                fontWeight: 700,
                color: alpha(PAPER, 0.4),
                lineHeight: 1.4,
              }}
            >
              v0.9.2 · Tauri 2
              <br />
              WebGPU
            </Typography>
            <Typography
              sx={{
                fontFamily: MONO,
                fontSize: 10,
                fontWeight: 700,
                color: alpha(PAPER, 0.4),
              }}
            >
              HEVC HW · HDR10 ✓
            </Typography>
          </Stack>
        </Box>

        {/* Right content area */}
        <Box
          sx={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}
        >
          {/* Header row */}
          <Stack
            direction="row"
            alignItems="center"
            justifyContent="space-between"
            sx={{
              padding: '16px 24px',
              borderBottom: `3px solid ${PAPER}`,
              flexShrink: 0,
            }}
          >
            <Box sx={{ display: 'flex', flexDirection: 'column' }}>
              <Typography
                sx={{
                  fontFamily: MONO,
                  fontSize: 9,
                  fontWeight: 700,
                  color: alpha(PAPER, 0.5),
                  textTransform: 'uppercase',
                  letterSpacing: '0.08em',
                  marginBottom: '2px',
                }}
              >
                {page.toUpperCase()}
              </Typography>
              <Typography
                sx={{
                  fontSize: 24,
                  fontWeight: 900,
                  color: PAPER,
                  letterSpacing: '0.06em',
                }}
              >
                {getTitle()}
              </Typography>
            </Box>
            <Button
              variant="outlined"
              size="small"
              endIcon={<ArrowForwardRounded />}
              onClick={() => setSettingsOpen(false)}
              sx={{
                textTransform: 'none',
                fontWeight: 700,
              }}
            >
              返回播放
            </Button>
          </Stack>

          {/* Content area */}
          <Box
            sx={{
              flex: 1,
              overflowY: 'auto',
              padding: '24px 28px',
              minWidth: 0,
            }}
          >
            {page === 'shortcuts' && <ShortcutsPage />}
            {page === 'playback' && <PlaybackSettingsPage />}
            {page === 'danmaku' && <DanmakuSettings />}
            {page === 'upscale' && <UpscaleSettings />}
            {page === 'about' && <AboutPage />}
          </Box>
        </Box>
      </Box>
    </Modal>
  )
}

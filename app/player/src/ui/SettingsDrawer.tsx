import { CloseRounded } from '@mui/icons-material'
import {
  Box,
  Drawer,
  IconButton,
  InputAdornment,
  Stack,
  Tab,
  Tabs,
  TextField,
  Typography,
} from '@mui/material'
import { useState } from 'react'
import { useFullscreenPortalContainer } from '@/player/fullscreenPortal'
import { usePlayerStore } from '@/store/playerStore'
import { DanmakuSettings } from './DanmakuSettings'
import { PanelSection } from './shared'
import { UpscaleSettings } from './UpscaleSettings'

const clampNumber = (n: number, min: number, max: number) =>
  Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : min

const PlaybackSettings = () => {
  const playback = usePlayerStore((s) => s.playbackSettings)
  const updatePlaybackSettings = usePlayerStore((s) => s.updatePlaybackSettings)

  return (
    <Stack spacing={2.5}>
      <PanelSection label="快进步长 Seek step" hint="按 ← / → 键跳转的秒数">
        <TextField
          type="number"
          size="small"
          value={playback.seekStepSec}
          onChange={(e) =>
            updatePlaybackSettings({
              seekStepSec: clampNumber(Number(e.target.value), 1, 120),
            })
          }
          slotProps={{
            htmlInput: { min: 1, max: 120, step: 1 },
            input: {
              endAdornment: <InputAdornment position="end">秒</InputAdornment>,
            },
          }}
          sx={{ width: 160 }}
        />
      </PanelSection>

      <PanelSection
        label="音量步长 Volume step"
        hint="按 ↑ / ↓ 键调整的音量百分比"
      >
        <TextField
          type="number"
          size="small"
          value={Math.round(playback.volumeStep * 100)}
          onChange={(e) =>
            updatePlaybackSettings({
              volumeStep: clampNumber(Number(e.target.value), 1, 50) / 100,
            })
          }
          slotProps={{
            htmlInput: { min: 1, max: 50, step: 1 },
            input: {
              endAdornment: <InputAdornment position="end">%</InputAdornment>,
            },
          }}
          sx={{ width: 160 }}
        />
      </PanelSection>
    </Stack>
  )
}

export const SettingsDrawer = () => {
  const settingsOpen = usePlayerStore((s) => s.settingsOpen)
  const setSettingsOpen = usePlayerStore((s) => s.setSettingsOpen)
  const container = useFullscreenPortalContainer()
  const [tab, setTab] = useState(0)

  return (
    <Drawer
      anchor="right"
      open={settingsOpen}
      onClose={() => setSettingsOpen(false)}
      slotProps={{
        root: { container },
        paper: { sx: { width: 360, maxWidth: '92vw' } },
      }}
    >
      <Stack sx={{ height: '100%' }}>
        <Stack
          direction="row"
          alignItems="center"
          justifyContent="space-between"
          sx={{ px: 2, py: 1.5 }}
        >
          <Typography variant="h6" sx={{ fontWeight: 800 }}>
            设置
          </Typography>
          <IconButton size="small" onClick={() => setSettingsOpen(false)}>
            <CloseRounded fontSize="small" />
          </IconButton>
        </Stack>

        <Tabs
          value={tab}
          onChange={(_, v) => setTab(v)}
          variant="fullWidth"
          sx={{ px: 1, borderBottom: '1px solid', borderColor: 'divider' }}
        >
          <Tab label="画质增强" />
          <Tab label="弹幕" />
          <Tab label="播放" />
        </Tabs>

        <Box sx={{ flex: 1, overflowY: 'auto', px: 2, py: 2 }}>
          {tab === 0 && <UpscaleSettings />}
          {tab === 1 && <DanmakuSettings />}
          {tab === 2 && <PlaybackSettings />}
        </Box>
      </Stack>
    </Drawer>
  )
}

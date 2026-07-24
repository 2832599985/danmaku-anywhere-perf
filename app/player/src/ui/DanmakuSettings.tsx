import { DeleteOutlineRounded, PlaylistAddRounded } from '@mui/icons-material'
import {
  Box,
  Button,
  Chip,
  Divider,
  FormControlLabel,
  Stack,
  Switch,
} from '@mui/material'
import { usePlayerStore } from '@/store/playerStore'
import { LabeledSlider } from './shared'

export const DanmakuSettings = () => {
  const danmaku = usePlayerStore((s) => s.danmakuSettings)
  const danmakuSource = usePlayerStore((s) => s.danmakuSource)
  const updateDanmakuSettings = usePlayerStore((s) => s.updateDanmakuSettings)
  const toggleDanmakuVisible = usePlayerStore((s) => s.toggleDanmakuVisible)
  const clearDanmaku = usePlayerStore((s) => s.clearDanmaku)
  const setDanmakuDialogOpen = usePlayerStore((s) => s.setDanmakuDialogOpen)

  return (
    <Stack spacing={2}>
      <Stack
        direction="row"
        alignItems="center"
        justifyContent="space-between"
        spacing={1}
      >
        <FormControlLabel
          sx={{ m: 0 }}
          control={
            <Switch
              checked={danmaku.visible}
              onChange={() => toggleDanmakuVisible()}
            />
          }
          label="显示弹幕"
        />
        {danmakuSource && (
          <Chip
            size="small"
            label={`${danmakuSource.label} · ${danmakuSource.count}`}
            sx={{
              maxWidth: 180,
              bgcolor: 'rgba(167,139,250,0.16)',
              color: 'primary.light',
            }}
          />
        )}
      </Stack>

      <Divider />

      <LabeledSlider
        label="不透明度 Opacity"
        display={`${Math.round(danmaku.opacity * 100)}%`}
        value={danmaku.opacity}
        min={0}
        max={1}
        step={0.05}
        onChange={(v) => updateDanmakuSettings({ opacity: v })}
      />
      <LabeledSlider
        label="字号 Font size"
        display={`${danmaku.fontSize}px`}
        value={danmaku.fontSize}
        min={12}
        max={48}
        step={1}
        onChange={(v) => updateDanmakuSettings({ fontSize: v })}
      />
      <LabeledSlider
        label="速度 Speed"
        display={`${danmaku.speed.toFixed(1)}×`}
        value={danmaku.speed}
        min={0.5}
        max={2}
        step={0.1}
        onChange={(v) => updateDanmakuSettings({ speed: v })}
      />
      <LabeledSlider
        label="显示区域 Area"
        display={`${Math.round(danmaku.area)}%`}
        value={danmaku.area}
        min={25}
        max={100}
        step={5}
        onChange={(v) => updateDanmakuSettings({ area: v })}
      />
      <LabeledSlider
        label="密度上限 Max on screen"
        display={`${danmaku.maxOnScreen}`}
        value={danmaku.maxOnScreen}
        min={50}
        max={1000}
        step={50}
        onChange={(v) => updateDanmakuSettings({ maxOnScreen: v })}
      />
      <LabeledSlider
        label="时间偏移 Offset"
        display={`${danmaku.offset > 0 ? '+' : ''}${(danmaku.offset / 1000).toFixed(1)}s`}
        value={danmaku.offset}
        min={-10000}
        max={10000}
        step={100}
        onChange={(v) => updateDanmakuSettings({ offset: v })}
      />
      <LabeledSlider
        label="重叠 Overlap"
        display={`${Math.round(danmaku.overlap)}`}
        value={danmaku.overlap}
        min={0}
        max={100}
        step={1}
        onChange={(v) => updateDanmakuSettings({ overlap: v })}
      />

      <Divider />

      <Box sx={{ display: 'flex', gap: 1 }}>
        <Button
          fullWidth
          variant="outlined"
          startIcon={<PlaylistAddRounded />}
          onClick={() => setDanmakuDialogOpen(true)}
        >
          加载弹幕…
        </Button>
        <Button
          fullWidth
          variant="outlined"
          color="error"
          startIcon={<DeleteOutlineRounded />}
          disabled={!danmakuSource}
          onClick={() => clearDanmaku()}
        >
          清除弹幕
        </Button>
      </Box>
    </Stack>
  )
}

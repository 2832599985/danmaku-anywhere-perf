import { DeleteOutlineRounded, PlaylistAddRounded } from '@mui/icons-material'
import { Box, Button, Stack, Typography } from '@mui/material'
import { alpha } from '@mui/material/styles'
import { useState } from 'react'
import { usePlayerStore } from '@/store/playerStore'
import {
  hatchSx,
  INK,
  LINE_STRONG,
  LINE_WEAK,
  MONO,
  PAPER,
  VERMILION,
} from '@/theme/theme'
import {
  InkLabel,
  InkLabeledSlider,
  type InkOption,
  InkSection,
  InkSwitch,
  InkToggleGroup,
} from './ink'

export const DanmakuSettings = () => {
  const danmaku = usePlayerStore((s) => s.danmakuSettings)
  const danmakuSource = usePlayerStore((s) => s.danmakuSource)
  const updateDanmakuSettings = usePlayerStore((s) => s.updateDanmakuSettings)
  const toggleDanmakuVisible = usePlayerStore((s) => s.toggleDanmakuVisible)
  const clearDanmaku = usePlayerStore((s) => s.clearDanmaku)
  const setDanmakuDialogOpen = usePlayerStore((s) => s.setDanmakuDialogOpen)

  const [regexMode, setRegexMode] = useState(false)
  const [filterInput, setFilterInput] = useState('')
  const [editingFilterIdx, setEditingFilterIdx] = useState<number | null>(null)

  const handleAddFilter = () => {
    const trimmed = filterInput.trim()
    if (!trimmed) return

    const isDuplicate = danmaku.filters.some((f) => f.pattern === trimmed)
    if (isDuplicate) {
      setFilterInput('')
      return
    }

    const newFilters = [
      ...danmaku.filters,
      { pattern: trimmed, isRegex: regexMode },
    ]
    updateDanmakuSettings({ filters: newFilters })
    setFilterInput('')
    setEditingFilterIdx(null)
  }

  const handleRemoveFilter = (idx: number) => {
    const newFilters = danmaku.filters.filter((_, i) => i !== idx)
    updateDanmakuSettings({ filters: newFilters })
  }

  const AREA_OPTIONS: InkOption<number>[] = [
    { value: 25, label: '1/4', mono: true },
    { value: 50, label: '半屏', mono: true },
    { value: 80, label: '80%', mono: true },
    { value: 100, label: '全屏', mono: true },
  ]

  return (
    <Stack spacing={2.5}>
      {/* Live preview window */}
      <Box sx={{ border: LINE_STRONG, position: 'relative', ...hatchSx() }}>
        <Box
          sx={{
            height: 96,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            overflow: 'hidden',
            position: 'relative',
          }}
        >
          {/* First scrolling comment — left:100% so ink-dm sweeps R→L. */}
          <Typography
            sx={{
              position: 'absolute',
              left: '100%',
              top: '10px',
              fontSize: danmaku.fontSize * 0.6,
              fontWeight: 700,
              color: PAPER,
              textShadow: `1px 1px 0 ${INK}, -1px -1px 0 ${INK}`,
              whiteSpace: 'nowrap',
              opacity: danmaku.opacity,
              animation: `ink-dm ${7 / danmaku.speed}s linear infinite`,
            }}
          >
            预览:这就是当前样式
          </Typography>

          {/* Second scrolling comment */}
          <Typography
            sx={{
              position: 'absolute',
              left: '100%',
              top: '40px',
              fontSize: danmaku.fontSize * 0.6,
              fontWeight: 700,
              color: VERMILION,
              textShadow: `1px 1px 0 ${INK}, -1px -1px 0 ${INK}`,
              whiteSpace: 'nowrap',
              opacity: danmaku.opacity,
              animation: `ink-dm ${9 / danmaku.speed}s linear infinite`,
              animationDelay: '-3s',
            }}
          >
            草 www
          </Typography>
        </Box>

        {/* Bottom right label */}
        <Typography
          sx={{
            position: 'absolute',
            bottom: 4,
            right: 6,
            fontFamily: MONO,
            fontSize: 9,
            fontWeight: 700,
            color: alpha(PAPER, 0.4),
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
          }}
        >
          LIVE PREVIEW
        </Typography>
      </Box>

      {/* Visible section */}
      <Box sx={{ border: LINE_STRONG, padding: '12px' }}>
        <Stack
          direction="row"
          alignItems="center"
          justifyContent="space-between"
        >
          <InkLabel zh="显示弹幕" en="VISIBLE · 快捷键 D" size={13} />
          <InkSwitch
            checked={danmaku.visible}
            onChange={() => toggleDanmakuVisible()}
            label="显示弹幕"
          />
        </Stack>
        {danmakuSource && (
          <Typography
            sx={{
              fontFamily: MONO,
              fontSize: 10,
              fontWeight: 700,
              color: alpha(PAPER, 0.6),
              marginTop: '8px',
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
            }}
          >
            {danmakuSource.label} · {danmakuSource.count}
          </Typography>
        )}
      </Box>

      {/* Online AI auto-match toggle (Tauri; free built-in AI -> DanDanPlay) */}
      <Box sx={{ border: LINE_STRONG, padding: '12px' }}>
        <Stack
          direction="row"
          alignItems="center"
          justifyContent="space-between"
        >
          <InkLabel zh="在线匹配" en="AUTO · AI + DANDANPLAY" size={13} />
          <InkSwitch
            checked={danmaku.autoOnlineMatch}
            onChange={(v) => updateDanmakuSettings({ autoOnlineMatch: v })}
            label="在线匹配"
          />
        </Stack>
        <Typography
          sx={{
            fontFamily: MONO,
            fontSize: 10,
            fontWeight: 700,
            color: alpha(PAPER, 0.5),
            marginTop: '8px',
            letterSpacing: '0.04em',
            lineHeight: 1.5,
          }}
        >
          无同名弹幕文件时,用文件名经 AI 解析番名/集数并自动挂载
        </Typography>
      </Box>

      {/* Four main sliders */}
      <InkLabeledSlider
        zh="不透明度"
        en="OPACITY"
        display={`${Math.round(danmaku.opacity * 100)}%`}
        value={danmaku.opacity}
        min={0}
        max={1}
        step={0.05}
        onChange={(v) => updateDanmakuSettings({ opacity: v })}
      />

      <InkLabeledSlider
        zh="字号"
        en="FONT SIZE"
        display={`${danmaku.fontSize}px`}
        value={danmaku.fontSize}
        min={12}
        max={48}
        step={1}
        onChange={(v) => updateDanmakuSettings({ fontSize: v })}
      />

      <InkLabeledSlider
        zh="滚动速度"
        en="SPEED"
        display={`${danmaku.speed.toFixed(1)}×`}
        value={danmaku.speed}
        min={0.5}
        max={2}
        step={0.1}
        onChange={(v) => updateDanmakuSettings({ speed: v })}
      />

      <InkLabeledSlider
        zh="时间偏移"
        en="OFFSET"
        display={`${danmaku.offset > 0 ? '+' : ''}${(danmaku.offset / 1000).toFixed(1)}s`}
        value={danmaku.offset}
        min={-10000}
        max={10000}
        step={100}
        onChange={(v) => updateDanmakuSettings({ offset: v })}
        centerTick
      />

      {/* Density and other sliders */}
      <InkLabeledSlider
        zh="密度上限"
        en="MAX ON SCREEN"
        display={`${danmaku.maxOnScreen}`}
        value={danmaku.maxOnScreen}
        min={50}
        max={1000}
        step={50}
        onChange={(v) => updateDanmakuSettings({ maxOnScreen: v })}
      />

      {/* Display area */}
      <InkSection zh="显示区域" en="AREA">
        <InkToggleGroup
          options={AREA_OPTIONS}
          value={danmaku.area}
          onChange={(v) => updateDanmakuSettings({ area: v })}
          columns={4}
        />
      </InkSection>

      {/* Overlap and merge duplicate toggle cards */}
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: 'repeat(2, 1fr)',
          gap: '8px',
        }}
      >
        {/* Overlap toggle card */}
        <Box
          component="button"
          type="button"
          onClick={() =>
            updateDanmakuSettings({
              overlap: danmaku.overlap === 0 ? 100 : 0,
            })
          }
          sx={{
            appearance: 'none',
            cursor: 'pointer',
            padding: '12px 10px',
            border: danmaku.overlap > 0 ? `2px solid ${VERMILION}` : LINE_WEAK,
            background:
              danmaku.overlap > 0 ? alpha(VERMILION, 0.1) : 'transparent',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            transition:
              'border 100ms steps(1), background-color 100ms steps(1)',
            '&:hover': danmaku.overlap > 0 ? {} : { borderColor: PAPER },
          }}
        >
          <Typography
            sx={{
              fontSize: 12,
              fontWeight: 700,
              color: PAPER,
            }}
          >
            允许重叠
          </Typography>
          <Typography
            sx={{
              fontFamily: MONO,
              fontSize: 11,
              fontWeight: 700,
              color: danmaku.overlap > 0 ? VERMILION : alpha(PAPER, 0.4),
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
            }}
          >
            {danmaku.overlap > 0 ? 'ON' : 'OFF'}
          </Typography>
        </Box>

        {/* Merge duplicates toggle card */}
        <Box
          component="button"
          type="button"
          onClick={() =>
            updateDanmakuSettings({
              mergeDuplicates: !danmaku.mergeDuplicates,
            })
          }
          sx={{
            appearance: 'none',
            cursor: 'pointer',
            padding: '12px 10px',
            border: danmaku.mergeDuplicates
              ? `2px solid ${VERMILION}`
              : LINE_WEAK,
            background: danmaku.mergeDuplicates
              ? alpha(VERMILION, 0.1)
              : 'transparent',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            transition:
              'border 100ms steps(1), background-color 100ms steps(1)',
            '&:hover': danmaku.mergeDuplicates ? {} : { borderColor: PAPER },
          }}
        >
          <Typography
            sx={{
              fontSize: 12,
              fontWeight: 700,
              color: PAPER,
            }}
          >
            合并重复
          </Typography>
          <Typography
            sx={{
              fontFamily: MONO,
              fontSize: 11,
              fontWeight: 700,
              color: danmaku.mergeDuplicates ? VERMILION : alpha(PAPER, 0.4),
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
            }}
          >
            {danmaku.mergeDuplicates ? 'ON' : 'OFF'}
          </Typography>
        </Box>
      </Box>

      {/* Filter section */}
      <InkSection
        zh="屏蔽词"
        en={`FILTER · ${danmaku.filters.length}`}
        action={
          <Box
            component="button"
            type="button"
            onClick={() => setRegexMode(!regexMode)}
            sx={{
              appearance: 'none',
              cursor: 'pointer',
              background: 'transparent',
              border: 'none',
              padding: 0,
              color: regexMode ? VERMILION : alpha(PAPER, 0.5),
              fontFamily: MONO,
              fontSize: 10,
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              transition: 'color 100ms steps(1)',
              '&:hover': {
                color: PAPER,
              },
            }}
          >
            正则模式
          </Box>
        }
      >
        <Stack spacing={1}>
          {/* Filter chips */}
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
            {danmaku.filters.map((filter, idx) => (
              <Box
                key={idx}
                sx={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                  padding: '4px 8px',
                  border: LINE_WEAK,
                  background: 'transparent',
                  borderRadius: 0,
                }}
              >
                <Typography
                  sx={{
                    fontFamily: filter.isRegex ? MONO : 'inherit',
                    fontSize: 11,
                    fontWeight: 700,
                    color: PAPER,
                    maxWidth: 120,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {filter.pattern}
                </Typography>
                <Box
                  component="button"
                  type="button"
                  onClick={() => handleRemoveFilter(idx)}
                  sx={{
                    appearance: 'none',
                    cursor: 'pointer',
                    background: 'transparent',
                    border: 'none',
                    padding: 0,
                    color: alpha(PAPER, 0.6),
                    fontSize: 12,
                    fontWeight: 700,
                    transition: 'color 100ms steps(1)',
                    '&:hover': { color: VERMILION },
                  }}
                >
                  ✕
                </Box>
              </Box>
            ))}

            {/* Add filter chip or input */}
            {editingFilterIdx === null ? (
              <Box
                component="button"
                type="button"
                onClick={() => setEditingFilterIdx(-1)}
                sx={{
                  appearance: 'none',
                  cursor: 'pointer',
                  padding: '4px 8px',
                  border: `2px dashed ${alpha(PAPER, 0.3)}`,
                  background: 'transparent',
                  color: alpha(PAPER, 0.5),
                  fontFamily: MONO,
                  fontSize: 11,
                  fontWeight: 700,
                  transition: 'border 100ms steps(1), color 100ms steps(1)',
                  '&:hover': {
                    borderColor: PAPER,
                    color: PAPER,
                  },
                }}
              >
                ＋ 添加
              </Box>
            ) : (
              <Box sx={{ display: 'flex', gap: '4px' }}>
                <Box
                  component="input"
                  type="text"
                  value={filterInput}
                  onChange={(e) => setFilterInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleAddFilter()
                    if (e.key === 'Escape') {
                      setFilterInput('')
                      setEditingFilterIdx(null)
                    }
                  }}
                  autoFocus
                  placeholder="输入..."
                  sx={{
                    appearance: 'none',
                    padding: '4px 6px',
                    border: LINE_WEAK,
                    background: INK,
                    color: PAPER,
                    fontFamily: MONO,
                    fontSize: 11,
                    fontWeight: 700,
                    outline: 'none',
                    minWidth: 100,
                    '&:focus': {
                      borderColor: VERMILION,
                    },
                  }}
                />
                <Box
                  component="button"
                  type="button"
                  onClick={handleAddFilter}
                  sx={{
                    appearance: 'none',
                    cursor: 'pointer',
                    padding: '4px 8px',
                    border: LINE_WEAK,
                    background: alpha(PAPER, 0.1),
                    color: PAPER,
                    fontSize: 11,
                    fontWeight: 700,
                    transition: 'all 100ms steps(1)',
                    '&:hover': {
                      background: PAPER,
                      color: INK,
                    },
                  }}
                >
                  +
                </Box>
              </Box>
            )}
          </Box>
        </Stack>
      </InkSection>

      {/* Action buttons */}
      <Stack direction="row" spacing={1}>
        <Button
          fullWidth
          variant="outlined"
          startIcon={<PlaylistAddRounded />}
          onClick={() => setDanmakuDialogOpen(true)}
          sx={{
            textTransform: 'none',
            fontWeight: 700,
          }}
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
          sx={{
            textTransform: 'none',
            fontWeight: 700,
          }}
        >
          清除弹幕
        </Button>
      </Stack>
    </Stack>
  )
}

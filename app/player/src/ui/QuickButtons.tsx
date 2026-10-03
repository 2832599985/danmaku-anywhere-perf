import { alpha, Box, Typography } from '@mui/material'
import { usePlayerCommands } from '@/player/commands'
import { usePlayerStore } from '@/store/playerStore'
import type { InterpolationMultiplier } from '@/store/settings'
import { GOLD, GREEN, MONO, PAPER, VERMILION } from '@/theme/theme'
import {
  InkLabeledSlider,
  type InkOption,
  InkSwitch,
  InkToggleGroup,
} from './ink'
import {
  FeatureSplitButton,
  QuickAction,
  QuickDivider,
  QuickRow,
} from './QuickPanel'
import { SubtitleSourcePicker } from './SubtitleSourcePicker'

const AREA_OPTIONS: InkOption<number>[] = [
  { value: 25, label: '1/4', mono: true },
  { value: 50, label: '半屏', mono: true },
  { value: 80, label: '80%', mono: true },
  { value: 100, label: '全屏', mono: true },
]

const MULTIPLIERS: InkOption<InterpolationMultiplier>[] = [
  { value: 2, label: '2×', mono: true },
  { value: 3, label: '3×', mono: true },
  { value: 4, label: '4×', mono: true },
]

const QUALITY_OPTIONS: InkOption<
  'performance' | 'balanced' | 'quality' | 'ultra'
>[] = [
  { value: 'performance', label: '快速', mono: true },
  { value: 'balanced', label: '均衡', mono: true },
  { value: 'quality', label: '高质', mono: true },
  { value: 'ultra', label: '极致', mono: true },
]

// ---------------------------------------------------------------------------

export const DanmakuQuickButton = () => {
  const commands = usePlayerCommands()
  const danmaku = usePlayerStore((s) => s.danmakuSettings)
  const danmakuSource = usePlayerStore((s) => s.danmakuSource)
  const update = usePlayerStore((s) => s.updateDanmakuSettings)
  const clearDanmaku = usePlayerStore((s) => s.clearDanmaku)
  const setDanmakuDialogOpen = usePlayerStore((s) => s.setDanmakuDialogOpen)

  return (
    <FeatureSplitButton
      glyph="弾"
      label="弹幕"
      on={danmaku.visible}
      onToggle={() => commands.toggleDanmaku()}
      toggleLabel={danmaku.visible ? '隐藏弹幕 (D)' : '显示弹幕 (D)'}
      status={
        danmakuSource ? `${danmakuSource.count.toLocaleString()} 条` : '未挂载'
      }
      panelKicker="DANMAKU"
      panelTitle="弹幕"
      settingsSection="danmaku"
    >
      {(close) => (
        <>
          <QuickRow
            label="显示弹幕"
            hint={
              danmakuSource
                ? `${danmakuSource.label} · ${danmakuSource.count.toLocaleString()} 条`
                : '还没有挂载弹幕'
            }
          >
            <InkSwitch
              checked={danmaku.visible}
              onChange={() => commands.toggleDanmaku()}
              label="显示弹幕"
            />
          </QuickRow>
          <Box sx={{ display: 'flex', gap: '6px' }}>
            <QuickAction
              onClick={() => {
                close()
                setDanmakuDialogOpen(true)
              }}
            >
              {danmakuSource ? '换弹幕源…' : '挂载弹幕…'}
            </QuickAction>
            <QuickAction
              danger
              disabled={!danmakuSource}
              onClick={() => clearDanmaku()}
            >
              清除弹幕
            </QuickAction>
          </Box>
          <QuickDivider />
          <InkLabeledSlider
            zh="不透明度"
            display={`${Math.round(danmaku.opacity * 100)}%`}
            value={danmaku.opacity}
            min={0}
            max={1}
            step={0.05}
            onChange={(v) => update({ opacity: v })}
          />
          <InkLabeledSlider
            zh="字号"
            display={`${danmaku.fontSize}px`}
            value={danmaku.fontSize}
            min={12}
            max={48}
            step={1}
            onChange={(v) => update({ fontSize: v })}
          />
          <InkLabeledSlider
            zh="滚动速度"
            display={`${danmaku.speed.toFixed(1)}×`}
            value={danmaku.speed}
            min={0.5}
            max={2}
            step={0.1}
            onChange={(v) => update({ speed: v })}
          />
          <Box>
            <Typography
              sx={{ fontSize: 12, fontWeight: 700, color: PAPER, mb: '6px' }}
            >
              显示区域
            </Typography>
            <InkToggleGroup
              options={AREA_OPTIONS}
              value={danmaku.area}
              onChange={(v) => update({ area: v })}
              columns={4}
            />
          </Box>
        </>
      )}
    </FeatureSplitButton>
  )
}

// ---------------------------------------------------------------------------

export const SubtitleQuickButton = () => {
  const commands = usePlayerCommands()
  const subtitle = usePlayerStore((s) => s.subtitleSettings)
  const subtitleSource = usePlayerStore((s) => s.subtitleSource)
  const sttStatus = usePlayerStore((s) => s.sttStatus)
  const sttProgress = usePlayerStore((s) => s.sttProgress)
  const update = usePlayerStore((s) => s.updateSubtitleSettings)
  const generating = sttStatus !== 'idle'

  const status = generating
    ? `${sttStatus === 'extracting' ? '提取' : '识别'} ${Math.round(sttProgress * 100)}%`
    : subtitleSource
      ? subtitle.visible
        ? '开'
        : '关'
      : '无'

  return (
    <FeatureSplitButton
      glyph="字"
      label="字幕"
      // With nothing mounted there is nothing to toggle: the main half opens
      // the panel instead, which is where a subtitle can be loaded.
      on={Boolean(subtitleSource) && subtitle.visible}
      onToggle={subtitleSource ? () => commands.toggleSubtitles() : undefined}
      busy={generating}
      toggleLabel={
        subtitleSource
          ? subtitle.visible
            ? '隐藏字幕 (S)'
            : '显示字幕 (S)'
          : '选择字幕'
      }
      status={status}
      panelKicker="SUBTITLE"
      panelTitle="字幕"
      settingsSection="subtitle"
    >
      {() => (
        <>
          <SubtitleSourcePicker compact />
          <QuickDivider />
          <QuickRow label="显示字幕" hint="快捷键 S">
            <InkSwitch
              checked={subtitle.visible}
              onChange={() => commands.toggleSubtitles()}
              label="显示字幕"
            />
          </QuickRow>
          <InkLabeledSlider
            zh="字号"
            display={`${subtitle.fontSize}px`}
            min={16}
            max={64}
            step={2}
            value={subtitle.fontSize}
            onChange={(value) => update({ fontSize: value })}
          />
          <InkLabeledSlider
            zh="时轴偏移"
            en="快捷键 , / ."
            display={`${subtitle.offset >= 0 ? '+' : ''}${subtitle.offset}ms`}
            min={-10000}
            max={10000}
            step={100}
            value={subtitle.offset}
            centerTick
            onChange={(value) => update({ offset: value })}
          />
        </>
      )}
    </FeatureSplitButton>
  )
}

// ---------------------------------------------------------------------------

const SCALE_LABEL: Record<string, string> = {
  x2: '2×',
  x4: '4×',
  x8: '8×',
  '720p': '720P',
  '1080p': '1080P',
  '2k': '2K',
  '4k': '4K',
  native: '原生',
}

export const UpscaleQuickButton = () => {
  const commands = usePlayerCommands()
  const upscale = usePlayerStore((s) => s.upscale)
  const upscaleStatus = usePlayerStore((s) => s.upscaleStatus)
  const upscaleError = usePlayerStore((s) => s.upscaleError)
  const interpolationStatus = usePlayerStore((s) => s.interpolationStatus)
  const compareRatio = usePlayerStore((s) => s.compareRatio)
  const isHdr = usePlayerStore((s) => s.isHdr)
  const update = usePlayerStore((s) => s.updateUpscale)
  const setCompareRatio = usePlayerStore((s) => s.setCompareRatio)
  const fi = upscale.frameInterpolation

  const running = upscaleStatus === 'active'
  const status = !upscale.enabled
    ? '关'
    : upscaleStatus === 'initializing'
      ? '启动中'
      : upscaleStatus === 'error'
        ? '出错'
        : fi.enabled
          ? `${SCALE_LABEL[upscale.targetResolution]} · 补帧 ${fi.mode === 'multiplier' ? `${fi.multiplier}×` : fi.targetFps}`
          : SCALE_LABEL[upscale.targetResolution]

  return (
    <FeatureSplitButton
      glyph="超"
      label="画质"
      on={upscale.enabled}
      onToggle={() => commands.toggleUpscale()}
      toggleLabel={upscale.enabled ? '关闭超分 (U)' : '开启超分 (U)'}
      status={status}
      panelKicker="ENHANCE"
      panelTitle="画质增强"
      settingsSection="upscale"
    >
      {() => (
        <>
          <QuickRow
            label="超分辨率"
            hint={
              isHdr
                ? 'HDR 片源不做超分（会破坏 HDR）'
                : upscaleStatus === 'error'
                  ? (upscaleError ?? '出错')
                  : running
                    ? '运行中 · 快捷键 U'
                    : '快捷键 U'
            }
          >
            <InkSwitch
              checked={upscale.enabled}
              onChange={() => commands.toggleUpscale()}
              label="超分辨率"
            />
          </QuickRow>
          <Box>
            <Typography
              sx={{ fontSize: 12, fontWeight: 700, color: PAPER, mb: '6px' }}
            >
              性能档位
            </Typography>
            <InkToggleGroup
              options={QUALITY_OPTIONS}
              value={upscale.performanceTier}
              onChange={(v) => update({ performanceTier: v })}
              columns={4}
              disabled={!upscale.enabled}
            />
          </Box>
          <QuickDivider />
          <QuickRow
            label="补帧"
            hint={
              interpolationStatus === 'fallback'
                ? '补帧暂不可用，仍可使用超分'
                : fi.mode === 'targetFps'
                  ? `目标 ${fi.targetFps} fps（在更多设置里改）`
                  : undefined
            }
          >
            <InkSwitch
              checked={fi.enabled}
              disabled={!upscale.enabled}
              onChange={(checked) =>
                update({ frameInterpolation: { enabled: checked } })
              }
              label="补帧"
            />
          </QuickRow>
          {fi.enabled && fi.mode === 'multiplier' && (
            <InkToggleGroup
              options={MULTIPLIERS}
              value={fi.multiplier}
              onChange={(v) =>
                update({ frameInterpolation: { multiplier: v } })
              }
              columns={3}
              disabled={!upscale.enabled}
            />
          )}
          <QuickDivider />
          <QuickRow label="A / B 对比" hint="左增强 右原片 · 快捷键 C">
            <InkSwitch
              checked={compareRatio !== null}
              disabled={!running}
              onChange={(checked) => setCompareRatio(checked ? 0.5 : null)}
              label="A/B 对比"
            />
          </QuickRow>
          {running && (
            <Typography
              sx={{
                fontFamily: MONO,
                fontSize: 10,
                fontWeight: 700,
                color:
                  interpolationStatus === 'fallback' ? GOLD : alpha(GREEN, 0.9),
              }}
            >
              {interpolationStatus === 'fallback'
                ? '补帧不可用 · 仅超分'
                : fi.enabled
                  ? '超分 + 补帧运行中'
                  : '超分运行中'}
            </Typography>
          )}
          {upscaleStatus === 'error' && upscaleError && (
            <Typography
              sx={{ fontSize: 11, fontWeight: 700, color: VERMILION }}
            >
              {upscaleError}
            </Typography>
          )}
        </>
      )}
    </FeatureSplitButton>
  )
}

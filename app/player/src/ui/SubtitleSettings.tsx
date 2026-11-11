import { Box, Stack } from '@mui/material'
import { getPlatform } from '@/platform'
import { usePlayerStore } from '@/store/playerStore'
import { LINE_STRONG } from '@/theme/theme'
import { AiSubtitleSettings } from './AiSubtitleSettings'
import { InkLabel, InkLabeledSlider, InkSection, InkSwitch } from './ink'
import { SubtitleSourcePicker } from './SubtitleSourcePicker'

export const SubtitleSettings = () => {
  const subtitle = usePlayerStore((s) => s.subtitleSettings)
  const update = usePlayerStore((s) => s.updateSubtitleSettings)
  const isTauri = getPlatform().isTauri

  return (
    <Stack spacing={2.5}>
      <InkSection zh="来源" en="SOURCE">
        <SubtitleSourcePicker />
      </InkSection>

      <InkSection zh="显示" en="DISPLAY">
        <Box sx={{ border: LINE_STRONG, padding: '12px' }}>
          <Stack
            direction="row"
            alignItems="center"
            justifyContent="space-between"
          >
            <InkLabel zh="显示字幕" en="VISIBLE · 快捷键 S" size={13} />
            <InkSwitch
              checked={subtitle.visible}
              onChange={(checked) => update({ visible: checked })}
              label="显示字幕"
            />
          </Stack>
        </Box>
        <InkLabeledSlider
          zh="字号"
          en="FONT SIZE"
          display={`${subtitle.fontSize}px`}
          min={16}
          max={64}
          step={2}
          value={subtitle.fontSize}
          onChange={(value) => update({ fontSize: value })}
        />
        <InkLabeledSlider
          zh="底部边距"
          en="BOTTOM OFFSET"
          display={`${subtitle.bottom}%`}
          min={0}
          max={30}
          step={1}
          value={subtitle.bottom}
          onChange={(value) => update({ bottom: value })}
        />
        <InkLabeledSlider
          zh="不透明度"
          en="OPACITY"
          display={`${Math.round(subtitle.opacity * 100)}%`}
          min={0.3}
          max={1}
          step={0.05}
          value={subtitle.opacity}
          onChange={(value) => update({ opacity: value })}
        />
        <InkLabeledSlider
          zh="时轴偏移"
          en="OFFSET · , / ."
          display={`${subtitle.offset >= 0 ? '+' : ''}${subtitle.offset}ms`}
          min={-10000}
          max={10000}
          step={100}
          value={subtitle.offset}
          centerTick
          onChange={(value) => update({ offset: value })}
        />
        <Box sx={{ border: LINE_STRONG, padding: '12px' }}>
          <Stack
            direction="row"
            alignItems="center"
            justifyContent="space-between"
          >
            <InkLabel zh="墨色描边" en="OUTLINE" size={13} />
            <InkSwitch
              checked={subtitle.outline}
              onChange={(checked) => update({ outline: checked })}
              label="墨色描边"
            />
          </Stack>
        </Box>
      </InkSection>

      {isTauri && (
        <InkSection zh="AI 字幕" en="AI SUBTITLES">
          <AiSubtitleSettings />
        </InkSection>
      )}
    </Stack>
  )
}

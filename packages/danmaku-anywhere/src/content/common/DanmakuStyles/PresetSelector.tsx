import { Chip, Stack, Typography } from '@mui/material'
import { useTranslation } from 'react-i18next'
import type { DanmakuOptions } from '@/common/options/danmakuOptions/constant'
import {
  type DanmakuPresetId,
  danmakuPresets,
} from '@/common/options/danmakuOptions/presets'

interface PresetSelectorProps {
  activePreset: DanmakuPresetId | null
  onSelect: (presetId: DanmakuPresetId) => void
}

const presetLabelKeys: Record<DanmakuPresetId, string> = {
  minimal: 'stylePage.preset.minimal',
  balanced: 'stylePage.preset.balanced',
  immersive: 'stylePage.preset.immersive',
  eyeCare: 'stylePage.preset.eyeCare',
}

const presetLabelDefaults: Record<DanmakuPresetId, string> = {
  minimal: 'Minimal',
  balanced: 'Balanced',
  immersive: 'Immersive',
  eyeCare: 'Eye-Care',
}

/**
 * Check if current config matches a preset (ignoring fields not in the preset like filters, offset, etc.)
 */
export const detectActivePreset = (
  config: DanmakuOptions
): DanmakuPresetId | null => {
  for (const preset of danmakuPresets) {
    const v = preset.values
    if (
      v.style &&
      v.area &&
      config.style.opacity === v.style.opacity &&
      config.style.fontSize === v.style.fontSize &&
      config.speed === v.speed &&
      config.maxOnScreen === v.maxOnScreen &&
      config.trackHeight === v.trackHeight &&
      config.overlap === v.overlap &&
      config.interval === v.interval &&
      config.area.yStart === v.area.yStart &&
      config.area.yEnd === v.area.yEnd
    ) {
      return preset.id
    }
  }
  return null
}

export const PresetSelector = ({
  activePreset,
  onSelect,
}: PresetSelectorProps) => {
  const { t } = useTranslation()

  return (
    <Stack spacing={1}>
      <Typography variant="body2" color="text.secondary">
        {t('stylePage.preset.label', 'Presets')}
      </Typography>
      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
        {danmakuPresets.map((preset) => (
          <Chip
            key={preset.id}
            label={t(
              presetLabelKeys[preset.id],
              presetLabelDefaults[preset.id]
            )}
            variant={activePreset === preset.id ? 'filled' : 'outlined'}
            color={activePreset === preset.id ? 'primary' : 'default'}
            onClick={() => onSelect(preset.id)}
            size="small"
          />
        ))}
        <Chip
          label={t('stylePage.preset.custom', 'Custom')}
          variant={activePreset === null ? 'filled' : 'outlined'}
          color={activePreset === null ? 'primary' : 'default'}
          size="small"
          disabled
        />
      </Stack>
    </Stack>
  )
}

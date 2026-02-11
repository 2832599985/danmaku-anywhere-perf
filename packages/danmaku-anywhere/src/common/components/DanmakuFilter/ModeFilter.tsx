import type { DanmakuModeFilter } from '@danmaku-anywhere/danmaku-engine'
import {
  Box,
  Checkbox,
  FormControlLabel,
  FormGroup,
  Typography,
} from '@mui/material'
import { useTranslation } from 'react-i18next'

type ModeFilterProps = {
  modeFilter: DanmakuModeFilter
  onChange: (mode: keyof DanmakuModeFilter, checked: boolean) => void
}

export const ModeFilter = ({ modeFilter, onChange }: ModeFilterProps) => {
  const { t } = useTranslation()

  const modes: Array<{ key: keyof DanmakuModeFilter; label: string }> = [
    { key: 'rtl', label: t('danmakuFilter.modeFilter.rtl') },
    { key: 'ltr', label: t('danmakuFilter.modeFilter.ltr') },
    { key: 'top', label: t('danmakuFilter.modeFilter.top') },
    { key: 'bottom', label: t('danmakuFilter.modeFilter.bottom') },
  ]

  return (
    <Box>
      <Typography variant="subtitle2" gutterBottom>
        {t('danmakuFilter.modeFilter.title')}
      </Typography>
      <FormGroup row>
        {modes.map(({ key, label }) => (
          <FormControlLabel
            key={key}
            control={
              <Checkbox
                size="small"
                checked={modeFilter[key]}
                onChange={(e) => onChange(key, e.target.checked)}
              />
            }
            label={label}
          />
        ))}
      </FormGroup>
    </Box>
  )
}

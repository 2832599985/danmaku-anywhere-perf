import type { DanmakuColorFilter } from '@danmaku-anywhere/danmaku-engine'
import { Close } from '@mui/icons-material'
import {
  Box,
  Button,
  Checkbox,
  Chip,
  FormControlLabel,
  IconButton,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { withStopPropagation } from '@/common/utils/withStopPropagation'

type ColorFilterProps = {
  colorFilter: DanmakuColorFilter
  onToggleEnabled: (enabled: boolean) => void
  onToggleOnlyWhite: (onlyWhite: boolean) => void
  onAddBlacklistColor: (color: string) => void
  onRemoveBlacklistColor: (index: number) => void
}

const HEX_COLOR_REGEX = /^#[0-9a-f]{6}$/i

export const ColorFilter = ({
  colorFilter,
  onToggleEnabled,
  onToggleOnlyWhite,
  onAddBlacklistColor,
  onRemoveBlacklistColor,
}: ColorFilterProps) => {
  const { t } = useTranslation()
  const [colorInput, setColorInput] = useState('#')
  const [colorError, setColorError] = useState('')

  const handleAddColor = () => {
    const trimmed = colorInput.trim().toLowerCase()
    if (!HEX_COLOR_REGEX.test(trimmed)) {
      setColorError(t('danmakuFilter.validation.invalidColor'))
      return
    }
    if (colorFilter.blacklist.some((c) => c.toLowerCase() === trimmed)) {
      setColorError(t('danmakuFilter.validation.duplicate'))
      return
    }
    onAddBlacklistColor(trimmed)
    setColorInput('#')
    setColorError('')
  }

  return (
    <Box>
      <Typography variant="subtitle2" gutterBottom>
        {t('danmakuFilter.colorFilter.title')}
      </Typography>
      <Stack spacing={1}>
        <FormControlLabel
          control={
            <Checkbox
              size="small"
              checked={colorFilter.enabled}
              onChange={(e) => onToggleEnabled(e.target.checked)}
            />
          }
          label={t('danmakuFilter.colorFilter.enabled')}
        />
        {colorFilter.enabled && (
          <>
            <FormControlLabel
              control={
                <Checkbox
                  size="small"
                  checked={colorFilter.onlyWhite}
                  onChange={(e) => onToggleOnlyWhite(e.target.checked)}
                />
              }
              label={t('danmakuFilter.colorFilter.onlyWhite')}
            />
            {!colorFilter.onlyWhite && (
              <>
                <Typography variant="body2" color="text.secondary">
                  {t('danmakuFilter.colorFilter.blacklistColors')}
                </Typography>
                <Stack direction="row" spacing={1} alignItems="flex-start">
                  <TextField
                    size="small"
                    value={colorInput}
                    onChange={(e) => {
                      setColorInput(e.target.value)
                      setColorError('')
                    }}
                    error={!!colorError}
                    helperText={colorError}
                    placeholder="#ff0000"
                    sx={{ width: 140 }}
                    {...withStopPropagation()}
                  />
                  <Box
                    sx={{
                      width: 40,
                      height: 40,
                      borderRadius: 1,
                      border: '1px solid',
                      borderColor: 'divider',
                      bgcolor: HEX_COLOR_REGEX.test(colorInput.trim())
                        ? colorInput.trim()
                        : 'transparent',
                      flexShrink: 0,
                    }}
                  />
                  <Button
                    variant="contained"
                    size="small"
                    onClick={handleAddColor}
                    sx={{ height: 40 }}
                  >
                    {t('danmakuFilter.colorFilter.addColor')}
                  </Button>
                </Stack>
                <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                  {colorFilter.blacklist.map((color, i) => (
                    <Chip
                      key={color}
                      label={color}
                      size="small"
                      onDelete={() => onRemoveBlacklistColor(i)}
                      deleteIcon={
                        <IconButton size="small">
                          <Close fontSize="small" />
                        </IconButton>
                      }
                      sx={{
                        '& .MuiChip-label': { fontFamily: 'monospace' },
                      }}
                      avatar={
                        <Box
                          sx={{
                            width: 16,
                            height: 16,
                            borderRadius: '50%',
                            bgcolor: color,
                            border: '1px solid',
                            borderColor: 'divider',
                          }}
                        />
                      }
                    />
                  ))}
                  {colorFilter.blacklist.length === 0 && (
                    <Typography
                      variant="body2"
                      color="text.secondary"
                      fontStyle="italic"
                    >
                      {t('danmakuFilter.colorFilter.noColors')}
                    </Typography>
                  )}
                </Stack>
              </>
            )}
          </>
        )}
      </Stack>
    </Box>
  )
}

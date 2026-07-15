import { TuneRounded } from '@mui/icons-material'
import {
  Box,
  Checkbox,
  ClickAwayListener,
  Divider,
  FormControlLabel,
  IconButton,
  Paper,
  Popper,
  Stack,
  Switch,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useExtensionOptions } from '@/common/options/extensionOptions/useExtensionOptions'

export const UpscaleControls = () => {
  const { t } = useTranslation()
  const { data: options, partialUpdate } = useExtensionOptions()
  const [open, setOpen] = useState(false)
  const anchorRef = useRef<HTMLDivElement>(null)
  const supported = 'gpu' in navigator && Boolean(navigator.gpu)
  const upscale = options.playerOptions.upscale

  const update = (next: Partial<typeof upscale>) => {
    void partialUpdate({
      playerOptions: {
        ...options.playerOptions,
        upscale: { ...upscale, ...next },
      },
    })
  }

  return (
    <Box
      ref={anchorRef}
      onPointerDown={(event) => event.stopPropagation()}
      sx={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}
    >
      <Stack
        direction="row"
        alignItems="center"
        spacing={0.25}
        title={
          supported
            ? t('upscale.enable', 'Super resolution')
            : t(
                'upscale.unsupported',
                'WebGPU is not supported by this browser'
              )
        }
      >
        <Typography variant="caption" fontWeight={700} sx={{ opacity: 0.9 }}>
          {t('upscale.shortLabel', 'Upscale')}
        </Typography>
        <Switch
          size="small"
          disabled={!supported}
          checked={supported && upscale.enabled}
          onChange={(_, enabled) => update({ enabled })}
          inputProps={{ 'aria-label': t('upscale.enable', 'Super resolution') }}
        />
        <IconButton
          size="small"
          onClick={() => setOpen((value) => !value)}
          aria-label={t('upscale.settings', 'Super resolution settings')}
          aria-expanded={open}
          sx={{ color: 'inherit' }}
        >
          <TuneRounded fontSize="small" />
        </IconButton>
      </Stack>

      <Popper
        open={open}
        anchorEl={anchorRef.current}
        placement="bottom-start"
        disablePortal
        modifiers={[
          { name: 'offset', options: { offset: [0, 8] } },
          { name: 'preventOverflow', options: { padding: 8 } },
        ]}
        sx={{ zIndex: 1600 }}
      >
        <ClickAwayListener onClickAway={() => setOpen(false)}>
          <Paper
            elevation={12}
            sx={{
              width: 330,
              p: 1.5,
              borderRadius: 2,
              border: '1px solid',
              borderColor: 'divider',
              bgcolor: 'background.paper',
              color: 'text.primary',
            }}
          >
            <Stack spacing={1.5}>
              <Box>
                <Typography fontWeight={700}>
                  {t('upscale.settings', 'Super resolution settings')}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {t(
                    'upscale.settingsHint',
                    'Changes apply immediately to the active video.'
                  )}
                </Typography>
              </Box>
              <Divider />
              <Stack spacing={0.5}>
                <Typography variant="caption" color="text.secondary">
                  {t('upscale.mode', 'Mode')}
                </Typography>
                <ToggleButtonGroup
                  exclusive
                  fullWidth
                  size="small"
                  value={upscale.modeId}
                  sx={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(3, 1fr)',
                    '& .MuiToggleButton-root': { borderRadius: 1 },
                  }}
                  onChange={(_, modeId: typeof upscale.modeId | null) => {
                    if (modeId) update({ modeId })
                  }}
                >
                  <ToggleButton value="builtin-mode-a">A</ToggleButton>
                  <ToggleButton value="builtin-mode-b">B</ToggleButton>
                  <ToggleButton value="builtin-mode-c">C</ToggleButton>
                  <ToggleButton value="builtin-mode-aa">A+A</ToggleButton>
                  <ToggleButton value="builtin-mode-bb">B+B</ToggleButton>
                  <ToggleButton value="builtin-mode-ca">C+A</ToggleButton>
                </ToggleButtonGroup>
              </Stack>
              <Stack spacing={0.5}>
                <Typography variant="caption" color="text.secondary">
                  {t('upscale.performanceTier', 'Performance tier')}
                </Typography>
                <ToggleButtonGroup
                  exclusive
                  fullWidth
                  size="small"
                  value={upscale.performanceTier}
                  sx={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(2, 1fr)',
                    '& .MuiToggleButton-root': { borderRadius: 1 },
                  }}
                  onChange={(
                    _,
                    performanceTier: typeof upscale.performanceTier | null
                  ) => {
                    if (performanceTier) update({ performanceTier })
                  }}
                >
                  <ToggleButton value="performance">
                    {t('upscale.tiers.performance', 'Fast')}
                  </ToggleButton>
                  <ToggleButton value="balanced">
                    {t('upscale.tiers.balanced', 'Balanced')}
                  </ToggleButton>
                  <ToggleButton value="quality">
                    {t('upscale.tiers.quality', 'Quality')}
                  </ToggleButton>
                  <ToggleButton value="ultra">
                    {t('upscale.tiers.ultra', 'Ultra')}
                  </ToggleButton>
                </ToggleButtonGroup>
              </Stack>
              <Stack spacing={0.5}>
                <Typography variant="caption" color="text.secondary">
                  {t('upscale.resolution', 'Scale')}
                </Typography>
                <ToggleButtonGroup
                  exclusive
                  fullWidth
                  size="small"
                  value={upscale.targetResolution}
                  sx={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(4, 1fr)',
                    '& .MuiToggleButton-root': { borderRadius: 1 },
                  }}
                  onChange={(
                    _,
                    targetResolution: typeof upscale.targetResolution | null
                  ) => {
                    if (targetResolution) update({ targetResolution })
                  }}
                >
                  <ToggleButton value="x2">2×</ToggleButton>
                  <ToggleButton value="x4">4×</ToggleButton>
                  <ToggleButton value="x8">8×</ToggleButton>
                  <ToggleButton value="720p">720p</ToggleButton>
                  <ToggleButton value="1080p">1080p</ToggleButton>
                  <ToggleButton value="2k">2K</ToggleButton>
                  <ToggleButton value="4k">4K</ToggleButton>
                  <ToggleButton value="native">
                    {t('upscale.native', 'Native')}
                  </ToggleButton>
                </ToggleButtonGroup>
              </Stack>
              <FormControlLabel
                sx={{ m: 0 }}
                control={
                  <Checkbox
                    size="small"
                    checked={upscale.enableCrossOriginFix}
                    onChange={(_, enableCrossOriginFix) =>
                      update({ enableCrossOriginFix })
                    }
                  />
                }
                label={t('upscale.corsFix', 'CORS fix')}
              />
            </Stack>
          </Paper>
        </ClickAwayListener>
      </Popper>
    </Box>
  )
}

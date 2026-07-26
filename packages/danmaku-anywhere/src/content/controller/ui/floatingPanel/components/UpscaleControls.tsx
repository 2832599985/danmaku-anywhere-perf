import { TuneRounded } from '@mui/icons-material'
import {
  Box,
  Checkbox,
  ClickAwayListener,
  Divider,
  FormControlLabel,
  IconButton,
  Popper,
  Stack,
  Switch,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useUpdateExtensionOptions } from '@/common/hooks/useUpdateExtensionOptions'
import { useExtensionOptions } from '@/common/options/extensionOptions/useExtensionOptions'
import { getLiquidGlassSx } from '@/common/theme/liquidGlass'
import { useThemeContext } from '@/common/theme/Theme'
import { RADIUS } from '@/common/theme/tokens'

export const UpscaleControls = () => {
  const { t } = useTranslation()
  const { palette } = useThemeContext()
  const { data: options } = useExtensionOptions()
  const updateOptions = useUpdateExtensionOptions()
  const [open, setOpen] = useState(false)
  const anchorRef = useRef<HTMLDivElement>(null)
  const supported = 'gpu' in navigator && Boolean(navigator.gpu)
  const upscale = options.playerOptions.upscale

  const update = (next: Partial<typeof upscale>) => {
    void updateOptions((prev) => ({
      playerOptions: {
        ...prev.playerOptions,
        upscale: { ...prev.playerOptions.upscale, ...next },
      },
    }))
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
          <Box
            sx={{
              ...getLiquidGlassSx(palette, {
                variant: 'surface',
                radius: 'l',
                gradientBorder: false,
              }),
              width: 330,
              p: 1.5,
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
                    '& .MuiToggleButton-root': {
                      borderRadius: `${RADIUS.s}px`,
                    },
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
                    '& .MuiToggleButton-root': {
                      borderRadius: `${RADIUS.s}px`,
                    },
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
                    '& .MuiToggleButton-root': {
                      borderRadius: `${RADIUS.s}px`,
                    },
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
              <Divider />
              <Stack spacing={0.75}>
                <Stack
                  direction="row"
                  alignItems="center"
                  justifyContent="space-between"
                >
                  <Box>
                    <Typography variant="body2" fontWeight={700}>
                      {t(
                        'upscale.frameInterpolation.title',
                        '2× frame interpolation'
                      )}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {t(
                        'upscale.frameInterpolation.shortDescription',
                        'Framegen before Anime4K; auto-bypasses on overload.'
                      )}
                    </Typography>
                  </Box>
                  <Switch
                    size="small"
                    checked={upscale.frameInterpolation.enabled}
                    inputProps={{
                      'aria-label': t(
                        'upscale.frameInterpolation.enable',
                        'Frame interpolation'
                      ),
                    }}
                    onChange={(_, enabled) =>
                      update({
                        frameInterpolation: {
                          ...upscale.frameInterpolation,
                          enabled,
                        },
                      })
                    }
                  />
                </Stack>
                {upscale.frameInterpolation.enabled && (
                  <ToggleButtonGroup
                    exclusive
                    fullWidth
                    size="small"
                    value={upscale.frameInterpolation.resolution}
                    onChange={(
                      _,
                      resolution:
                        | typeof upscale.frameInterpolation.resolution
                        | null
                    ) => {
                      if (resolution) {
                        update({
                          frameInterpolation: {
                            ...upscale.frameInterpolation,
                            resolution,
                          },
                        })
                      }
                    }}
                  >
                    <ToggleButton value="480p">480p</ToggleButton>
                    <ToggleButton value="720p">720p</ToggleButton>
                    <ToggleButton value="1080p">1080p</ToggleButton>
                  </ToggleButtonGroup>
                )}
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
          </Box>
        </ClickAwayListener>
      </Popper>
    </Box>
  )
}

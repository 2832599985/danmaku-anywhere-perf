import {
  Alert,
  Box,
  Checkbox,
  Divider,
  FormControlLabel,
  ListItem,
  ListItemText,
  Stack,
  Switch,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material'
import { useTranslation } from 'react-i18next'
import { useExtensionOptions } from '@/common/options/extensionOptions/useExtensionOptions'

export const UpscaleSettings = () => {
  const { t } = useTranslation()
  const { data, partialUpdate, isLoading } = useExtensionOptions()
  const supported = 'gpu' in navigator && Boolean(navigator.gpu)
  const upscale = data.playerOptions.upscale

  const update = async (next: Partial<typeof upscale>) => {
    await partialUpdate({
      playerOptions: {
        ...data.playerOptions,
        upscale: { ...upscale, ...next },
      },
    })
  }

  return (
    <Box
      data-testid="upscale-settings"
      sx={{
        mx: 1,
        mb: 1,
        border: '1px solid',
        borderColor: 'divider',
        borderRadius: 2,
        overflow: 'hidden',
        bgcolor: 'action.hover',
      }}
    >
      <ListItem>
        <ListItemText
          primary={
            <Stack
              direction="row"
              alignItems="center"
              justifyContent="space-between"
            >
              <Stack spacing={0.25}>
                <Typography fontWeight={600}>
                  {t(
                    'optionsPage.player.upscale.title',
                    'Video super resolution (Anime4K)'
                  )}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {t(
                    'optionsPage.player.upscale.description',
                    'Enhance the active video with WebGPU while keeping danmaku above the processed image.'
                  )}
                </Typography>
              </Stack>
              <Switch
                checked={supported && upscale.enabled}
                disabled={isLoading || !supported}
                onChange={(_, enabled) => void update({ enabled })}
                inputProps={{
                  'aria-label': t('upscale.enable', 'Super resolution'),
                }}
              />
            </Stack>
          }
        />
      </ListItem>
      {!supported && (
        <ListItem sx={{ pt: 0 }}>
          <Alert severity="info" sx={{ width: 1 }}>
            {t(
              'upscale.unsupported',
              'WebGPU is not supported by this browser'
            )}
          </Alert>
        </ListItem>
      )}
      <ListItem sx={{ pl: 4 }}>
        <Stack spacing={2} width={1}>
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
                gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
                '& .MuiToggleButton-root': { borderRadius: 1 },
              }}
              onChange={(_, modeId: typeof upscale.modeId | null) => {
                if (modeId) void update({ modeId })
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
                gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
                '& .MuiToggleButton-root': { borderRadius: 1 },
              }}
              onChange={(
                _,
                performanceTier: typeof upscale.performanceTier | null
              ) => {
                if (performanceTier) void update({ performanceTier })
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
                gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
                '& .MuiToggleButton-root': { borderRadius: 1 },
              }}
              onChange={(
                _,
                targetResolution: typeof upscale.targetResolution | null
              ) => {
                if (targetResolution) void update({ targetResolution })
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
          <Stack spacing={1}>
            <Stack
              direction="row"
              alignItems="center"
              justifyContent="space-between"
            >
              <Stack spacing={0.25}>
                <Typography fontWeight={600}>
                  {t(
                    'upscale.frameInterpolation.title',
                    '2× frame interpolation'
                  )}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {t(
                    'upscale.frameInterpolation.description',
                    'Generate one intermediate frame with Framegen before Anime4K. Adds a small playback delay and falls back automatically when the GPU is overloaded.'
                  )}
                </Typography>
              </Stack>
              <Switch
                checked={upscale.frameInterpolation.enabled}
                onChange={(_, enabled) =>
                  void update({
                    frameInterpolation: {
                      ...upscale.frameInterpolation,
                      enabled,
                    },
                  })
                }
                inputProps={{
                  'aria-label': t(
                    'upscale.frameInterpolation.enable',
                    'Frame interpolation'
                  ),
                }}
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
                    void update({
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
              </ToggleButtonGroup>
            )}
            <Typography variant="caption" color="warning.main">
              {t(
                'upscale.frameInterpolation.licenseNotice',
                'Bundled model weights are for personal and non-commercial use.'
              )}
            </Typography>
          </Stack>
        </Stack>
      </ListItem>
      <ListItem sx={{ pl: 4, pt: 0 }}>
        <FormControlLabel
          control={
            <Checkbox
              checked={upscale.enableCrossOriginFix}
              onChange={(_, enableCrossOriginFix) =>
                void update({ enableCrossOriginFix })
              }
            />
          }
          label={t(
            'optionsPage.player.upscale.crossOriginFix',
            'Enable cross-origin video compatibility fix'
          )}
        />
      </ListItem>
      <Divider />
    </Box>
  )
}

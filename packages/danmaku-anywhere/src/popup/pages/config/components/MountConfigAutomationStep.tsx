import type { DanmakuSourceType } from '@danmaku-anywhere/danmaku-converter'
import {
  Alert,
  Box,
  Button,
  Card,
  CardActionArea,
  CardContent,
  Chip,
  Radio,
  RadioGroup,
  Stack,
  Typography,
} from '@mui/material'
import { useCallback } from 'react'
import type {
  Control,
  ControllerRenderProps,
  UseFormWatch,
} from 'react-hook-form'
import { Controller } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import {
  danmakuSourceTypeList,
  localizedDanmakuSourceType,
} from '@/common/danmaku/enums'
import { integrationData } from '@/common/options/mountConfig/integrationData'
import type { AutomationMode } from '@/common/options/mountConfig/schema'
import { EMPTY_INTEGRATION_VALUE } from '../emptyIntegrationValue.constant'
import type { MountConfigForm } from './types'

interface MountConfigAutomationStepProps {
  control: Control<MountConfigForm>
  watch: UseFormWatch<MountConfigForm>
  isPermissive: boolean
}

const AutomationCard = ({
  mode,
  field,
  disabled,
}: {
  mode: AutomationMode
  field: ControllerRenderProps<MountConfigForm, 'mode'>
  disabled?: boolean
}) => {
  const data = integrationData[mode]

  return (
    <Card
      variant="outlined"
      sx={{
        backgroundColor: 'transparent',
        borderColor: field.value === mode ? 'primary.main' : undefined,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <CardActionArea onClick={() => field.onChange(mode)} disabled={disabled}>
        <CardContent>
          <Radio
            checked={field.value === mode}
            value={mode}
            sx={{ visibility: 'hidden', position: 'absolute' }}
          />
          <Box>
            <Stack direction="row" spacing={1} alignItems="center">
              <data.icon />
              <Typography variant="subtitle1" fontWeight="bold">
                {data.label()}
              </Typography>
            </Stack>
            <Typography variant="body2" color="text.secondary">
              {data.description()}
            </Typography>
          </Box>
        </CardContent>
      </CardActionArea>
    </Card>
  )
}

const PreferredProvidersEditor = ({
  value,
  onChange,
}: {
  value: DanmakuSourceType[]
  onChange: (value: DanmakuSourceType[]) => void
}) => {
  const { t } = useTranslation()

  const handleToggle = useCallback(
    (provider: DanmakuSourceType) => {
      const current = value ?? []
      if (current.includes(provider)) {
        onChange(current.filter((p) => p !== provider))
      } else {
        onChange([...current, provider])
      }
    },
    [value, onChange]
  )

  const handleReset = useCallback(() => {
    onChange([])
  }, [onChange])

  const selected = value ?? []

  return (
    <Stack spacing={1}>
      <Typography variant="body2" color="text.secondary">
        {t(
          'configPage.editor.preferredProviders.description',
          'Click to add providers in preferred order. When set, only these providers will be used for automatic matching.'
        )}
      </Typography>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
        {danmakuSourceTypeList.map((provider) => {
          const isSelected = selected.includes(provider)
          const order = selected.indexOf(provider)
          return (
            <Chip
              key={provider}
              label={
                isSelected
                  ? `${order + 1}. ${localizedDanmakuSourceType(provider)}`
                  : localizedDanmakuSourceType(provider)
              }
              onClick={() => handleToggle(provider)}
              color={isSelected ? 'primary' : 'default'}
              variant={isSelected ? 'filled' : 'outlined'}
            />
          )
        })}
      </Box>
      {selected.length > 0 && (
        <Button
          size="small"
          variant="text"
          onClick={handleReset}
          sx={{ alignSelf: 'flex-start' }}
        >
          {t('configPage.editor.preferredProviders.reset', 'Reset to Default')}
        </Button>
      )}
    </Stack>
  )
}

export const MountConfigAutomationStep = ({
  control,
  watch,
  isPermissive,
}: MountConfigAutomationStepProps) => {
  const { t } = useTranslation()

  const selectedMode = watch('mode')
  const integration = watch('integration')

  return (
    <Stack spacing={1}>
      <Typography variant="body1">
        {t('configPage.editor.automation.title', 'Select Automation Method')}
      </Typography>
      <Controller
        name="mode"
        control={control}
        render={({ field }) => (
          <RadioGroup {...field} row={false}>
            <Stack spacing={1}>
              <AutomationCard mode="manual" field={field} />
              <AutomationCard mode="ai" field={field} disabled={isPermissive} />
              <AutomationCard mode="xpath" field={field} />
            </Stack>
          </RadioGroup>
        )}
      />
      {selectedMode === 'xpath' &&
        (!integration || integration === EMPTY_INTEGRATION_VALUE) && (
          <Alert severity="warning">
            {t(
              'configPage.editor.automation.xPathAlert',
              "You'll need to visit this site after saving to complete the setup using the on-page tool."
            )}
          </Alert>
        )}
      {selectedMode !== 'manual' && (
        <>
          <Typography variant="body1" sx={{ mt: 1 }}>
            {t(
              'configPage.editor.preferredProviders.title',
              'Preferred Providers'
            )}
          </Typography>
          <Controller
            name="preferredProviders"
            control={control}
            render={({ field }) => (
              <PreferredProvidersEditor
                value={field.value ?? []}
                onChange={field.onChange}
              />
            )}
          />
        </>
      )}
    </Stack>
  )
}

import { ListItem, ListItemText, Stack, TextField } from '@mui/material'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useExtensionOptions } from '@/common/options/extensionOptions/useExtensionOptions'

export const FixedSkipSecondsInput = () => {
  const { t } = useTranslation()
  const { data, partialUpdate } = useExtensionOptions()
  const [value, setValue] = useState(
    String(data.playerOptions.fixedSkipSeconds ?? 90)
  )

  useEffect(() => {
    setValue(String(data.playerOptions.fixedSkipSeconds ?? 90))
  }, [data.playerOptions.fixedSkipSeconds])

  const handleBlur = async () => {
    const parsed = Number.parseInt(value, 10)
    if (Number.isNaN(parsed) || parsed < 1 || parsed > 600) {
      setValue(String(data.playerOptions.fixedSkipSeconds))
      return
    }
    await partialUpdate({
      playerOptions: {
        ...data.playerOptions,
        fixedSkipSeconds: parsed,
      },
    })
  }

  return (
    <ListItem sx={{ pl: 4 }}>
      <ListItemText
        primary={
          <Stack
            direction="row"
            alignItems="center"
            justifyContent="space-between"
          >
            {t(
              'optionsPage.player.fixedSkipSeconds',
              'Skip duration (seconds)'
            )}
            <TextField
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onBlur={handleBlur}
              sx={{ width: 120 }}
              size="small"
              type="number"
              autoComplete="off"
              slotProps={{
                htmlInput: {
                  min: 1,
                  max: 600,
                },
              }}
            />
          </Stack>
        }
      />
    </ListItem>
  )
}

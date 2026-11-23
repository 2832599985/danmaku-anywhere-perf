import {
  Box,
  List,
  ListItem,
  ListItemText,
  Stack,
  Typography,
} from '@mui/material'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { Keymap } from '@/common/options/extensionOptions/hotkeys'
import {
  ALL_HOTKEYS,
  detectHotkeyConflicts,
  HOTKEY_LABELS,
} from '@/common/options/extensionOptions/hotkeys'
import { useHotkeyOptions } from '@/common/options/extensionOptions/useHotkeyOptions'
import { OptionsPageToolBar } from '@/popup/component/OptionsPageToolbar'
import { OptionsPageLayout } from '@/popup/layout/OptionsPageLayout'
import { HotkeyInput } from '@/popup/pages/options/pages/hotkeyOptions/components/HotkeyInput'

export const HotkeyOptions = () => {
  const { t } = useTranslation()

  const { hotkeys, updateHotkey, getKeyCombo } = useHotkeyOptions()

  const conflicts = useMemo(
    () => detectHotkeyConflicts(hotkeys as Partial<Keymap>),
    [hotkeys]
  )

  return (
    <OptionsPageLayout>
      <OptionsPageToolBar title={t('optionsPage.pages.hotkeys', 'Hotkeys')} />
      <Box px={2}>
        <List>
          {ALL_HOTKEYS.map((label) => {
            const conflictingActions = conflicts.get(label)
            return (
              <ListItem disablePadding key={label}>
                <ListItemText
                  primary={
                    <Stack
                      direction="row"
                      alignItems="center"
                      justifyContent="space-between"
                    >
                      <>{HOTKEY_LABELS[label]()}</>
                      <HotkeyInput
                        value={getKeyCombo(label)}
                        onKeyChange={(key) => updateHotkey(label, key)}
                      />
                    </Stack>
                  }
                  secondary={
                    conflictingActions && (
                      <Typography variant="caption" color="warning.main">
                        {t('optionsPage.hotkeys.conflict', {
                          actions: conflictingActions
                            .map((a) => HOTKEY_LABELS[a]())
                            .join(', '),
                        })}
                      </Typography>
                    )
                  }
                />
              </ListItem>
            )
          })}
        </List>
      </Box>
    </OptionsPageLayout>
  )
}

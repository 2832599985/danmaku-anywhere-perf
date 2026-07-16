import { Box, Fade, Typography } from '@mui/material'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import type { AllHotkeys } from '@/common/options/extensionOptions/hotkeys'
import {
  getKeySymbolMap,
  HOTKEY_LABELS,
} from '@/common/options/extensionOptions/hotkeys'
import { useHotkeyOptions } from '@/common/options/extensionOptions/useHotkeyOptions'
import { getLiquidGlassSx } from '@/common/theme/liquidGlass'
import { useThemeContext } from '@/common/theme/Theme'
import { getOS, properCase } from '@/common/utils/utils'

interface HotkeyGroup {
  labelKey: string
  hotkeys: AllHotkeys[]
}

const HOTKEY_GROUPS: HotkeyGroup[] = [
  {
    labelKey: 'cheatSheet.group.danmaku',
    hotkeys: [
      'toggleEnableDanmaku',
      'refreshComments',
      'unmountComments',
      'increaseOpacity',
      'decreaseOpacity',
      'increaseFontSize',
      'decreaseFontSize',
      'danmakuDensityToggle',
      'danmakuSpeedToggle',
      'increaseSpeed',
      'decreaseSpeed',
    ],
  },
  {
    labelKey: 'cheatSheet.group.video',
    hotkeys: [
      'skipOp',
      'danmakuTimeOffsetIncrease',
      'danmakuTimeOffsetDecrease',
      'increaseOffset',
      'decreaseOffset',
    ],
  },
  {
    labelKey: 'cheatSheet.group.panel',
    hotkeys: ['toggleStylePanel', 'togglePip', 'toggleDensityPlot'],
  },
]

const formatKeyCombo = (
  combo: string,
  symbolMap: Record<string, string>
): string => {
  return combo
    .split('+')
    .map((key) => {
      if (key in symbolMap) return symbolMap[key]
      return properCase(key)
    })
    .join(' + ')
}

interface HotkeyCheatSheetProps {
  visible: boolean
}

export const HotkeyCheatSheet = ({ visible }: HotkeyCheatSheetProps) => {
  const { t } = useTranslation()
  const { hotkeys } = useHotkeyOptions()
  const { palette } = useThemeContext()

  const isMacOs = getOS() === 'MacOS'
  const symbolMap = getKeySymbolMap({ isMacOs })

  const groups = useMemo(() => {
    return HOTKEY_GROUPS.map((group) => ({
      label: t(group.labelKey),
      items: group.hotkeys
        .filter((name) => {
          const hotkey = hotkeys[name]
          return hotkey?.key && hotkey.enabled
        })
        .map((name) => ({
          name,
          label: HOTKEY_LABELS[name](),
          keyCombo: formatKeyCombo(hotkeys[name].key, symbolMap),
        })),
    })).filter((group) => group.items.length > 0)
  }, [hotkeys, symbolMap, t])

  if (groups.length === 0) return null

  return (
    <Fade in={visible} timeout={200} unmountOnExit>
      <Box
        sx={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1500,
          pointerEvents: 'none',
        }}
      >
        <Box
          sx={{
            ...getLiquidGlassSx(palette, {
              variant: 'surface',
              radius: 24,
              gradientBorder: true,
            }),
            maxWidth: 640,
            width: '90%',
            maxHeight: '80vh',
            overflow: 'hidden',
          }}
        >
          <Box
            sx={{
              padding: 3,
              maxHeight: '80vh',
              overflow: 'auto',
            }}
          >
            <Typography
              variant="h6"
              sx={{
                textAlign: 'center',
                mb: 2.5,
                fontWeight: 600,
                background: palette.gradient,
                backgroundClip: 'text',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
              }}
            >
              {t('cheatSheet.title')}
            </Typography>

            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns:
                  groups.length > 1
                    ? 'repeat(auto-fit, minmax(240px, 1fr))'
                    : '1fr',
                gap: 2.5,
              }}
            >
              {groups.map((group) => (
                <Box key={group.label}>
                  <Typography
                    variant="caption"
                    sx={{
                      color: palette.primary,
                      fontWeight: 600,
                      textTransform: 'uppercase',
                      letterSpacing: '0.08em',
                      mb: 1,
                      display: 'block',
                    }}
                  >
                    {group.label}
                  </Typography>

                  <Box
                    sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}
                  >
                    {group.items.map((item) => (
                      <Box
                        key={item.name}
                        sx={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: 1.5,
                          py: 0.5,
                        }}
                      >
                        <Typography
                          variant="body2"
                          sx={{
                            color: 'text.primary',
                            flexShrink: 1,
                            minWidth: 0,
                          }}
                        >
                          {item.label}
                        </Typography>

                        <Box
                          sx={{
                            display: 'flex',
                            gap: 0.5,
                            flexShrink: 0,
                          }}
                        >
                          {item.keyCombo.split(' + ').map((key, i) => (
                            <Box
                              key={i}
                              component="kbd"
                              sx={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                minWidth: 28,
                                height: 28,
                                px: 1,
                                borderRadius: 1,
                                fontSize: '0.75rem',
                                fontFamily: 'inherit',
                                fontWeight: 600,
                                color: 'text.primary',
                                backgroundColor: 'action.hover',
                                border: '1px solid',
                                borderColor: 'divider',
                                boxShadow: (theme) =>
                                  theme.palette.mode === 'dark'
                                    ? '0 2px 0 rgba(0, 0, 0, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.08)'
                                    : '0 2px 0 rgba(15, 23, 42, 0.14), inset 0 1px 0 rgba(255, 255, 255, 0.8)',
                                lineHeight: 1,
                              }}
                            >
                              {key}
                            </Box>
                          ))}
                        </Box>
                      </Box>
                    ))}
                  </Box>
                </Box>
              ))}
            </Box>

            <Typography
              variant="caption"
              sx={{
                display: 'block',
                textAlign: 'center',
                mt: 2.5,
                color: 'text.secondary',
              }}
            >
              {t('cheatSheet.hint')}
            </Typography>
          </Box>
        </Box>
      </Box>
    </Fade>
  )
}

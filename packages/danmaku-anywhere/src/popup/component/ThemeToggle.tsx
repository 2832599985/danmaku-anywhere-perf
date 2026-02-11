import {
  DarkModeOutlined,
  LightModeOutlined,
  SettingsBrightnessOutlined,
} from '@mui/icons-material'
import { Box, IconButton, Tooltip } from '@mui/material'
import { useTranslation } from 'react-i18next'
import { ColorMode } from '@/common/theme/enums'
import { useThemeContext } from '@/common/theme/Theme'
import { themeIds, themes } from '@/common/theme/themes'

export const ThemeToggle = () => {
  const { t } = useTranslation()
  const { colorMode, setColorMode, themeId, setThemeId } = useThemeContext()

  const handleToggle = () => {
    // Cycle through Light -> System -> Dark -> Light
    switch (colorMode) {
      case ColorMode.Light:
        setColorMode(ColorMode.System)
        break
      case ColorMode.System:
        setColorMode(ColorMode.Dark)
        break
      case ColorMode.Dark:
        setColorMode(ColorMode.Light)
        break
    }
  }

  const getIcon = () => {
    switch (colorMode) {
      case ColorMode.Light:
        return <LightModeOutlined />
      case ColorMode.System:
        return <SettingsBrightnessOutlined />
      case ColorMode.Dark:
        return <DarkModeOutlined />
    }
  }

  const getTooltip = () => {
    switch (colorMode) {
      case ColorMode.Light:
        return t('optionsPage.theme.colorMode.light', 'Light')
      case ColorMode.System:
        return t('optionsPage.theme.colorMode.system', 'System')
      case ColorMode.Dark:
        return t('optionsPage.theme.colorMode.dark', 'Dark')
    }
  }

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
      <Tooltip title={getTooltip()}>
        <IconButton
          onClick={handleToggle}
          sx={{
            color: 'inherit',
          }}
        >
          {getIcon()}
        </IconButton>
      </Tooltip>
      <Box sx={{ display: 'flex', gap: 0.5 }}>
        {themeIds.map((id) => {
          const palette = themes[id]
          const isSelected = id === themeId
          return (
            <Tooltip key={id} title={t(palette.name)} arrow>
              <Box
                onClick={() => setThemeId(id)}
                sx={{
                  width: 20,
                  height: 20,
                  borderRadius: '50%',
                  background: palette.gradient,
                  cursor: 'pointer',
                  border: isSelected ? '2px solid' : '2px solid transparent',
                  borderColor: isSelected ? 'text.primary' : 'transparent',
                  boxShadow: isSelected ? `0 0 6px ${palette.primary}` : 'none',
                  transition: 'all 0.2s ease',
                  '&:hover': {
                    transform: 'scale(1.2)',
                    boxShadow: `0 0 8px ${palette.primary}`,
                  },
                }}
              />
            </Tooltip>
          )
        })}
      </Box>
    </Box>
  )
}

import {
  DarkModeOutlined,
  LightModeOutlined,
  PaletteOutlined,
  SettingsBrightnessOutlined,
} from '@mui/icons-material'
import { Box, IconButton, Popover, Tooltip } from '@mui/material'
import { useCallback, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ColorMode } from '@/common/theme/enums'
import { useThemeContext } from '@/common/theme/Theme'
import { ThemePreviewCards } from '@/popup/component/ThemePreviewCards'

export const ThemeToggle = () => {
  const { t } = useTranslation()
  const { colorMode, setColorMode } = useThemeContext()
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)

  const handleToggle = () => {
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

  const handleOpenPalette = useCallback(() => {
    setAnchorEl(buttonRef.current)
  }, [])

  const handleClosePalette = useCallback(() => {
    setAnchorEl(null)
  }, [])

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
      <Tooltip title={t('theme.selectTheme', 'Select Theme')}>
        <IconButton
          ref={buttonRef}
          onClick={handleOpenPalette}
          sx={{
            color: 'inherit',
          }}
        >
          <PaletteOutlined />
        </IconButton>
      </Tooltip>
      <Popover
        open={Boolean(anchorEl)}
        anchorEl={anchorEl}
        onClose={handleClosePalette}
        anchorOrigin={{
          vertical: 'bottom',
          horizontal: 'center',
        }}
        transformOrigin={{
          vertical: 'top',
          horizontal: 'center',
        }}
        slotProps={{
          paper: {
            sx: {
              width: 240,
              p: 1,
              borderRadius: 2,
              mt: 0.5,
            },
          },
        }}
      >
        <ThemePreviewCards />
      </Popover>
    </Box>
  )
}

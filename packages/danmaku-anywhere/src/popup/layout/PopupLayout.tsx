import { Container, GlobalStyles, Paper, useTheme } from '@mui/material'
import type { PropsWithChildren } from 'react'
import { usePlatformInfo } from '@/common/hooks/usePlatformInfo'
import { useThemeContext } from '@/common/theme/Theme'

export const PopupLayout = ({ children }: PropsWithChildren<{}>) => {
  const { isMobile } = usePlatformInfo()
  const theme = useTheme()
  const { palette } = useThemeContext()

  const width = isMobile ? '100vw' : 500
  const height = isMobile ? '100vh' : 600

  return (
    <Container
      sx={{
        padding: 1,
        width: width,
        maxWidth: width,
        height: height,
        maxHeight: height,
        overflow: 'hidden',
      }}
      fixed
    >
      {/* The extension popup window is an opaque square viewport that cannot
          be made transparent, so the rounded glass card floats on a frame
          painted with the theme background instead of the browser canvas */}
      <GlobalStyles
        styles={{
          'html, body': {
            backgroundImage: palette.canvas.backdrop,
          },
        }}
      />
      <Paper
        elevation={0}
        sx={{
          height: 1,
          overflow: 'hidden',
          position: 'relative',
          color: theme.palette.text.primary,
          boxShadow: palette.glass.depth,
        }}
      >
        {children}
      </Paper>
    </Container>
  )
}

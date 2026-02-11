import type { PaperProps } from '@mui/material'
import { Paper } from '@mui/material'
import type { ReactNode, Ref } from 'react'

import { useThemeContext } from '@/common/theme/Theme'
import { useIsSmallScreen } from '@/content/controller/common/hooks/useIsSmallScreen'
import {
  CONTROLLER_WINDOW_DEFAULT_WIDTH,
  CONTROLLER_WINDOW_MIN_HEIGHT,
} from '@/content/controller/ui/constants/size'

interface WindowPaneLayoutProps {
  children: ReactNode
  paperProps?: PaperProps
  width?: number
  height?: number
  ref?: Ref<HTMLDivElement>
}

export const WindowPaneLayout = (props: WindowPaneLayoutProps) => {
  const {
    ref,
    width = CONTROLLER_WINDOW_DEFAULT_WIDTH,
    height = CONTROLLER_WINDOW_MIN_HEIGHT,
  } = props
  const sm = useIsSmallScreen()
  const { palette } = useThemeContext()

  return (
    <Paper
      elevation={0}
      sx={{
        padding: 0,
        width: sm ? '100%' : width,
        maxWidth: sm ? '100%' : width,
        minHeight: height,
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        touchAction: 'manipulation',
        background: palette.glass.base,
        backdropFilter: palette.glass.blur,
        border: `1px solid ${palette.glass.border}`,
        borderRadius: '16px',
        color: '#fff',
      }}
      ref={ref}
      {...props.paperProps}
    >
      {props.children}
    </Paper>
  )
}

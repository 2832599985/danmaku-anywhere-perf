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
  isResizing?: boolean
  ref?: Ref<HTMLDivElement>
}

export const WindowPaneLayout = (props: WindowPaneLayoutProps) => {
  const {
    ref,
    width = CONTROLLER_WINDOW_DEFAULT_WIDTH,
    height = CONTROLLER_WINDOW_MIN_HEIGHT,
    isResizing = false,
  } = props
  const sm = useIsSmallScreen()
  const { palette } = useThemeContext()

  return (
    <Paper
      elevation={0}
      sx={{
        position: 'relative',
        padding: 0,
        width: sm ? '100%' : width,
        maxWidth: sm ? '100%' : width,
        height: sm
          ? 'min(85dvh, 720px)'
          : `min(${height}px, calc(100dvh - 24px))`,
        maxHeight: 'calc(100dvh - 24px)',
        minHeight: 0,
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        touchAction: 'manipulation',
        background: palette.glass.base,
        backdropFilter: palette.glass.blur,
        border: isResizing
          ? '1px dashed rgba(139, 92, 246, 0.6)'
          : `1px solid ${palette.glass.border}`,
        borderRadius: '16px',
        color: '#fff',
        transition: isResizing ? 'none' : 'border-color 0.2s',
      }}
      ref={ref}
      {...props.paperProps}
    >
      {props.children}
    </Paper>
  )
}

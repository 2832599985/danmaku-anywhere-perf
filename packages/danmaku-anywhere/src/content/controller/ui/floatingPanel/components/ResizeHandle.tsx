import { Box } from '@mui/material'
import { alpha, useTheme } from '@mui/material/styles'
import { useDrag } from '@use-gesture/react'
import { useCallback, useRef, useState } from 'react'
import { useThemeContext } from '@/common/theme/Theme'
import type { PanelSize } from '@/content/controller/ui/constants/size'
import {
  PANEL_MAX_HEIGHT_RATIO,
  PANEL_MAX_WIDTH_RATIO,
  PANEL_MIN_HEIGHT,
  PANEL_MIN_WIDTH,
} from '@/content/controller/ui/constants/size'

interface ResizeHandleProps {
  size: PanelSize
  onResize: (size: PanelSize) => void
  onResizeEnd: (size: PanelSize) => void
  onDoubleClick: () => void
}

export const ResizeHandle = ({
  size,
  onResize,
  onResizeEnd,
  onDoubleClick,
}: ResizeHandleProps) => {
  const [isDragging, setIsDragging] = useState(false)
  const theme = useTheme()
  const { palette } = useThemeContext()
  const sizeRef = useRef(size)
  sizeRef.current = size

  const idleHandleColor = alpha(theme.palette.text.primary, 0.28)
  const activeHandleColor = alpha(palette.primary, 0.82)

  const clampSize = useCallback((width: number, height: number): PanelSize => {
    const maxW = window.innerWidth * PANEL_MAX_WIDTH_RATIO
    const maxH = window.innerHeight * PANEL_MAX_HEIGHT_RATIO
    return {
      width: Math.round(Math.min(maxW, Math.max(PANEL_MIN_WIDTH, width))),
      height: Math.round(Math.min(maxH, Math.max(PANEL_MIN_HEIGHT, height))),
    }
  }, [])

  const bind = useDrag(
    ({ down, delta: [dx, dy], first, last, event }) => {
      event.preventDefault()
      event.stopPropagation()

      if (first) {
        setIsDragging(true)
      }

      const newSize = clampSize(
        sizeRef.current.width + dx,
        sizeRef.current.height + dy
      )

      onResize(newSize)

      if (last) {
        setIsDragging(false)
        onResizeEnd(newSize)
      }
    },
    {
      filterTaps: true,
    }
  )

  return (
    <Box
      {...bind()}
      onDoubleClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        onDoubleClick()
      }}
      sx={{
        position: 'absolute',
        right: 0,
        bottom: 0,
        width: 20,
        height: 20,
        cursor: 'nwse-resize',
        touchAction: 'none',
        pointerEvents: 'auto',
        zIndex: 10,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: '0 0 16px 0',
        transition: 'background-color 0.2s',
        backgroundColor: isDragging
          ? alpha(palette.primary, 0.24)
          : 'transparent',
        '&:hover': {
          backgroundColor: alpha(palette.primary, 0.16),
        },
        '&::before': {
          content: '""',
          display: 'block',
          width: 10,
          height: 10,
          borderRight: isDragging
            ? `2px solid ${activeHandleColor}`
            : `2px solid ${idleHandleColor}`,
          borderBottom: isDragging
            ? `2px solid ${activeHandleColor}`
            : `2px solid ${idleHandleColor}`,
          transition: 'border-color 0.2s',
        },
        '&:hover::before': {
          borderColor: alpha(palette.primary, 0.64),
        },
      }}
    />
  )
}

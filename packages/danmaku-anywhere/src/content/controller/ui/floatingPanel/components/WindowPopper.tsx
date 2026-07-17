import type { PopperProps } from '@mui/material'
import { Grow } from '@mui/material'
import type { useDrag } from '@use-gesture/react'
import type { ReactElement } from 'react'
import { useEffect, useRef, useState } from 'react'

import { MOTION } from '@/common/theme/tokens'
import type { DraggableContainerMethods } from '@/content/controller/ui/components/DraggableContainer'
import { DraggableContainer } from '@/content/controller/ui/components/DraggableContainer'
import type { PanelSize } from '@/content/controller/ui/constants/size'
import { ResizeHandle } from '@/content/controller/ui/floatingPanel/components/ResizeHandle'
import { WindowPaneLayout } from '@/content/controller/ui/floatingPanel/layout/WindowPaneLayout'

interface RenderProps {
  bind: ReturnType<typeof useDrag>
  isDragging: boolean
}

interface PopperWindowProps {
  anchorEl: PopperProps['anchorEl']
  children: (props: RenderProps) => ReactElement<unknown, string>
  open: boolean
  unmountOnExit?: boolean
  panelSize?: PanelSize
  isResizing?: boolean
  onResize?: (size: PanelSize) => void
  onResizeEnd?: (size: PanelSize) => void
  onResetSize?: () => void
}

export const WindowPopper = ({
  anchorEl,
  children,
  open,
  unmountOnExit,
  panelSize,
  isResizing,
  onResize,
  onResizeEnd,
  onResetSize,
}: PopperWindowProps) => {
  const methods = useRef<DraggableContainerMethods>(null)
  const [localResizing, setLocalResizing] = useState(false)

  useEffect(() => {
    if (open) {
      void methods.current?.resetOffset()
    }
  }, [open])

  const handleResize = (size: PanelSize) => {
    setLocalResizing(true)
    onResize?.(size)
  }

  const handleResizeEnd = (size: PanelSize) => {
    setLocalResizing(false)
    onResizeEnd?.(size)
  }

  const handleDoubleClick = () => {
    setLocalResizing(false)
    onResetSize?.()
  }

  const showResizeHandle = onResize && panelSize

  return (
    <DraggableContainer
      anchorEl={anchorEl}
      initialOffset={{ x: 0, y: 12 }}
      sx={{
        pointerEvents: open ? 'auto' : 'none',
      }}
      ref={methods}
    >
      {({ bind, isDragging }) => {
        return (
          // Grow from the FAB corner (anchored bottom-left) so the panel reads
          // as unfolding from the button rather than fading in place.
          <Grow
            in={open}
            unmountOnExit={unmountOnExit}
            style={{ transformOrigin: 'bottom left' }}
            timeout={MOTION.durSlow}
          >
            <div>
              <WindowPaneLayout
                width={panelSize?.width}
                height={panelSize?.height}
                isResizing={isResizing || localResizing}
              >
                {children({ bind, isDragging })}
                {showResizeHandle && (
                  <ResizeHandle
                    size={panelSize}
                    onResize={handleResize}
                    onResizeEnd={handleResizeEnd}
                    onDoubleClick={handleDoubleClick}
                  />
                )}
              </WindowPaneLayout>
            </div>
          </Grow>
        )
      }}
    </DraggableContainer>
  )
}

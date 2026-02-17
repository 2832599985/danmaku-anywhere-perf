import { Box, Paper, type PopoverVirtualElement, styled } from '@mui/material'
import { Suspense, useCallback, useState } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'
import { useDialogStore } from '@/common/components/Dialog/dialogStore'
import { FullPageSpinner } from '@/common/components/FullPageSpinner'
import { usePopup } from '@/content/controller/store/popupStore'
import type { PanelSize } from '@/content/controller/ui/constants/size'
import { CONTROLLER_WINDOW_CONTENT_HEIGHT } from '@/content/controller/ui/constants/size'
import { ControllerToolbar } from '@/content/controller/ui/floatingPanel/components/ControllerToolbar'
import { InfoBar } from '@/content/controller/ui/floatingPanel/components/InfoBar'
import { MergeSourcesPanel } from '@/content/controller/ui/floatingPanel/components/MergeSourcesPanel'
import { PanelTabs } from '@/content/controller/ui/floatingPanel/components/PanelTabs'
import { Window } from '@/content/controller/ui/floatingPanel/components/Window'
import { usePersistedPanelSize } from '@/content/controller/ui/floatingPanel/hooks/usePersistedPanelSize'
import { routes } from '@/content/controller/ui/router/routes'

const WindowPaper = styled(Paper)({
  borderRadius: 0,
  overflow: 'auto',
  height: '100%',
  flex: 1,
  display: 'flex',
})

export const ControllerWindow = ({
  anchorEl,
}: {
  anchorEl: PopoverVirtualElement | HTMLElement | null
}) => {
  const { isOpen, toggleOpen, tab } = usePopup()
  const setContainer = useDialogStore.use.setContainer()
  const { size, updateSize, resetSize } = usePersistedPanelSize()
  const [isResizing, setIsResizing] = useState(false)

  useHotkeys('esc', () => {
    toggleOpen(false)
  })

  const handleResize = useCallback(
    (newSize: PanelSize) => {
      setIsResizing(true)
      updateSize(newSize)
    },
    [updateSize]
  )

  const handleResizeEnd = useCallback(
    (newSize: PanelSize) => {
      setIsResizing(false)
      updateSize(newSize)
    },
    [updateSize]
  )

  const handleResetSize = useCallback(() => {
    setIsResizing(false)
    resetSize()
  }, [resetSize])

  // Compute content height: total panel height minus toolbar (~48px) and info bar area (~40px)
  // Use persisted height but ensure minimum of default
  const contentHeight = Math.max(
    size.height - 88,
    CONTROLLER_WINDOW_CONTENT_HEIGHT - 88
  )

  return (
    <Window
      anchorEl={anchorEl}
      open={isOpen}
      onOpen={() => toggleOpen(true)}
      onClose={() => toggleOpen(false)}
      toolbar={<ControllerToolbar />}
      panelSize={size}
      isResizing={isResizing}
      onResize={handleResize}
      onResizeEnd={handleResizeEnd}
      onResetSize={handleResetSize}
    >
      <InfoBar />
      <MergeSourcesPanel />
      <Box
        display="flex"
        position="relative"
        flex={1}
        minHeight={contentHeight}
      >
        <PanelTabs />
        <WindowPaper ref={setContainer}>
          <Suspense
            fallback={
              <Box flexGrow={1}>
                <FullPageSpinner />
              </Box>
            }
          >
            {routes.find((route) => route.tab === tab)?.element}
          </Suspense>
        </WindowPaper>
      </Box>
    </Window>
  )
}

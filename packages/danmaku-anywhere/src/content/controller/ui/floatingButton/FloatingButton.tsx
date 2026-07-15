import { Check } from '@mui/icons-material'
import type { FabProps, PopoverVirtualElement } from '@mui/material'
import {
  Badge,
  Box,
  ClickAwayListener,
  Fab,
  Fade,
  keyframes,
  SpeedDialIcon,
  styled,
} from '@mui/material'
import type { MouseEventHandler } from 'react'
import { forwardRef, useEffect, useRef, useState } from 'react'
import { useAnyLoading } from '@/common/hooks/useAnyLoading'
import { useMergeRefs } from '@/common/hooks/useMergeRefs'
import { isConfigIncomplete } from '@/common/options/mountConfig/isPermissive'
import { useThemeContext } from '@/common/theme/Theme'
import type { ThemePalette } from '@/common/theme/themes'
import { createVirtualElement } from '@/common/utils/utils'
import { useActiveConfig } from '@/content/controller/common/context/useActiveConfig'
import { useStore } from '@/content/controller/store/store'
import { DraggableContainer } from '@/content/controller/ui/components/DraggableContainer'
import { FabContextMenu } from '@/content/controller/ui/floatingButton/components/FabContextMenu'
import { FabLoadingIndicator } from '@/content/controller/ui/floatingButton/components/FabLoadingIndicator'
import { usePersistedFabPosition } from './hooks/usePersistedFabPosition'
import { useShowFab } from './hooks/useShowFab'

interface FloatingButtonProps extends FabProps {
  onOpen: (virtualElement: PopoverVirtualElement) => void
  isOpen: boolean
}

// The animated box-shadow replaces the whole stack each frame, so the static
// specular/depth stack must ride along in every keyframe.
const makeErrorPulse = (staticShadow: string) => keyframes`
  0%, 100% {
    box-shadow: ${staticShadow}, 0 0 0 0 rgba(244, 67, 54, 0.4);
  }
  50% {
    box-shadow: ${staticShadow}, 0 0 0 8px rgba(244, 67, 54, 0);
  }
`

const checkFadeInOut = keyframes`
  0% {
    opacity: 0;
    transform: scale(0.5);
  }
  15% {
    opacity: 1;
    transform: scale(1);
  }
  75% {
    opacity: 1;
    transform: scale(1);
  }
  100% {
    opacity: 0;
    transform: scale(0.8);
  }
`

const StyledFab = styled(Fab, {
  shouldForwardProp: (prop) =>
    prop !== 'hover' && prop !== 'palette' && prop !== 'hasError',
})<{ hover: boolean; palette: ThemePalette; hasError: boolean }>(
  ({ hover, palette, hasError }) => {
    const g = palette.glass
    const staticShadow = `${g.specular}, ${g.depth}`
    return {
      transition: 'all 0.2s ease-in-out',
      transform: hover ? 'rotate(45deg) scale(1.05)' : 'rotate(0deg)',
      touchAction: 'none',
      // !important: the Fab color prop injects its own background
      background: `${g.tint}, ${g.base} !important`,
      backdropFilter: g.blur,
      border: `1px solid ${g.border}`,
      boxShadow: staticShadow,
      color: '#fff',
      '& svg': {
        filter: 'drop-shadow(0 1px 2px rgba(0, 0, 0, 0.5))',
      },
      '&:hover': {
        background: `${g.tint}, ${g.hover} !important`,
      },
      '&:active': {
        transform: hover
          ? 'rotate(45deg) scale(0.94)'
          : 'rotate(0deg) scale(0.94)',
      },
      ...(hasError && {
        animation: `${makeErrorPulse(staticShadow)} 1.5s ease-in-out infinite`,
      }),
    }
  }
)

const useInitialAnchor = () => {
  // bottom 12, left 3
  const left = 24
  const bottom = window.innerHeight - 96

  return useRef(createVirtualElement(left, bottom))
}

const formatBadgeCount = (count: number): string => {
  if (count > 999) return '999+'
  return String(count)
}

export const FloatingButton = forwardRef<
  HTMLButtonElement,
  FloatingButtonProps
>(({ onOpen, isOpen }: FloatingButtonProps, ref) => {
  const isLoading = useAnyLoading()

  const showFab = useShowFab()
  const { palette } = useThemeContext()

  const [contextMenuAnchor, setContextMenuAnchor] =
    useState<PopoverVirtualElement | null>(null)
  const [fabHover, setFabHover] = useState(false)
  const [showCheck, setShowCheck] = useState(false)

  const { isMounted, comments } = useStore.use.danmaku()
  const isDisconnected = useStore.use.isDisconnected()
  const matchResult = useStore((state) => state.integration.matchResult)
  const activeConfig = useActiveConfig()

  const prevMatchStatusRef = useRef<string | undefined>(undefined)

  // Track match success transitions to show checkmark animation
  useEffect(() => {
    const currentStatus = matchResult?.status
    if (
      currentStatus === 'success' &&
      prevMatchStatusRef.current !== 'success'
    ) {
      prevMatchStatusRef.current = currentStatus
      setShowCheck(true)
      const timer = setTimeout(() => {
        setShowCheck(false)
      }, 1500)
      return () => clearTimeout(timer)
    }
    prevMatchStatusRef.current = currentStatus
  }, [matchResult?.status])

  const fabAnchor = useInitialAnchor()

  const { initialOffset, handleDragEnd } = usePersistedFabPosition({
    x: 0,
    y: 0,
  })

  const handleTap = (x: number, y: number) => {
    handleCloseContextMenu()
    const virtualElement = createVirtualElement(x, y)
    onOpen(virtualElement)
  }

  const handleCloseContextMenu = () => {
    setContextMenuAnchor(null)
  }

  const handleContextMenu: MouseEventHandler<HTMLElement> = (e) => {
    if (contextMenuAnchor) {
      // if context menu is already open, use the system context menu
      handleCloseContextMenu()
      return
    }
    e.preventDefault()
    const virtualElement = createVirtualElement(e.clientX, e.clientY)
    setContextMenuAnchor(virtualElement)
  }

  const fabRef = useRef<HTMLButtonElement>(null)

  const mergedFabRefs = useMergeRefs(fabRef, ref)

  const dialColor = isDisconnected ? 'error' : isMounted ? 'success' : 'primary'

  const isPicking = useStore((state) => state.integrationForm.isPicking)

  const isIn = !isPicking && (showFab || isOpen || !!contextMenuAnchor)

  const isIncomplete = isConfigIncomplete(activeConfig)

  const commentCount = comments.length
  const showCountBadge = isMounted && commentCount > 0

  return (
    <ClickAwayListener onClickAway={handleCloseContextMenu}>
      <div>
        <DraggableContainer
          anchorEl={fabAnchor.current}
          initialOffset={initialOffset}
          sx={{
            zIndex: 1401,
          }}
          onTap={(e) => {
            handleTap(e.clientX, e.clientY)
          }}
          onDragEnd={handleDragEnd}
        >
          {({ bind }) => {
            return (
              <Fade
                in={isIn}
                unmountOnExit={false}
                style={{
                  pointerEvents: isIn ? 'auto' : 'none',
                }}
              >
                <div
                  {...bind()}
                  style={{
                    touchAction: 'none',
                  }}
                >
                  <Badge
                    color="warning"
                    variant="dot"
                    invisible={!isIncomplete}
                    sx={{
                      '& .MuiBadge-badge': {
                        zIndex: 1402,
                      },
                    }}
                  >
                    <Badge
                      badgeContent={
                        showCountBadge
                          ? formatBadgeCount(commentCount)
                          : undefined
                      }
                      invisible={!showCountBadge}
                      max={9999}
                      sx={{
                        '& .MuiBadge-badge': {
                          zIndex: 1402,
                          backgroundColor: palette.primary,
                          color: '#fff',
                          fontSize: '0.65rem',
                          minWidth: 18,
                          height: 18,
                          padding: '0 4px',
                          fontWeight: 600,
                        },
                      }}
                    >
                      <StyledFab
                        size="small"
                        onContextMenu={handleContextMenu}
                        ref={mergedFabRefs}
                        color={dialColor}
                        hover={fabHover}
                        palette={palette}
                        hasError={isDisconnected}
                        onMouseOver={() => setFabHover(true)}
                        onMouseOut={() => setFabHover(false)}
                      >
                        <SpeedDialIcon />
                        <FabLoadingIndicator
                          isLoading={!isDisconnected && isLoading}
                          primaryColor={`${palette.primary}80`}
                          secondaryColor={`${palette.secondary}40`}
                        />
                        {/* Checkmark overlay on match success */}
                        {showCheck && (
                          <Box
                            sx={{
                              position: 'absolute',
                              top: 0,
                              left: 0,
                              width: '100%',
                              height: '100%',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              pointerEvents: 'none',
                              animation: `${checkFadeInOut} 1.5s ease-in-out forwards`,
                              zIndex: 1,
                            }}
                          >
                            <Check
                              sx={{
                                fontSize: 24,
                                color: '#4caf50',
                                filter:
                                  'drop-shadow(0 0 4px rgba(76, 175, 80, 0.6))',
                              }}
                            />
                          </Box>
                        )}
                      </StyledFab>
                    </Badge>
                  </Badge>
                </div>
              </Fade>
            )
          }}
        </DraggableContainer>
        <FabContextMenu
          open={contextMenuAnchor !== null}
          anchorEl={contextMenuAnchor}
          sx={{ zIndex: 1402 }}
        />
      </div>
    </ClickAwayListener>
  )
})

FloatingButton.displayName = 'FloatingButton'

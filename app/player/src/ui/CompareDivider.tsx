import { Box, Typography } from '@mui/material'
import type { PointerEvent } from 'react'
import { usePlayerStore } from '@/store/playerStore'
import {
  hardShadow,
  INK,
  LINE_STRONG,
  MONO,
  PAPER,
  STAGE_Z,
  VERMILION,
} from '@/theme/theme'
import { CompareIcon } from './icons'

const clamp = (n: number) => Math.min(0.98, Math.max(0.02, n))

/**
 * A/B compare handle: the upscale canvas is clipped by `compareRatio`, but
 * without a visible divider the setting's "拖动分割线" promise was empty.
 * Pointer events are swallowed so dragging never pauses or fullscreens.
 */
export const CompareDivider = () => {
  const ratio = usePlayerStore((s) => s.compareRatio)
  const setRatio = usePlayerStore((s) => s.setCompareRatio)
  if (ratio === null) return null

  const drag = (event: PointerEvent<HTMLDivElement>) => {
    const stage = event.currentTarget.closest('[data-player-stage]')
    const rect = (
      stage ?? event.currentTarget.parentElement
    )?.getBoundingClientRect()
    if (!rect || rect.width <= 0) return
    setRatio(clamp((event.clientX - rect.left) / rect.width))
  }

  return (
    <Box
      data-compare-divider
      onPointerDown={(event) => {
        event.stopPropagation()
        event.preventDefault()
        event.currentTarget.setPointerCapture(event.pointerId)
        drag(event)
      }}
      onPointerMove={(event) => {
        if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
        event.stopPropagation()
        drag(event)
      }}
      onPointerUp={(event) => {
        event.stopPropagation()
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId)
        }
      }}
      onDoubleClick={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      sx={{
        position: 'absolute',
        top: 0,
        bottom: 0,
        left: `${ratio * 100}%`,
        width: 0,
        zIndex: STAGE_Z.COMPARE,
        pointerEvents: 'none',
      }}
    >
      {/* the line */}
      <Box
        sx={{
          position: 'absolute',
          top: 0,
          bottom: 0,
          left: -1,
          width: 2,
          background: PAPER,
          boxShadow: `0 0 0 1px ${INK}`,
        }}
      />
      {/* the grip */}
      <Box
        sx={{
          position: 'absolute',
          top: '50%',
          left: 0,
          transform: 'translate(-50%, -50%)',
          width: 28,
          height: 44,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: INK,
          border: LINE_STRONG,
          color: PAPER,
          boxShadow: hardShadow(3),
          cursor: 'ew-resize',
          pointerEvents: 'auto',
          touchAction: 'none',
          '&:focus-visible': {
            outline: `2px solid ${VERMILION}`,
            outlineOffset: '2px',
          },
        }}
        role="slider"
        tabIndex={0}
        aria-label="对比分割线 / Compare"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(ratio * 100)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowLeft') setRatio(clamp(ratio - 0.02))
          if (event.key === 'ArrowRight') setRatio(clamp(ratio + 0.02))
        }}
      >
        <CompareIcon size={14} />
      </Box>
      {/* side labels */}
      <Typography
        component="span"
        sx={{
          position: 'absolute',
          top: 56,
          left: 14,
          fontFamily: MONO,
          fontSize: 9,
          fontWeight: 700,
          letterSpacing: '0.18em',
          color: PAPER,
          background: INK,
          border: `1px solid ${VERMILION}`,
          padding: '2px 6px',
          whiteSpace: 'nowrap',
          pointerEvents: 'none',
        }}
      >
        增强 / ENHANCED
      </Typography>
      <Typography
        component="span"
        sx={{
          position: 'absolute',
          top: 56,
          right: 14,
          fontFamily: MONO,
          fontSize: 9,
          fontWeight: 700,
          letterSpacing: '0.18em',
          color: PAPER,
          background: INK,
          border: `1px solid ${PAPER}`,
          padding: '2px 6px',
          whiteSpace: 'nowrap',
          pointerEvents: 'none',
        }}
      >
        原片 / ORIGINAL
      </Typography>
    </Box>
  )
}

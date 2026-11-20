import { Box, Stack, Typography } from '@mui/material'
import { useEffect, useState } from 'react'
import type { OsdMessage } from '@/store/playerStore'
import { usePlayerStore } from '@/store/playerStore'
import {
  hardShadow,
  INK,
  LINE_STRONG,
  MONO,
  MOTION_STAMP_IN,
  MOTION_STAMP_OUT,
  PAPER,
  VERMILION,
} from '@/theme/theme'

const OSD_DURATION = 900

/**
 * Large centered transient overlay (volume/seek feedback). Reads `osd` from the
 * store; on each new message it shows for ~900ms then clears. pointer-events:none.
 */
export const Osd = () => {
  const osd = usePlayerStore((s) => s.osd)
  const clearOsd = usePlayerStore((s) => s.clearOsd)
  // keep last content mounted through the fade-out after `osd` clears
  const [content, setContent] = useState<OsdMessage | null>(osd)
  const visible = Boolean(osd)
  const display = osd ?? content

  useEffect(() => {
    if (osd) setContent(osd)
  }, [osd])

  useEffect(() => {
    if (!osd) return
    const timer = setTimeout(() => clearOsd(), OSD_DURATION)
    return () => clearTimeout(timer)
  }, [osd, clearOsd])

  return (
    <Box
      sx={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        pointerEvents: 'none',
        zIndex: 30,
      }}
    >
      <Stack
        direction="row"
        alignItems="center"
        spacing={1}
        role="status"
        aria-live="polite"
        sx={{
          background: INK,
          border: LINE_STRONG,
          boxShadow: hardShadow(4, VERMILION),
          px: 2,
          py: 1.25,
          minWidth: 120,
          justifyContent: 'center',
          opacity: visible ? 1 : 0,
          transform: visible ? 'scale(1)' : 'scale(0.92)',
          transition: `opacity ${visible ? MOTION_STAMP_IN : MOTION_STAMP_OUT}, transform ${visible ? MOTION_STAMP_IN : MOTION_STAMP_OUT}`,
          '@media (prefers-reduced-motion: reduce)': {
            transform: 'none',
            transition: 'opacity 120ms linear',
          },
        }}
      >
        {display?.icon && (
          <Typography
            component="span"
            sx={{
              fontSize: 26,
              lineHeight: 1,
              color: PAPER,
            }}
          >
            {display.icon}
          </Typography>
        )}
        <Typography
          component="span"
          sx={{
            fontSize: 18,
            fontWeight: 700,
            fontFamily: MONO,
            color: PAPER,
            fontVariantNumeric: 'tabular-nums',
            whiteSpace: 'nowrap',
          }}
        >
          {display?.text}
        </Typography>
      </Stack>
    </Box>
  )
}

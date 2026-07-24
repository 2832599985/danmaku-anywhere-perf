import { Box, Fade, Stack, Typography } from '@mui/material'
import { useEffect, useState } from 'react'
import type { OsdMessage } from '@/store/playerStore'
import { usePlayerStore } from '@/store/playerStore'
import { glassSx } from '@/theme/theme'

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
      <Fade in={Boolean(osd)} timeout={{ enter: 120, exit: 320 }}>
        <Stack
          direction="row"
          alignItems="center"
          spacing={1.25}
          sx={{
            ...glassSx(0.6),
            borderRadius: '22px',
            px: 3,
            py: 1.75,
            minWidth: 120,
            justifyContent: 'center',
            boxShadow: '0 12px 40px rgba(0,0,0,0.45)',
          }}
        >
          {content?.icon && (
            <Typography component="span" sx={{ fontSize: 32, lineHeight: 1 }}>
              {content.icon}
            </Typography>
          )}
          <Typography
            component="span"
            sx={{
              fontSize: 26,
              fontWeight: 700,
              color: '#fff',
              fontVariantNumeric: 'tabular-nums',
              whiteSpace: 'nowrap',
            }}
          >
            {content?.text}
          </Typography>
        </Stack>
      </Fade>
    </Box>
  )
}

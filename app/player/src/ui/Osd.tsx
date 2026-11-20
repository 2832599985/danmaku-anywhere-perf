import { Box, Stack, Typography } from '@mui/material'
import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'
import type { OsdMessage } from '@/store/playerStore'
import { usePlayerStore } from '@/store/playerStore'
import {
  GREEN,
  hardShadow,
  INK,
  LINE_STRONG,
  MONO,
  MOTION_STAMP_IN,
  MOTION_STAMP_OUT,
  PAPER,
  STAGE_Z,
  VERMILION,
} from '@/theme/theme'
import {
  CheckIcon,
  CompareIcon,
  DanmakuIcon,
  NextIcon,
  PlaylistAddIcon,
  SeekBackIcon,
  SeekForwardIcon,
  SparkleIcon,
  SubtitleIcon,
  VolumeIcon,
  VolumeMuteIcon,
  WarningIcon,
} from './icons'

const OSD_DURATION = 900

/**
 * The store still passes emoji glyphs (other modules own those strings); the
 * stage maps them to single-colour ink SVGs. Unmapped glyphs are dropped — the
 * text already says what happened.
 */
const OSD_ICONS: Record<string, ReactNode> = {
  '🔊': <VolumeIcon size={22} />,
  '🔇': <VolumeMuteIcon size={22} />,
  '⏩': <SeekForwardIcon size={22} />,
  '⏪': <SeekBackIcon size={22} />,
  '⏭': <NextIcon size={22} />,
  '💬': <DanmakuIcon size={22} />,
  '🎬': <SubtitleIcon size={22} />,
  '✨': <SparkleIcon size={22} />,
  '📃': <PlaylistAddIcon size={22} />,
  '⇔': <CompareIcon size={22} />,
  '✓': <CheckIcon size={22} sx={{ color: GREEN }} />,
  '⚠': <WarningIcon size={22} sx={{ color: VERMILION }} />,
  '⚠️': <WarningIcon size={22} sx={{ color: VERMILION }} />,
}

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
        zIndex: STAGE_Z.OSD,
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
          maxWidth: 'min(560px, calc(100% - 48px))',
          justifyContent: 'center',
          opacity: visible ? 1 : 0,
          transform: visible ? 'scale(1)' : 'scale(0.92)',
          transition: `opacity ${visible ? MOTION_STAMP_IN : MOTION_STAMP_OUT}, transform ${visible ? MOTION_STAMP_IN : MOTION_STAMP_OUT}`,
          '@media (prefers-reduced-motion: reduce)': {
            transform: 'none',
            transition: 'opacity 120ms linear !important',
          },
        }}
      >
        {display?.icon ? (
          <Box
            component="span"
            sx={{ display: 'flex', color: PAPER, flexShrink: 0 }}
          >
            {OSD_ICONS[display.icon] ?? null}
          </Box>
        ) : null}
        <Typography
          component="span"
          sx={{
            fontSize: 18,
            fontWeight: 700,
            fontFamily: MONO,
            color: PAPER,
            fontVariantNumeric: 'tabular-nums',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {display?.text}
        </Typography>
      </Stack>
    </Box>
  )
}

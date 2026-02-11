import { Box, Collapse, Stack, Typography } from '@mui/material'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { DanmakuOptions } from '@/common/options/danmakuOptions/constant'

interface DanmakuPreviewProps {
  config: DanmakuOptions
}

interface SampleComment {
  text: string
  mode: 'rtl' | 'top' | 'bottom'
  color: string
  delay: number
  track: number
}

// Height of the preview container in pixels
const PREVIEW_HEIGHT = 120
const ANIMATION_DURATION = 6000

const sampleComments: SampleComment[] = [
  { text: 'Hello World!', mode: 'rtl', color: '#ffffff', delay: 0, track: 0 },
  {
    text: 'Nice video!',
    mode: 'rtl',
    color: '#00aeec',
    delay: 1200,
    track: 1,
  },
  { text: 'LOL', mode: 'top', color: '#fe0302', delay: 800, track: 0 },
  {
    text: 'Amazing!',
    mode: 'rtl',
    color: '#ffff00',
    delay: 2400,
    track: 2,
  },
  { text: 'GG', mode: 'bottom', color: '#ffffff', delay: 1600, track: 0 },
]

const ScrollingComment = ({
  comment,
  fontSize,
  opacity,
  fontFamily,
}: {
  comment: SampleComment
  fontSize: number
  opacity: number
  fontFamily: string
}) => {
  // Scale down font size for the compact preview area
  const scaledSize = fontSize * 0.6

  if (comment.mode === 'top' || comment.mode === 'bottom') {
    const posStyle =
      comment.mode === 'top'
        ? { top: `${comment.track * scaledSize * 1.3}px` }
        : { bottom: `${comment.track * scaledSize * 1.3}px` }
    return (
      <Box
        sx={{
          position: 'absolute',
          left: '50%',
          transform: 'translateX(-50%)',
          ...posStyle,
          color: comment.color,
          fontSize: `${scaledSize}px`,
          fontFamily,
          opacity,
          whiteSpace: 'nowrap',
          pointerEvents: 'none',
          textShadow: '1px 1px 2px rgba(0,0,0,0.8)',
          animation: `danmaku-preview-fade ${ANIMATION_DURATION * 0.6}ms ease-in-out ${comment.delay}ms infinite`,
        }}
      >
        {comment.text}
      </Box>
    )
  }

  return (
    <Box
      sx={{
        position: 'absolute',
        top: `${comment.track * scaledSize * 0.8}px`,
        right: 0,
        color: comment.color,
        fontSize: `${scaledSize}px`,
        fontFamily,
        opacity,
        whiteSpace: 'nowrap',
        pointerEvents: 'none',
        textShadow: '1px 1px 2px rgba(0,0,0,0.8)',
        animation: `danmaku-preview-scroll ${ANIMATION_DURATION}ms linear ${comment.delay}ms infinite`,
      }}
    >
      {comment.text}
    </Box>
  )
}

export const DanmakuPreview = ({ config }: DanmakuPreviewProps) => {
  const { t } = useTranslation()
  const [visible, setVisible] = useState(true)

  const { opacity, fontSize, fontFamily } = config.style

  return (
    <Stack spacing={0.5}>
      <Stack direction="row" alignItems="center" justifyContent="space-between">
        <Typography variant="body2" color="text.secondary">
          {t('stylePage.preview.label', 'Preview')}
        </Typography>
        <Typography
          variant="caption"
          color="primary"
          sx={{ cursor: 'pointer', userSelect: 'none' }}
          onClick={() => setVisible((v) => !v)}
        >
          {visible
            ? t('stylePage.preview.hide', 'Hide')
            : t('stylePage.preview.show', 'Show')}
        </Typography>
      </Stack>
      <Collapse in={visible} unmountOnExit>
        <Box
          sx={(theme) => ({
            position: 'relative',
            width: '100%',
            height: PREVIEW_HEIGHT,
            borderRadius: 1,
            overflow: 'hidden',
            backgroundColor: 'rgba(0, 0, 0, 0.85)',
            border: `1px solid ${theme.palette.divider}`,
            '@keyframes danmaku-preview-scroll': {
              '0%': { transform: 'translateX(100%)' },
              '100%': { transform: 'translateX(-200%)' },
            },
            '@keyframes danmaku-preview-fade': {
              '0%, 100%': { opacity: 0 },
              '20%, 80%': { opacity: 1 },
            },
          })}
        >
          <Box
            sx={{
              position: 'absolute',
              top: `${config.area.yStart}%`,
              left: 0,
              right: 0,
              height: `${config.area.yEnd - config.area.yStart}%`,
              overflow: 'hidden',
            }}
          >
            {sampleComments.map((comment) => (
              <ScrollingComment
                key={comment.text}
                comment={comment}
                fontSize={fontSize}
                opacity={opacity}
                fontFamily={fontFamily}
              />
            ))}
          </Box>
        </Box>
      </Collapse>
    </Stack>
  )
}

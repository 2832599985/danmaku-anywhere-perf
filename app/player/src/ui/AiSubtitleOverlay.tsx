import { Box, Typography } from '@mui/material'
import { alpha } from '@mui/material/styles'
import type { SyntheticEvent } from 'react'
import { usePlayerStore } from '@/store/playerStore'
import { skipBurst } from '@/subtitle/generate'
import {
  hardShadow,
  INK,
  INK_SCRIM_HEAVY,
  inkStampPressSx,
  LINE_STRONG,
  LINE_SUBTLE,
  MONO,
  MOTION_BANNER,
  PAPER,
  STAGE_Z,
  VERMILION,
} from '@/theme/theme'

/** Clicks on the card must not reach the stage (click = play/pause). */
const swallow = (event: SyntheticEvent) => event.stopPropagation()

/** The realtime HUD owns `top: 62, right: 26`; the tag drops below it. */
const HUD_FLOOR = 112

/**
 * AI subtitle status on the stage: the burst card (video auto-paused while the
 * GPU generates the next stretch; 直接播放 ends it) and, while playing, a small
 * "字幕生成中" tag when playback has caught up with the finished Chinese.
 * In mini-player mode both collapse into a compact bottom pill.
 */
export const AiSubtitleOverlay = () => {
  const aiGen = usePlayerStore((s) => s.aiGen)
  const upscaleStatus = usePlayerStore((s) => s.upscaleStatus)
  const mini = usePlayerStore((s) => s.miniPlayer)
  if (!aiGen) return null

  if (aiGen.phase === 'follow') {
    if (!aiGen.behind) return null
    return (
      <Box
        sx={{
          position: 'absolute',
          ...(mini
            ? { bottom: 18, right: 8, padding: '2px 8px', fontSize: 10 }
            : {
                top: upscaleStatus === 'active' ? HUD_FLOOR : 64,
                right: 16,
                padding: '4px 10px',
                fontSize: 11,
              }),
          zIndex: STAGE_Z.AI_OVERLAY,
          pointerEvents: 'none',
          background: INK_SCRIM_HEAVY,
          border: LINE_STRONG,
          color: PAPER,
          fontFamily: MONO,
          fontWeight: 700,
        }}
      >
        字幕生成中…
      </Box>
    )
  }

  const translating = aiGen.stage === 'translating'
  const where = translating ? aiGen.mtGpu : aiGen.asrGpu
  const percent = Math.round(aiGen.progress * 100)

  return (
    <Box
      onClick={swallow}
      onDoubleClick={swallow}
      onPointerDown={swallow}
      sx={{
        position: 'absolute',
        ...(mini
          ? {
              bottom: 18,
              left: '50%',
              transform: 'translateX(-50%)',
              width: 'min(320px, calc(100% - 16px))',
              padding: '8px 10px',
            }
          : {
              // The mounted-danmaku banner sits at top 62 (HUD row); the card
              // starts below it so the two never stack on the same pixels.
              top: upscaleStatus === 'active' ? HUD_FLOOR : 84,
              left: '50%',
              transform: 'translateX(-50%)',
              width: 'min(420px, calc(100% - 32px))',
              padding: '12px 14px',
            }),
        zIndex: STAGE_Z.AI_OVERLAY,
        background: INK,
        border: LINE_STRONG,
        boxShadow: hardShadow(4),
        cursor: 'default',
        animation: `ink-panel-in ${MOTION_BANNER}`,
        '@media (prefers-reduced-motion: reduce)': {
          animation: 'none',
        },
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography
            sx={{ fontSize: mini ? 12 : 13, fontWeight: 700, color: PAPER }}
          >
            {where === false ? '正在生成字幕' : '正在借用显卡生成字幕'}
          </Typography>
          <Typography
            sx={{
              mt: '2px',
              fontFamily: MONO,
              fontSize: mini ? 10 : 11,
              fontWeight: 700,
              color: alpha(PAPER, 0.6),
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {translating ? '翻译' : '识别'} {percent}% · 好了自动继续播放
          </Typography>
        </Box>
        <Box
          component="button"
          type="button"
          onClick={(event) => {
            event.stopPropagation()
            skipBurst()
          }}
          sx={{
            appearance: 'none',
            flex: '0 0 auto',
            border: `2px solid ${aiGen.ready ? VERMILION : PAPER}`,
            color: PAPER,
            padding: mini ? '3px 8px' : '5px 12px',
            fontSize: mini ? 11 : 12,
            fontWeight: 700,
            cursor: 'pointer',
            ...inkStampPressSx(
              2,
              VERMILION,
              aiGen.ready
                ? {
                    background: VERMILION,
                    color: PAPER,
                    borderColor: VERMILION,
                  }
                : { background: PAPER, color: INK, borderColor: PAPER }
            ),
            ...(aiGen.ready ? { background: VERMILION } : {}),
          }}
        >
          直接播放
        </Box>
      </Box>
      <Box
        sx={{
          mt: '10px',
          height: '6px',
          border: LINE_SUBTLE,
          position: 'relative',
        }}
      >
        <Box
          sx={{
            position: 'absolute',
            inset: 0,
            width: `${percent}%`,
            background: VERMILION,
            transition: 'width 300ms linear',
            '@media (prefers-reduced-motion: reduce)': {
              transition: 'none',
            },
          }}
        />
      </Box>
    </Box>
  )
}

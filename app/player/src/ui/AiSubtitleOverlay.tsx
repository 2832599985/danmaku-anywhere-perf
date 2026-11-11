import { Box, Typography } from '@mui/material'
import { alpha } from '@mui/material/styles'
import type { SyntheticEvent } from 'react'
import { usePlayerStore } from '@/store/playerStore'
import { skipBurst } from '@/subtitle/generate'
import { INK, LINE_STRONG, MONO, PAPER, VERMILION } from '@/theme/theme'

/** Clicks on the card must not reach the stage (click = play/pause). */
const swallow = (event: SyntheticEvent) => event.stopPropagation()

/**
 * AI subtitle status on the stage: the burst card (video auto-paused while the
 * GPU generates the next stretch; 直接播放 ends it) and, while playing, a small
 * "字幕生成中" tag when playback has caught up with the finished Chinese.
 */
export const AiSubtitleOverlay = () => {
  const aiGen = usePlayerStore((s) => s.aiGen)
  if (!aiGen) return null

  if (aiGen.phase === 'follow') {
    if (!aiGen.behind) return null
    return (
      <Box
        sx={{
          position: 'absolute',
          top: 64,
          right: 16,
          zIndex: 31,
          pointerEvents: 'none',
          background: alpha(INK, 0.85),
          border: LINE_STRONG,
          color: PAPER,
          fontFamily: MONO,
          fontSize: 11,
          fontWeight: 700,
          padding: '4px 10px',
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
        top: 64,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 31,
        width: 'min(420px, calc(100% - 32px))',
        background: INK,
        border: LINE_STRONG,
        boxShadow: `4px 4px 0 ${alpha(VERMILION, 0.9)}`,
        padding: '12px 14px',
        cursor: 'default',
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography sx={{ fontSize: 13, fontWeight: 700, color: PAPER }}>
            {where === false ? '正在生成字幕' : '正在借用显卡生成字幕'}
          </Typography>
          <Typography
            sx={{
              mt: '2px',
              fontFamily: MONO,
              fontSize: 11,
              fontWeight: 700,
              color: alpha(PAPER, 0.6),
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
            background: aiGen.ready ? VERMILION : 'transparent',
            color: PAPER,
            padding: '5px 12px',
            fontSize: 12,
            fontWeight: 700,
            cursor: 'pointer',
            '&:hover': { background: PAPER, color: INK },
          }}
        >
          直接播放
        </Box>
      </Box>
      <Box
        sx={{
          mt: '10px',
          height: '6px',
          border: `1px solid ${alpha(PAPER, 0.6)}`,
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
          }}
        />
      </Box>
    </Box>
  )
}

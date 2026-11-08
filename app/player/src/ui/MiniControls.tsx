import { Box } from '@mui/material'
import { alpha } from '@mui/material/styles'
import { usePlayerCommands } from '@/player/commands'
import { usePlayerStore } from '@/store/playerStore'
import { INK, LINE_STRONG, MONO, PAPER, VERMILION } from '@/theme/theme'

const buttonSx = {
  width: 30,
  height: 30,
  display: 'grid',
  placeItems: 'center',
  background: INK,
  color: PAPER,
  border: LINE_STRONG,
  cursor: 'pointer',
  fontSize: 13,
  fontWeight: 900,
  padding: 0,
  '&:hover': { background: VERMILION },
} as const

/**
 * The whole chrome of the mini player (小窗): a thin progress line and two
 * buttons, shown on hover. Everything else in the window is a drag handle for
 * the window itself (`data-tauri-drag-region` on the stage while mini).
 */
export const MiniControls = ({ visible }: { visible: boolean }) => {
  const commands = usePlayerCommands()
  const playing = usePlayerStore((s) => s.playback.playing)
  const currentTime = usePlayerStore((s) => s.playback.currentTime)
  const duration = usePlayerStore((s) => s.playback.duration)
  const ratio = duration > 0 ? Math.min(currentTime / duration, 1) : 0

  return (
    <Box
      data-mini-controls
      sx={{
        position: 'absolute',
        inset: 0,
        zIndex: 5,
        pointerEvents: 'none',
        opacity: visible ? 1 : 0,
        transition: 'opacity 160ms',
      }}
    >
      <Box
        sx={{
          position: 'absolute',
          top: 8,
          right: 8,
          display: 'flex',
          gap: '6px',
          pointerEvents: visible ? 'auto' : 'none',
        }}
      >
        <Box
          component="button"
          type="button"
          aria-label={playing ? '暂停 / Pause' : '播放 / Play'}
          onClick={() => commands.togglePlay()}
          // The stage beneath is a drag region; a press here must stay a click.
          onMouseDown={(e: React.MouseEvent) => e.stopPropagation()}
          onDoubleClick={(e: React.MouseEvent) => e.stopPropagation()}
          sx={buttonSx}
        >
          {playing ? '❚❚' : '▶'}
        </Box>
        <Box
          component="button"
          type="button"
          aria-label="退出小窗 / Exit mini player"
          onClick={() => void commands.toggleMiniPlayer()}
          onMouseDown={(e: React.MouseEvent) => e.stopPropagation()}
          onDoubleClick={(e: React.MouseEvent) => e.stopPropagation()}
          sx={buttonSx}
        >
          ⤢
        </Box>
      </Box>
      <Box
        sx={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          height: 3,
          background: alpha(PAPER, 0.25),
        }}
      >
        <Box
          sx={{
            height: '100%',
            width: `${ratio * 100}%`,
            background: VERMILION,
          }}
        />
      </Box>
      <Box
        sx={{
          position: 'absolute',
          left: 8,
          top: 10,
          fontFamily: MONO,
          fontSize: 10,
          color: alpha(PAPER, 0.7),
          letterSpacing: '0.12em',
        }}
      >
        小窗 · 双击还原
      </Box>
    </Box>
  )
}

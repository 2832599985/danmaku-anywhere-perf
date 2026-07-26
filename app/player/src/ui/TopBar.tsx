import {
  FolderOpenRounded,
  PlaylistPlayRounded,
  SubtitlesRounded,
  TuneRounded,
} from '@mui/icons-material'
import { Box, Button, Chip, Stack, Tooltip, Typography } from '@mui/material'
import { usePlayerCommands } from '@/player/commands'
import { usePlayerStore } from '@/store/playerStore'
import { ACCENT_GRADIENT, glassSx, gradientTextSx } from '@/theme/theme'

interface TopBarProps {
  /** When false, the bar fades and slides up out of view. */
  visible: boolean
}

export const TopBar = ({ visible }: TopBarProps) => {
  const commands = usePlayerCommands()
  const media = usePlayerStore((s) => s.media)
  const danmakuSource = usePlayerStore((s) => s.danmakuSource)
  const isHdr = usePlayerStore((s) => s.isHdr)
  const hdrTransfer = usePlayerStore((s) => s.hdrTransfer)
  const playlistOpen = usePlayerStore((s) => s.playlistOpen)
  const playlist = usePlayerStore((s) => s.playlist)
  const setDanmakuDialogOpen = usePlayerStore((s) => s.setDanmakuDialogOpen)
  const setSettingsOpen = usePlayerStore((s) => s.setSettingsOpen)

  return (
    <Box
      sx={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 20,
        px: 1.5,
        pt: 1,
        pb: 3,
        background:
          'linear-gradient(to bottom, rgba(0,0,0,0.5) 0%, rgba(0,0,0,0.22) 55%, transparent 100%)',
        opacity: visible ? 1 : 0,
        transform: visible ? 'translateY(0)' : 'translateY(-12px)',
        transition: 'opacity 220ms ease, transform 220ms ease',
        pointerEvents: visible ? 'auto' : 'none',
      }}
    >
      <Box
        sx={{
          ...glassSx(0.5),
          borderRadius: '999px',
          px: 1.5,
          py: 0.75,
          display: 'flex',
          alignItems: 'center',
          gap: 1,
        }}
      >
        <Box
          sx={{
            width: 26,
            height: 26,
            borderRadius: '8px',
            background: ACCENT_GRADIENT,
            flexShrink: 0,
            boxShadow: '0 0 16px rgba(167,139,250,0.5)',
          }}
        />
        <Typography
          variant="subtitle1"
          sx={{ ...gradientTextSx, fontWeight: 800, flexShrink: 0 }}
        >
          弹幕播放器
        </Typography>

        {/* current media + danmaku source */}
        <Stack
          direction="row"
          spacing={1}
          alignItems="center"
          sx={{ flex: 1, minWidth: 0, overflow: 'hidden' }}
        >
          {media?.name && (
            <Typography
              variant="body2"
              color="text.secondary"
              noWrap
              title={media.name}
              sx={{ minWidth: 0 }}
            >
              {media.name}
            </Typography>
          )}
          {isHdr && (
            <Chip
              size="small"
              label={hdrTransfer === 'hlg' ? 'HLG' : 'HDR10'}
              title="HDR 片源 · 需 Windows HDR 模式与 HDR 显示器方可完整呈现"
              sx={{
                flexShrink: 0,
                fontWeight: 800,
                letterSpacing: 0.4,
                bgcolor: 'rgba(250,204,21,0.16)',
                color: '#fde047',
                border: '1px solid rgba(250,204,21,0.4)',
              }}
            />
          )}
          {danmakuSource && (
            <Chip
              size="small"
              icon={<SubtitlesRounded />}
              label={`${danmakuSource.label} · ${danmakuSource.count}`}
              sx={{
                maxWidth: 280,
                bgcolor: 'rgba(167,139,250,0.16)',
                color: 'primary.light',
                border: '1px solid rgba(167,139,250,0.32)',
                '& .MuiChip-icon': { color: 'primary.light' },
              }}
            />
          )}
        </Stack>

        <Stack direction="row" spacing={0.5} alignItems="center">
          <Button
            size="small"
            startIcon={<FolderOpenRounded />}
            onClick={() => void commands.openVideo()}
            sx={{ color: 'text.primary' }}
          >
            打开视频
          </Button>
          <Button
            size="small"
            startIcon={<SubtitlesRounded />}
            onClick={() => setDanmakuDialogOpen(true)}
            sx={{ color: 'text.primary' }}
          >
            弹幕
          </Button>
          <Button
            size="small"
            startIcon={<PlaylistPlayRounded />}
            onClick={() => commands.togglePlaylist()}
            sx={{
              color: 'text.primary',
              ...(playlistOpen && { color: 'primary.light' }),
            }}
          >
            {playlist.length > 1 ? `播放列表 · ${playlist.length}` : '播放列表'}
          </Button>
          <Tooltip title="设置 / Settings">
            <Button
              size="small"
              startIcon={<TuneRounded />}
              onClick={() => setSettingsOpen(true)}
              sx={{ color: 'text.primary' }}
            >
              设置
            </Button>
          </Tooltip>
        </Stack>
      </Box>
    </Box>
  )
}

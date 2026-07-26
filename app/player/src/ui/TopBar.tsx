import {
  CloseRounded,
  CropSquareRounded,
  FolderOpenRounded,
  HorizontalRuleRounded,
  PlaylistPlayRounded,
  SubtitlesRounded,
  TuneRounded,
} from '@mui/icons-material'
import {
  Box,
  Button,
  Chip,
  Divider,
  IconButton,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material'
import type { Platform } from '@/platform'
import { usePlayerCommands } from '@/player/commands'
import { usePlayerStore } from '@/store/playerStore'
import { glassSx, gradientTextSx } from '@/theme/theme'
import { LogoMark } from './LogoMark'

interface TopBarProps {
  /** When false, the bar fades and slides up out of view. */
  visible: boolean
  /** Window chrome lives here now — the native title bar is disabled. */
  platform: Platform
}

/** Marks an element as a native-window drag handle (undecorated Tauri window). */
const dragRegion = { 'data-tauri-drag-region': true }

export const TopBar = ({ visible, platform }: TopBarProps) => {
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
      {...dragRegion}
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
        {...dragRegion}
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
        <LogoMark size={26} glow={0.45} />
        <Typography
          variant="subtitle1"
          sx={{ ...gradientTextSx, fontWeight: 800, flexShrink: 0 }}
        >
          弹幕播放器
        </Typography>

        {/* current media + danmaku source */}
        <Stack
          {...dragRegion}
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

          {/* window chrome — the OS title bar is disabled (undecorated) */}
          {platform.isTauri && (
            <>
              <Divider
                orientation="vertical"
                flexItem
                sx={{ mx: 0.5, my: 0.5, borderColor: 'rgba(255,255,255,0.10)' }}
              />
              <IconButton
                size="small"
                aria-label="最小化 / Minimize"
                onClick={() => platform.minimizeWindow()}
                sx={{ borderRadius: '10px' }}
              >
                <HorizontalRuleRounded sx={{ fontSize: 18 }} />
              </IconButton>
              <IconButton
                size="small"
                aria-label="最大化 / Maximize"
                onClick={() => platform.toggleMaximizeWindow()}
                sx={{ borderRadius: '10px' }}
              >
                <CropSquareRounded sx={{ fontSize: 15 }} />
              </IconButton>
              <IconButton
                size="small"
                aria-label="关闭 / Close"
                onClick={() => platform.closeWindow()}
                sx={{
                  borderRadius: '10px',
                  '&:hover': {
                    backgroundColor: 'rgba(225,29,72,0.85)',
                    color: '#fff',
                  },
                }}
              >
                <CloseRounded sx={{ fontSize: 18 }} />
              </IconButton>
            </>
          )}
        </Stack>
      </Box>
    </Box>
  )
}

import {
  AddRounded,
  CloseRounded,
  DeleteOutlineRounded,
  PlayArrowRounded,
} from '@mui/icons-material'
import {
  Box,
  Drawer,
  IconButton,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  Stack,
  Switch,
  Typography,
} from '@mui/material'
import { usePlayerCommands } from '@/player/commands'
import { useFullscreenPortalContainer } from '@/player/fullscreenPortal'
import { usePlayerStore } from '@/store/playerStore'

export const PlaylistDrawer = () => {
  const commands = usePlayerCommands()
  const container = useFullscreenPortalContainer()
  const playlist = usePlayerStore((s) => s.playlist)
  const playlistIndex = usePlayerStore((s) => s.playlistIndex)
  const playlistOpen = usePlayerStore((s) => s.playlistOpen)
  const autoAdvance = usePlayerStore((s) => s.playbackSettings.autoAdvance)
  const setPlaylistOpen = usePlayerStore((s) => s.setPlaylistOpen)
  const removePlaylistIndex = usePlayerStore((s) => s.removePlaylistIndex)
  const clearPlaylist = usePlayerStore((s) => s.clearPlaylist)
  const updatePlaybackSettings = usePlayerStore((s) => s.updatePlaybackSettings)

  const handleRemoveItem = (
    e: React.MouseEvent<HTMLButtonElement>,
    index: number
  ) => {
    e.stopPropagation()
    removePlaylistIndex(index)
  }

  return (
    <Drawer
      anchor="right"
      open={playlistOpen}
      onClose={() => setPlaylistOpen(false)}
      slotProps={{
        root: { container },
        paper: { sx: { width: 360, maxWidth: '92vw' } },
      }}
    >
      <Stack sx={{ height: '100%' }}>
        {/* Header */}
        <Stack
          direction="row"
          alignItems="center"
          justifyContent="space-between"
          sx={{ px: 2, py: 1.5 }}
        >
          <Stack direction="row" alignItems="baseline" spacing={0.75}>
            <Typography variant="h6" sx={{ fontWeight: 800 }}>
              播放列表
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {playlist.length} 项
            </Typography>
          </Stack>
          <Stack direction="row" spacing={0.5}>
            <IconButton
              size="small"
              onClick={() => void commands.addVideosToPlaylist()}
              disabled={false}
              title="添加视频 / Add"
            >
              <AddRounded fontSize="small" />
            </IconButton>
            <IconButton
              size="small"
              onClick={() => clearPlaylist()}
              disabled={playlist.length === 0}
              title="清空列表 / Clear"
            >
              <CloseRounded fontSize="small" />
            </IconButton>
          </Stack>
        </Stack>

        {/* Auto-advance toggle */}
        <Stack
          direction="row"
          alignItems="center"
          justifyContent="space-between"
          sx={{
            px: 2,
            py: 1.5,
            borderBottom: '1px solid',
            borderColor: 'divider',
          }}
        >
          <Stack spacing={0.25}>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>
              自动连播
            </Typography>
            <Typography variant="caption" color="text.secondary">
              播完自动播放下一个
            </Typography>
          </Stack>
          <Switch
            size="small"
            checked={autoAdvance}
            onChange={(e) =>
              updatePlaybackSettings({ autoAdvance: e.target.checked })
            }
          />
        </Stack>

        {/* Playlist content */}
        <Box sx={{ flex: 1, overflowY: 'auto', py: 0 }}>
          {playlist.length === 0 ? (
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                height: '100%',
                px: 2,
              }}
            >
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{ textAlign: 'center' }}
              >
                列表为空 · 打开或拖入多个视频
              </Typography>
            </Box>
          ) : (
            <List sx={{ py: 0 }}>
              {playlist.map((item, index) => {
                const isActive = index === playlistIndex
                return (
                  <ListItem
                    key={`${index}:${item.url}`}
                    disablePadding
                    secondaryAction={
                      <IconButton
                        edge="end"
                        size="small"
                        onClick={(e) => handleRemoveItem(e, index)}
                        sx={{ opacity: 0.6, '&:hover': { opacity: 1 } }}
                      >
                        <DeleteOutlineRounded fontSize="small" />
                      </IconButton>
                    }
                  >
                    <ListItemButton
                      onClick={() => commands.playlistPlayAt(index)}
                      sx={{
                        bgcolor: isActive
                          ? 'rgba(167,139,250,0.16)'
                          : 'transparent',
                        '&:hover': {
                          bgcolor: isActive
                            ? 'rgba(167,139,250,0.24)'
                            : 'rgba(255,255,255,0.06)',
                        },
                      }}
                    >
                      <Stack
                        direction="row"
                        alignItems="center"
                        spacing={1}
                        sx={{ flex: 1, minWidth: 0 }}
                      >
                        <Typography
                          variant="caption"
                          sx={{
                            fontWeight: 700,
                            color: isActive
                              ? 'primary.light'
                              : 'text.secondary',
                            minWidth: 28,
                          }}
                        >
                          {index + 1}
                        </Typography>
                        <ListItemText
                          primary={item.name}
                          primaryTypographyProps={{
                            variant: 'body2',
                            noWrap: true,
                            sx: {
                              color: isActive
                                ? 'primary.light'
                                : 'text.primary',
                              fontWeight: isActive ? 600 : 500,
                            },
                            title: item.name,
                          }}
                        />
                        {isActive && (
                          <PlayArrowRounded
                            sx={{
                              fontSize: 16,
                              color: 'primary.light',
                              flexShrink: 0,
                            }}
                          />
                        )}
                      </Stack>
                    </ListItemButton>
                  </ListItem>
                )
              })}
            </List>
          )}
        </Box>
      </Stack>
    </Drawer>
  )
}

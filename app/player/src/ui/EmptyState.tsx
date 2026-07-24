import { FolderOpenRounded, MovieCreationRounded } from '@mui/icons-material'
import { Box, Button, Stack, Typography } from '@mui/material'
import { usePlayerCommands } from '@/player/commands'
import { ACCENT_GRADIENT, gradientTextSx } from '@/theme/theme'

/**
 * Shown when no media is loaded — a friendly drop target with a prominent
 * "open" button. Global drag-drop wiring lives elsewhere; this is the prompt.
 */
export const EmptyState = () => {
  const commands = usePlayerCommands()

  return (
    <Box
      sx={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        p: 3,
        // faint violet pools echoing the extension's「画光」canvas
        background:
          'radial-gradient(120% 90% at 18% -10%, rgba(167,139,250,0.16), transparent 55%),' +
          'radial-gradient(90% 70% at 100% 110%, rgba(232,121,249,0.12), transparent 60%)',
      }}
    >
      <Stack
        alignItems="center"
        spacing={2.5}
        sx={{
          textAlign: 'center',
          maxWidth: 460,
          width: '100%',
          px: 4,
          py: 6,
          borderRadius: '24px',
          border: '1.5px dashed rgba(255,255,255,0.16)',
          backgroundColor: 'rgba(255,255,255,0.02)',
        }}
      >
        <Box
          sx={{
            width: 84,
            height: 84,
            borderRadius: '50%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(167,139,250,0.14)',
            border: '1px solid rgba(167,139,250,0.3)',
            boxShadow: '0 0 40px rgba(167,139,250,0.25)',
          }}
        >
          <MovieCreationRounded sx={{ fontSize: 44, color: 'primary.light' }} />
        </Box>

        <Box>
          <Typography
            variant="h5"
            sx={{ ...gradientTextSx, fontWeight: 800, mb: 0.5 }}
          >
            拖入视频文件，或点击打开
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Drop a video here or click to open
          </Typography>
        </Box>

        <Button
          variant="contained"
          size="large"
          startIcon={<FolderOpenRounded />}
          onClick={() => void commands.openVideo()}
          sx={{
            px: 4,
            py: 1.25,
            fontSize: 15,
            background: ACCENT_GRADIENT,
            color: '#0b0b12',
            boxShadow: '0 8px 28px rgba(167,139,250,0.4)',
            '&:hover': {
              background: ACCENT_GRADIENT,
              filter: 'brightness(1.08)',
              boxShadow: '0 10px 34px rgba(167,139,250,0.5)',
            },
          }}
        >
          打开视频 / Open
        </Button>

        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ opacity: 0.7 }}
        >
          支持 MP4 / MKV / WebM 等主流格式
        </Typography>
      </Stack>
    </Box>
  )
}

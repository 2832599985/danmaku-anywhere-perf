import { Box } from '@mui/material'
import type { Platform } from '@/platform'
import { PlayerHost } from '@/player/PlayerHost'

interface AppProps {
  platform: Platform
}

/** Thin composition root — the whole player lives inside PlayerHost. */
export const App = ({ platform }: AppProps) => (
  <Box
    sx={{
      position: 'fixed',
      inset: 0,
      bgcolor: '#000',
      color: 'text.primary',
      overflow: 'hidden',
      userSelect: 'none',
    }}
  >
    <PlayerHost platform={platform} />
  </Box>
)

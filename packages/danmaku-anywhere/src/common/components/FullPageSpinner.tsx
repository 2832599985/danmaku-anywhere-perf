import { Box, CircularProgress } from '@mui/material'
import { useThemeContext } from '@/common/theme/Theme'

import { Center } from './Center'

export const FullPageSpinner = () => {
  const { palette } = useThemeContext()

  return (
    <Center>
      <Box
        sx={{
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          '&::after': {
            content: '""',
            position: 'absolute',
            width: '120%',
            height: '120%',
            borderRadius: '50%',
            background: `radial-gradient(circle, ${palette.glass.glow} 0%, transparent 70%)`,
            opacity: 0.3,
            filter: 'blur(8px)',
            pointerEvents: 'none',
          },
        }}
      >
        <CircularProgress />
      </Box>
    </Center>
  )
}

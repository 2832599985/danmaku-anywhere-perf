import { Box, Fade, keyframes } from '@mui/material'

const breathingGlow = keyframes`
  0%, 100% {
    box-shadow:
      0 0 8px 2px rgba(139, 92, 246, 0.3),
      0 0 16px 4px rgba(217, 70, 239, 0.15);
    opacity: 0.6;
  }
  50% {
    box-shadow:
      0 0 14px 5px rgba(139, 92, 246, 0.5),
      0 0 28px 8px rgba(217, 70, 239, 0.25);
    opacity: 1;
  }
`

interface FabLoadingIndicatorProps {
  isLoading: boolean
  primaryColor?: string
  secondaryColor?: string
}

export const FabLoadingIndicator = ({
  isLoading,
  primaryColor = 'rgba(139, 92, 246, 0.5)',
  secondaryColor = 'rgba(217, 70, 239, 0.25)',
}: FabLoadingIndicatorProps) => {
  return (
    <Fade in={isLoading}>
      <Box
        position="absolute"
        width={48}
        height={48}
        top={-4}
        left={-4}
        sx={{
          pointerEvents: 'none',
          borderRadius: '50%',
          animation: `${breathingGlow} 2s ease-in-out infinite`,
          boxShadow: `0 0 8px 2px ${primaryColor}, 0 0 16px 4px ${secondaryColor}`,
        }}
      />
    </Fade>
  )
}

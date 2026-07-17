import { Box, Fade, keyframes } from '@mui/material'

// Breathing glow animation: uses CSS variables that will be injected at runtime
// so the colors follow the theme without creating multiple keyframe definitions
const breathingGlow = keyframes`
  0%, 100% {
    opacity: 0.6;
  }
  50% {
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
  primaryColor,
  secondaryColor,
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
          boxShadow:
            primaryColor && secondaryColor
              ? `0 0 8px 2px ${primaryColor}, 0 0 16px 4px ${secondaryColor}`
              : undefined,
        }}
      />
    </Fade>
  )
}

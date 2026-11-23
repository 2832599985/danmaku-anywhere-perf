import { Box, Typography } from '@mui/material'
import { type ReactNode, Suspense } from 'react'
import { ErrorBoundary } from 'react-error-boundary'
import { useTranslation } from 'react-i18next'
import { Center } from '@/common/components/Center'
import { SuspenseImage } from '@/common/components/image/SuspenseImage'
import { useThemeContext } from '@/common/theme/Theme'

import { IMAGE_ASSETS } from '@/images/ImageAssets'

type NothingHereProps = {
  message?: string
  size?: number
  children?: ReactNode
}

export const NothingHere = ({
  message,
  size = 300,
  children,
}: NothingHereProps) => {
  const { t } = useTranslation()
  const { palette } = useThemeContext()

  return (
    <Center>
      <Box
        sx={{
          textAlign: 'center',
          '& svg': {
            filter: `drop-shadow(0 0 24px ${palette.glass.glow})`,
          },
        }}
      >
        <Typography sx={{ mb: 2 }}>
          {message ?? t('common.itsEmpty', "There's nothing here...")}
        </Typography>
        {children}
        <ErrorBoundary fallback={null}>
          <Suspense fallback={null}>
            <SuspenseImage
              src={IMAGE_ASSETS.Empty}
              width={size}
              height={size}
            />
          </Suspense>
        </ErrorBoundary>
      </Box>
    </Center>
  )
}

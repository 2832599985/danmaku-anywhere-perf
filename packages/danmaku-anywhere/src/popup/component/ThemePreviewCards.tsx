import { Check } from '@mui/icons-material'
import { Box, Typography } from '@mui/material'
import { alpha } from '@mui/material/styles'
import type { MouseEvent } from 'react'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useThemeContext } from '@/common/theme/Theme'
import type { ThemePalette } from '@/common/theme/themes'
import { getThemePalette, themeIds } from '@/common/theme/themes'
import { useViewTransition } from '@/common/theme/useViewTransition'

interface ThemeCardProps {
  palette: ThemePalette
  selected: boolean
  onSelect: (e: MouseEvent, id: string) => void
}

const ThemeCard = ({ palette, selected, onSelect }: ThemeCardProps) => {
  const { t } = useTranslation()

  return (
    <Box
      onClick={(e) => onSelect(e, palette.id)}
      sx={{
        position: 'relative',
        cursor: 'pointer',
        borderRadius: 2,
        overflow: 'hidden',
        border: '2px solid',
        borderColor: selected ? palette.primary : 'transparent',
        boxShadow: selected
          ? `0 0 12px 2px ${palette.primary}80, inset 0 0 8px ${palette.primary}30`
          : '0 1px 4px rgba(0,0,0,0.2)',
        transition: 'box-shadow 0.25s ease, border-color 0.25s ease',
        '&:hover': {
          boxShadow: `0 0 10px 1px ${palette.primary}60`,
          borderColor: selected ? palette.primary : `${palette.primary}80`,
        },
      }}
    >
      {/* Preview area */}
      <Box
        sx={{
          height: 56,
          background: palette.gradient,
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {/* Mini glass card preview */}
        <Box
          sx={{
            width: '60%',
            height: 28,
            borderRadius: 999,
            backgroundColor: palette.glass.base,
            backgroundImage: palette.glass.tint,
            backdropFilter: palette.glass.blur,
            border: `1px solid ${palette.glass.border}`,
            boxShadow: palette.glass.specular,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 0.5,
          }}
        >
          {/* Mini FAB */}
          <Box
            sx={{
              width: 14,
              height: 14,
              borderRadius: '50%',
              background: palette.gradient,
              flexShrink: 0,
            }}
          />
          {/* Mini text lines */}
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
            <Box
              sx={{
                width: 28,
                height: 3,
                borderRadius: 1,
                backgroundColor: (theme) =>
                  alpha(theme.palette.text.primary, 0.62),
              }}
            />
            <Box
              sx={{
                width: 18,
                height: 3,
                borderRadius: 1,
                backgroundColor: (theme) =>
                  alpha(theme.palette.text.primary, 0.32),
              }}
            />
          </Box>
        </Box>

        {/* Selected checkmark */}
        {selected && (
          <Box
            sx={{
              position: 'absolute',
              top: 4,
              right: 4,
              width: 18,
              height: 18,
              borderRadius: '50%',
              backgroundColor: palette.primary,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Check sx={{ fontSize: 12, color: '#fff' }} />
          </Box>
        )}
      </Box>

      {/* Label */}
      <Box
        sx={{
          px: 1,
          py: 0.5,
          backgroundColor: palette.glass.scrim,
          backgroundImage: palette.glass.tint,
          display: 'flex',
          alignItems: 'center',
          gap: 0.5,
        }}
      >
        <Box
          sx={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: palette.gradient,
            flexShrink: 0,
          }}
        />
        <Typography
          variant="caption"
          sx={{
            color: 'text.primary',
            fontSize: '0.65rem',
            lineHeight: 1.2,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {t(palette.name)}
        </Typography>
      </Box>
    </Box>
  )
}

export const ThemePreviewCards = () => {
  const { colorScheme, themeId, setThemeId } = useThemeContext()
  const { startTransition } = useViewTransition()

  const handleSelect = useCallback(
    (e: MouseEvent, id: string) => {
      if (id === themeId) return
      startTransition(e, () => {
        setThemeId(id)
      })
    },
    [themeId, setThemeId, startTransition]
  )

  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: 'repeat(2, 1fr)',
        gap: 1,
        p: 0.5,
      }}
    >
      {themeIds.map((id) => (
        <ThemeCard
          key={id}
          palette={getThemePalette(id, colorScheme)}
          selected={id === themeId}
          onSelect={handleSelect}
        />
      ))}
    </Box>
  )
}

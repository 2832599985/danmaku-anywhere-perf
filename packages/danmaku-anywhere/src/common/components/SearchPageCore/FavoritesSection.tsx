import type { Season } from '@danmaku-anywhere/danmaku-converter'
import { Star } from '@mui/icons-material'
import {
  Box,
  Chip,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  Stack,
  Typography,
} from '@mui/material'
import { useTranslation } from 'react-i18next'
import { localizedDanmakuSourceType } from '@/common/danmaku/enums'
import type { FavoriteSeason } from '@/common/hooks/useFavorites'
import { useFavorites } from '@/common/hooks/useFavorites'
import type { ProviderConfig } from '@/common/options/providerConfig/schema'
import { useProviderConfig } from '@/common/options/providerConfig/useProviderConfig'

interface FavoritesSectionProps {
  onFavoriteClick: (
    season: Pick<
      Season,
      'id' | 'title' | 'provider' | 'providerConfigId' | 'imageUrl'
    >,
    provider: ProviderConfig
  ) => void
}

export const FavoritesSection = ({
  onFavoriteClick,
}: FavoritesSectionProps) => {
  const { t } = useTranslation()
  const { favorites } = useFavorites()
  const { configs } = useProviderConfig()

  if (favorites.length === 0) return null

  const handleClick = (fav: FavoriteSeason) => {
    const provider = configs.find((c) => c.id === fav.providerConfigId)
    if (!provider) return

    // Create a minimal season-like object from the favorite data
    const season = {
      id: fav.seasonId,
      title: fav.title,
      provider: fav.provider,
      providerConfigId: fav.providerConfigId,
      imageUrl: fav.imageUrl,
    }

    onFavoriteClick(season, provider)
  }

  return (
    <Stack direction="column" spacing={0.5} sx={{ alignSelf: 'stretch' }}>
      <Stack direction="row" alignItems="center" gap={0.5}>
        <Star fontSize="small" color="warning" />
        <Typography variant="caption" color="text.secondary">
          {t('searchPage.favorites.title')}
        </Typography>
      </Stack>
      <List dense disablePadding>
        {favorites.map((fav) => (
          <ListItem key={fav.seasonId} disablePadding>
            <ListItemButton
              onClick={() => handleClick(fav)}
              dense
              sx={{ borderRadius: 1 }}
            >
              <ListItemText
                primary={fav.title}
                primaryTypographyProps={{
                  noWrap: true,
                  variant: 'body2',
                }}
              />
              <Box ml={1}>
                <Chip
                  label={localizedDanmakuSourceType(fav.provider)}
                  size="small"
                  variant="outlined"
                />
              </Box>
            </ListItemButton>
          </ListItem>
        ))}
      </List>
    </Stack>
  )
}

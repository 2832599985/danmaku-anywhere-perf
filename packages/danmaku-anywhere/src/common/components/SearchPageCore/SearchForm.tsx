import type { CustomSeason, Season } from '@danmaku-anywhere/danmaku-converter'
import { Close, DeleteSweep, Search } from '@mui/icons-material'
import type { TextFieldProps } from '@mui/material'
import {
  Box,
  Button,
  Chip,
  IconButton,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useIsFetching } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SearchMascot } from '@/common/components/SearchPageCore/SearchMascot'
import { useSearchHistory } from '@/common/hooks/useSearchHistory'
import { useExtensionOptions } from '@/common/options/extensionOptions/useExtensionOptions'
import type { ProviderConfig } from '@/common/options/providerConfig/schema'
import { seasonQueryKeys } from '@/common/queries/queryKeys'
import { getTrackingService } from '@/common/telemetry/getTrackingService'
import { toSimplified } from '@/common/utils/utils'
import { withStopPropagation } from '@/common/utils/withStopPropagation'
import { FavoritesSection } from './FavoritesSection'
import { ProviderResultsList } from './ProviderResultsList'

interface SearchFormProps {
  onSearch: (searchTerm: string) => void
  searchTerm: string
  onSearchTermChange: (searchTerm: string) => void
  textFieldProps?: TextFieldProps
  onSeasonClick: (
    season: Season | CustomSeason,
    provider: ProviderConfig
  ) => void
}

export const SearchForm = ({
  onSearch,
  onSearchTermChange,
  searchTerm,
  textFieldProps,
  onSeasonClick,
}: SearchFormProps) => {
  const { t } = useTranslation()

  const { data } = useExtensionOptions()
  const { history, addEntry, removeEntry, clearHistory } = useSearchHistory()

  const isLoading =
    useIsFetching({
      queryKey: seasonQueryKeys.search({ keyword: searchTerm }),
    }) > 0

  const handleKeywordChange = (value: string) => {
    onSearchTermChange(value)
  }

  const [committedSearchTerm, setCommittedSearchTerm] = useState(searchTerm)

  const handleSearch = () => {
    const keyword = data.searchUsingSimplified
      ? toSimplified(searchTerm.trim())
      : searchTerm.trim()

    onSearch(keyword)
    setCommittedSearchTerm(keyword)
    addEntry(keyword)
    getTrackingService().track('search', { keyword })
  }

  const handleHistoryClick = (keyword: string) => {
    onSearchTermChange(keyword)
    onSearch(keyword)
    setCommittedSearchTerm(keyword)
    addEntry(keyword)
    getTrackingService().track('search', { keyword })
  }

  return (
    <Box
      component="form"
      onSubmit={(e) => {
        e.preventDefault()
        handleSearch()
      }}
      m={1}
    >
      <Stack direction="column" spacing={1} alignItems="center">
        <TextField
          value={searchTerm}
          onChange={(e) => handleKeywordChange(e.target.value)}
          placeholder={t('searchPage.searchPlaceholder', 'Search title...')}
          fullWidth
          required
          autoFocus
          size="small"
          {...textFieldProps}
          {...withStopPropagation()}
        />
        <Button
          type="submit"
          loading={isLoading}
          variant="contained"
          disabled={!searchTerm}
          size="small"
          autoCapitalize="none"
          fullWidth
        >
          <Search /> {t('searchPage.search', 'Search')}
        </Button>
        {!committedSearchTerm && history.length > 0 && (
          <Stack direction="column" spacing={0.5} sx={{ alignSelf: 'stretch' }}>
            <Stack
              direction="row"
              alignItems="center"
              justifyContent="space-between"
            >
              <Typography variant="caption" color="text.secondary">
                {t('searchPage.history.title')}
              </Typography>
              <IconButton size="small" onClick={clearHistory}>
                <DeleteSweep fontSize="small" />
              </IconButton>
            </Stack>
            <Stack direction="row" flexWrap="wrap" gap={0.5}>
              {history.map((keyword, index) => (
                <Chip
                  key={`${index}-${keyword}`}
                  label={keyword}
                  size="small"
                  variant="outlined"
                  onClick={() => handleHistoryClick(keyword)}
                  onDelete={() => removeEntry(keyword)}
                  deleteIcon={<Close fontSize="small" />}
                />
              ))}
            </Stack>
          </Stack>
        )}
        {committedSearchTerm ? (
          <ProviderResultsList
            searchTerm={committedSearchTerm}
            onSeasonClick={onSeasonClick}
          />
        ) : (
          <>
            <FavoritesSection onFavoriteClick={onSeasonClick} />
            <SearchMascot />
          </>
        )}
      </Stack>
    </Box>
  )
}

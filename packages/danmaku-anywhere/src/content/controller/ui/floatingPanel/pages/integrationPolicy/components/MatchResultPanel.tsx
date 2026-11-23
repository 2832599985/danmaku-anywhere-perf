import {
  Cancel,
  CheckCircle,
  ManageSearch,
  Refresh,
  SkipNext,
  TravelExplore,
} from '@mui/icons-material'
import {
  Alert,
  Box,
  Button,
  Chip,
  Divider,
  Stack,
  Typography,
} from '@mui/material'
import { useTranslation } from 'react-i18next'
import type { StrategyAttempt } from '@/common/anime/dto'
import { MATCHING_STRATEGY_LABEL } from '@/common/anime/MatchingStrategyType'
import { useMatchEpisode } from '@/content/controller/danmaku/integration/hooks/useMatchEpisode'
import { PopupTab, usePopup } from '@/content/controller/store/popupStore'
import { useStore } from '@/content/controller/store/store'

const StrategyAttemptRow = ({ attempt }: { attempt: StrategyAttempt }) => {
  const { t } = useTranslation()

  return (
    <Stack direction="row" alignItems="center" spacing={1}>
      {attempt.skipped ? (
        <SkipNext fontSize="small" color="disabled" />
      ) : (
        <Cancel fontSize="small" color="error" />
      )}
      <Typography variant="body2" sx={{ fontWeight: 500 }}>
        {MATCHING_STRATEGY_LABEL[attempt.strategy]()}
      </Typography>
      <Chip
        size="small"
        label={
          attempt.skipped
            ? t('integration.matchResult.skipped', 'Skipped')
            : t('integration.matchResult.noMatch', 'No match')
        }
        color={attempt.skipped ? 'default' : 'error'}
        variant="outlined"
        sx={{ height: 20, fontSize: '0.7rem' }}
      />
    </Stack>
  )
}

export const MatchResultPanel = () => {
  const { t } = useTranslation()
  const { matchResult, mediaInfo } = useStore.use.integration()
  const { open, setSearchTitle } = usePopup()
  const matchEpisode = useMatchEpisode()

  if (!matchResult || matchResult.status !== 'notFound') {
    return null
  }

  const { strategyAttempts, cause } = matchResult

  const handleManualSearch = () => {
    if (mediaInfo) {
      setSearchTitle(mediaInfo.title)
    }
    open({ tab: PopupTab.Search })
  }

  const handleRetry = () => {
    if (!mediaInfo) return

    matchEpisode.mutate({
      mapKey: mediaInfo.getKey(),
      title: mediaInfo.title,
      episodeNumber: mediaInfo.episode,
      originalTitle: mediaInfo.originalTitle,
    })
  }

  const handleCreateMapping = () => {
    open({ tab: PopupTab.TitleMapping })
  }

  return (
    <Box>
      <Alert severity="warning" sx={{ mb: 2 }}>
        <Typography variant="body2">
          {t('integration.matchResult.title', 'Episode matching failed')}
        </Typography>
      </Alert>

      {mediaInfo && (
        <Box mb={2}>
          <Typography variant="caption" color="text.secondary">
            {t('integration.matchResult.detectedMedia', 'Detected media')}
          </Typography>
          <Typography variant="body2" sx={{ fontWeight: 500 }}>
            {mediaInfo.toString()}
          </Typography>
        </Box>
      )}

      {strategyAttempts && strategyAttempts.length > 0 && (
        <Box mb={2}>
          <Typography variant="caption" color="text.secondary" gutterBottom>
            {t('integration.matchResult.strategiesTried', 'Strategies tried')}
          </Typography>
          <Stack spacing={0.5} mt={0.5}>
            {strategyAttempts.map((attempt) => (
              <StrategyAttemptRow key={attempt.strategy} attempt={attempt} />
            ))}
          </Stack>
        </Box>
      )}

      {cause && (
        <Box mb={2}>
          <Typography variant="caption" color="text.secondary">
            {t('integration.matchResult.cause', 'Reason')}
          </Typography>
          <Typography variant="body2" color="error.main">
            {t(cause, cause)}
          </Typography>
        </Box>
      )}

      <Divider sx={{ my: 1.5 }} />

      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
        <Button
          variant="contained"
          size="small"
          startIcon={<ManageSearch />}
          onClick={handleManualSearch}
        >
          {t('integration.matchResult.manualSearch', 'Manual Search')}
        </Button>
        <Button
          variant="outlined"
          size="small"
          startIcon={<TravelExplore />}
          onClick={handleCreateMapping}
        >
          {t('integration.matchResult.createMapping', 'Title Mapping')}
        </Button>
        <Button
          variant="outlined"
          size="small"
          startIcon={<Refresh />}
          onClick={handleRetry}
          loading={matchEpisode.isPending}
        >
          {t('integration.matchResult.retry', 'Retry')}
        </Button>
      </Stack>
    </Box>
  )
}

export const MatchSuccessIndicator = () => {
  const { t } = useTranslation()
  const { matchResult } = useStore.use.integration()

  if (!matchResult || matchResult.status !== 'success') {
    return null
  }

  return (
    <Stack direction="row" alignItems="center" spacing={1}>
      <CheckCircle fontSize="small" color="success" />
      <Typography variant="body2" color="success.main">
        {t('integration.matchResult.matched', 'Episode matched successfully')}
      </Typography>
      {'metadata' in matchResult && (
        <Chip
          size="small"
          label={MATCHING_STRATEGY_LABEL[matchResult.metadata.strategy]()}
          color="success"
          variant="outlined"
          sx={{ height: 20, fontSize: '0.7rem' }}
        />
      )}
    </Stack>
  )
}

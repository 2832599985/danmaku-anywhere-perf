import type { Season } from '@danmaku-anywhere/danmaku-converter'
import { Delete } from '@mui/icons-material'
import {
  Alert,
  Box,
  CircularProgress,
  IconButton,
  LinearProgress,
  List,
  ListItem,
  ListItemText,
  Paper,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { useDialog } from '@/common/components/Dialog/dialogStore'
import { useToast } from '@/common/components/Toast/toastStore'
import { episodeQueryKeys, seasonQueryKeys } from '@/common/queries/queryKeys'
import { chromeRpcClient } from '@/common/rpcClient/background/client'
import { OptionsPageToolBar } from '@/popup/component/OptionsPageToolbar'
import { OptionsPageLayout } from '@/popup/layout/OptionsPageLayout'

const formatBytes = (bytes: number): string => {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${(bytes / k ** i).toFixed(1)} ${sizes[i]}`
}

export const StoragePage = () => {
  const { t } = useTranslation()
  const { toast } = useToast()
  const dialog = useDialog()
  const queryClient = useQueryClient()

  // Storage estimate
  const storageQuery = useQuery({
    queryKey: [{ scope: 'storage', kind: 'estimate' }],
    queryFn: async () => {
      const estimate = await navigator.storage.estimate()
      return {
        usage: estimate.usage ?? 0,
        quota: estimate.quota ?? 0,
      }
    },
    staleTime: 1000 * 30,
  })

  // Seasons with episode counts
  const seasonsQuery = useQuery({
    queryKey: seasonQueryKeys.all(),
    queryFn: async () => {
      const res = await chromeRpcClient.seasonGetAll({})
      return res.data
    },
    staleTime: 1000 * 60 * 5,
  })

  const deleteMutation = useMutation({
    mutationFn: async (seasonId: number) => {
      await chromeRpcClient.seasonDelete({ id: seasonId })
    },
    onSuccess: () => {
      toast.success(t('common.deleted', 'Deleted'))
      queryClient.invalidateQueries({ queryKey: seasonQueryKeys.all() })
      queryClient.invalidateQueries({ queryKey: episodeQueryKeys.all() })
      storageQuery.refetch()
    },
  })

  const handleDeleteSeason = (season: Season) => {
    dialog.delete({
      title: t('common.confirmDeleteTitle', 'Confirm delete'),
      content: t(
        'common.confirmDeleteMessage',
        'Are you sure you want to delete "{{name}}"?',
        { name: season.title }
      ),
      onConfirm: () => deleteMutation.mutate(season.id),
    })
  }

  const usagePercent =
    storageQuery.data && storageQuery.data.quota > 0
      ? (storageQuery.data.usage / storageQuery.data.quota) * 100
      : 0

  const isWarning = usagePercent > 80

  // Sort seasons by localEpisodeCount descending (proxy for storage size)
  const sortedSeasons = [...(seasonsQuery.data ?? [])].sort(
    (a, b) => (b.localEpisodeCount ?? 0) - (a.localEpisodeCount ?? 0)
  )

  return (
    <OptionsPageLayout>
      <OptionsPageToolBar title={t('optionsPage.pages.storage', 'Storage')} />
      <Box sx={{ p: 2 }}>
        {/* Storage usage overview */}
        <Paper sx={{ p: 2, mb: 2 }}>
          <Typography variant="h6" gutterBottom>
            {t('optionsPage.storage.overview', 'Storage Overview')}
          </Typography>
          {storageQuery.isLoading ? (
            <CircularProgress size={24} />
          ) : storageQuery.data ? (
            <>
              <Stack
                direction="row"
                justifyContent="space-between"
                sx={{ mb: 1 }}
              >
                <Typography variant="body2" color="text.secondary">
                  {formatBytes(storageQuery.data.usage)} /{' '}
                  {formatBytes(storageQuery.data.quota)}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {usagePercent.toFixed(1)}%
                </Typography>
              </Stack>
              <LinearProgress
                variant="determinate"
                value={Math.min(usagePercent, 100)}
                color={isWarning ? 'warning' : 'primary'}
                sx={{ height: 8, borderRadius: 1 }}
              />
              {isWarning && (
                <Alert severity="warning" sx={{ mt: 1 }}>
                  {t(
                    'optionsPage.storage.warningHigh',
                    'Storage usage is high. Consider cleaning up unused data.'
                  )}
                </Alert>
              )}
            </>
          ) : null}
        </Paper>

        {/* Season list sorted by episode count */}
        <Paper sx={{ p: 2 }}>
          <Typography variant="h6" gutterBottom>
            {t('optionsPage.storage.seasonBreakdown', 'Data by Season')}
          </Typography>
          {seasonsQuery.isLoading ? (
            <CircularProgress size={24} />
          ) : sortedSeasons.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              {t('common.itsEmpty', "There's nothing here...")}
            </Typography>
          ) : (
            <List disablePadding dense>
              {sortedSeasons.map((season) => (
                <ListItem
                  key={season.id}
                  secondaryAction={
                    <Tooltip title={t('common.delete', 'Delete')}>
                      <IconButton
                        edge="end"
                        onClick={() => handleDeleteSeason(season)}
                        disabled={deleteMutation.isPending}
                        size="small"
                      >
                        <Delete fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  }
                  disablePadding
                  sx={{ py: 0.5 }}
                >
                  <ListItemText
                    primary={season.title}
                    secondary={
                      <Stack direction="row" spacing={1} component="span">
                        <Typography
                          variant="caption"
                          component="span"
                          color="text.secondary"
                        >
                          {season.provider}
                        </Typography>
                        <Typography
                          variant="caption"
                          component="span"
                          color="text.secondary"
                        >
                          {t(
                            'danmaku.commentCountedEpisodes',
                            '{{count}} episodes',
                            {
                              count: season.localEpisodeCount ?? 0,
                            }
                          )}
                        </Typography>
                      </Stack>
                    }
                    primaryTypographyProps={{
                      noWrap: true,
                      variant: 'body2',
                    }}
                  />
                </ListItem>
              ))}
            </List>
          )}
        </Paper>
      </Box>
    </OptionsPageLayout>
  )
}

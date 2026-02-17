import { Sync, TuneOutlined } from '@mui/icons-material'
import {
  Box,
  Button,
  Chip,
  Collapse,
  IconButton,
  Toolbar,
  Tooltip,
  Typography,
} from '@mui/material'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { localizedDanmakuSourceType } from '@/common/danmaku/enums'
import {
  getSourceInfoFromEpisodes,
  providerColors,
} from '@/common/danmaku/providerColors'
import { episodeToString } from '@/common/danmaku/utils'
import { useAutoCalibrate } from '@/content/controller/common/hooks/useAutoCalibrate'
import { useLoadDanmaku } from '@/content/controller/common/hooks/useLoadDanmaku'
import { useUnmountDanmaku } from '@/content/controller/common/hooks/useUnmountDanmaku'
import { useStore } from '@/content/controller/store/store'

export const InfoBar = () => {
  const { t } = useTranslation()

  const { isMounted, episodes, comments } = useStore.use.danmaku()

  const hasEpisodes = episodes && episodes.length > 0

  const unmountMutation = useUnmountDanmaku()
  const { refreshComments, canRefresh, loadMutation } = useLoadDanmaku()
  const { calibrateAndApply, isPending: isCalibrating } = useAutoCalibrate()

  const handleUnmount = () => {
    unmountMutation.mutate()
  }

  const { titles, title } = useMemo(() => {
    if (!episodes || episodes.length === 0) {
      return {
        title: '',
        titles: [],
      }
    }
    return {
      title: episodeToString(episodes[0]),
      titles: episodes.map((e) => {
        return <div key={e.id}>{episodeToString(e)}</div>
      }),
    }
  }, [episodes])

  const sourceInfoList = useMemo(
    () => getSourceInfoFromEpisodes(episodes),
    [episodes]
  )

  const hasMultipleSources = sourceInfoList.length > 1

  return (
    <Collapse in={isMounted} unmountOnExit>
      {hasEpisodes && (
        <>
          <Toolbar
            variant="dense"
            sx={{
              pl: { sm: 2 },
              pr: { xs: 1, sm: 1 },
              backgroundColor: 'background.paper',
              gap: 1,
              justifyContent: 'space-between',
            }}
          >
            <Box display="flex" minWidth={0}>
              <Tooltip title={titles}>
                <Typography noWrap>{title}</Typography>
              </Tooltip>
              <Typography
                sx={{ color: 'text.secondary', pl: 0.5, flexShrink: 0 }}
              >
                ({comments.length})
              </Typography>
            </Box>
            <Box flexShrink={0}>
              <Tooltip
                title={t(
                  'autoOffset.calibrateTooltip',
                  'Auto-calibrate danmaku offset'
                )}
              >
                <IconButton
                  onClick={calibrateAndApply}
                  disabled={isCalibrating}
                  color="primary"
                  size="small"
                >
                  <TuneOutlined fontSize="small" />
                </IconButton>
              </Tooltip>
              {canRefresh && (
                <Tooltip title={t('danmaku.refresh', 'Refresh Danmaku')}>
                  <IconButton
                    onClick={refreshComments}
                    disabled={!canRefresh || loadMutation.isPending}
                    color="primary"
                  >
                    <Sync />
                  </IconButton>
                </Tooltip>
              )}
              <Button
                variant="outlined"
                type="button"
                onClick={handleUnmount}
                color="warning"
                disabled={!isMounted}
                sx={{ flexShrink: 0 }}
              >
                {t('danmaku.unmount', 'Unmount')}
              </Button>
            </Box>
          </Toolbar>
          {hasMultipleSources && (
            <Box
              sx={{
                display: 'flex',
                gap: 0.5,
                px: 2,
                py: 0.5,
                flexWrap: 'wrap',
                backgroundColor: 'background.paper',
              }}
            >
              {sourceInfoList.map(({ provider, count }) => (
                <Chip
                  key={provider}
                  label={`${localizedDanmakuSourceType(provider)} (${count})`}
                  size="small"
                  variant="filled"
                  sx={{
                    borderColor: providerColors[provider],
                    backgroundColor: `${providerColors[provider]}20`,
                    '& .MuiChip-label': {
                      fontSize: '0.75rem',
                    },
                  }}
                />
              ))}
            </Box>
          )}
        </>
      )}
    </Collapse>
  )
}

import {
  Box,
  Card,
  CardContent,
  CircularProgress,
  Stack,
  Typography,
} from '@mui/material'
import { useTranslation } from 'react-i18next'
import { TabLayout } from '@/common/components/layout/TabLayout'
import { TabToolbar } from '@/common/components/layout/TabToolbar'
import { DensityChart } from './DensityChart'
import { KeywordBarChart } from './KeywordBarChart'
import { PieChart } from './PieChart'
import { useStats } from './useStats'

const StatCard = ({
  label,
  value,
}: {
  label: string
  value: string | number
}) => (
  <Card
    variant="outlined"
    sx={{
      flex: '1 1 0',
      minWidth: 80,
    }}
  >
    <CardContent sx={{ py: 1.5, px: 2, '&:last-child': { pb: 1.5 } }}>
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
      <Typography variant="h6" fontWeight={700}>
        {value}
      </Typography>
    </CardContent>
  </Card>
)

const PieLegend = ({
  items,
}: {
  items: { label: string; color: string; value: number }[]
}) => {
  const total = items.reduce((s, i) => s + i.value, 0)
  if (total === 0) return null
  return (
    <Stack spacing={0.5}>
      {items
        .filter((i) => i.value > 0)
        .map((item) => (
          <Stack
            key={item.label}
            direction="row"
            alignItems="center"
            spacing={1}
          >
            <Box
              sx={{
                width: 10,
                height: 10,
                borderRadius: '50%',
                backgroundColor: item.color,
                flexShrink: 0,
              }}
            />
            <Typography variant="caption" color="text.secondary">
              {item.label}
            </Typography>
            <Typography variant="caption" color="text.primary" fontWeight={600}>
              {item.value}
            </Typography>
          </Stack>
        ))}
    </Stack>
  )
}

export const StatsPage = () => {
  const { t } = useTranslation()
  const { isLoading, isComputing, stats } = useStats()

  const loading = isLoading || isComputing

  const modeLabels = {
    rtl: t('statsPage.modeRtl'),
    top: t('statsPage.modeTop'),
    bottom: t('statsPage.modeBottom'),
    ltr: t('statsPage.modeLtr'),
  }

  const pieColors = [
    'var(--da-pie-0, #8b5cf6)',
    'var(--da-pie-1, #d946ef)',
    'var(--da-pie-2, #06b6d4)',
    'var(--da-pie-3, #f59e0b)',
  ]

  return (
    <TabLayout>
      <TabToolbar title={t('statsPage.title')} />
      <Box sx={{ p: 2, overflow: 'auto' }}>
        {loading && (
          <Stack alignItems="center" justifyContent="center" py={6}>
            <CircularProgress size={32} />
          </Stack>
        )}
        {!loading && (!stats || stats.totalComments === 0) && (
          <Stack alignItems="center" justifyContent="center" py={6}>
            <Typography color="text.secondary">
              {t('statsPage.noData')}
            </Typography>
          </Stack>
        )}
        {!loading && stats && stats.totalComments > 0 && (
          <Stack spacing={2}>
            {/* Overview cards */}
            <Stack direction="row" spacing={1} flexWrap="wrap">
              <StatCard
                label={t('statsPage.totalCount')}
                value={stats.totalComments.toLocaleString()}
              />
              <StatCard
                label={t('statsPage.seasonCount', 'Seasons')}
                value={stats.seasonCount}
              />
              <StatCard
                label={t('statsPage.episodeCount', 'Episodes')}
                value={stats.episodeCount}
              />
            </Stack>

            {/* Secondary stats */}
            <Stack direction="row" spacing={1}>
              <StatCard
                label={t('statsPage.avgLength')}
                value={`${stats.avgLength.toFixed(1)} ${t('statsPage.chars', 'chars')}`}
              />
              <StatCard
                label={t('statsPage.peakTime')}
                value={stats.peakTime}
              />
            </Stack>

            {/* Type distribution */}
            <Card variant="outlined">
              <CardContent>
                <Typography variant="subtitle2" gutterBottom>
                  {t('statsPage.typeDistribution')}
                </Typography>
                <Stack direction="row" alignItems="center" spacing={2}>
                  <PieChart
                    data={stats.typeDistribution}
                    labels={modeLabels}
                    size={120}
                  />
                  <PieLegend
                    items={[
                      {
                        label: modeLabels.rtl,
                        color: pieColors[0],
                        value: stats.typeDistribution.rtl,
                      },
                      {
                        label: modeLabels.top,
                        color: pieColors[1],
                        value: stats.typeDistribution.top,
                      },
                      {
                        label: modeLabels.bottom,
                        color: pieColors[2],
                        value: stats.typeDistribution.bottom,
                      },
                      {
                        label: modeLabels.ltr,
                        color: pieColors[3],
                        value: stats.typeDistribution.ltr,
                      },
                    ]}
                  />
                </Stack>
              </CardContent>
            </Card>

            {/* Top keywords */}
            {stats.topKeywords.length > 0 && (
              <Card variant="outlined">
                <CardContent>
                  <Typography variant="subtitle2" gutterBottom>
                    {t('statsPage.topKeywords')}
                  </Typography>
                  <KeywordBarChart data={stats.topKeywords} height={220} />
                </CardContent>
              </Card>
            )}

            {/* Density timeline */}
            {stats.densityBins.length > 0 && (
              <Card variant="outlined">
                <CardContent>
                  <Typography variant="subtitle2" gutterBottom>
                    {t('statsPage.densityTimeline')}
                  </Typography>
                  <DensityChart data={stats.densityBins} height={80} />
                </CardContent>
              </Card>
            )}
          </Stack>
        )}
      </Box>
    </TabLayout>
  )
}

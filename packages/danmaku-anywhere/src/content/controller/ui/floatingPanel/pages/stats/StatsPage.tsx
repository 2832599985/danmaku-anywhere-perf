import {
  Box,
  Chip,
  Divider,
  LinearProgress,
  Stack,
  Typography,
} from '@mui/material'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { ScrollBox } from '@/common/components/layout/ScrollBox'
import { TabLayout } from '@/common/components/layout/TabLayout'
import { TabToolbar } from '@/common/components/layout/TabToolbar'
import { NothingHere } from '@/common/components/NothingHere'
import { useStore } from '@/content/controller/store/store'
import { computeStats } from './computeStats'

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

const DensityChart = ({
  buckets,
}: {
  buckets: { time: number; count: number }[]
}) => {
  const maxCount = useMemo(
    () => buckets.reduce((max, b) => Math.max(max, b.count), 1),
    [buckets]
  )

  if (buckets.length === 0) return null

  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'flex-end',
        gap: '1px',
        height: 80,
        width: '100%',
        overflow: 'hidden',
      }}
    >
      {buckets.map((bucket) => {
        const heightPercent = (bucket.count / maxCount) * 100
        return (
          <Box
            key={bucket.time}
            title={`${formatTime(bucket.time)}: ${bucket.count}`}
            sx={{
              flex: 1,
              minWidth: 2,
              maxWidth: 12,
              height: `${heightPercent}%`,
              minHeight: 1,
              background:
                'linear-gradient(to top, rgba(139, 92, 246, 0.6), rgba(217, 70, 239, 0.6))',
              borderRadius: '2px 2px 0 0',
              transition: 'opacity 0.2s',
              '&:hover': {
                opacity: 0.8,
              },
            }}
          />
        )
      })}
    </Box>
  )
}

const TypeDistributionBar = ({
  items,
  total,
}: {
  items: { mode: string; count: number }[]
  total: number
}) => {
  const { t } = useTranslation()

  if (items.length === 0 || total === 0) return null

  const modeI18nMap: Record<string, string> = {
    RTL: t('statsPage.modeRtl', 'Scroll'),
    LTR: t('statsPage.modeLtr', 'Reverse'),
    Top: t('statsPage.modeTop', 'Top'),
    Bottom: t('statsPage.modeBottom', 'Bottom'),
  }

  return (
    <Stack spacing={1}>
      {items.map(({ mode, count }) => {
        const percent = Math.round((count / total) * 100)
        return (
          <Box key={mode}>
            <Box
              display="flex"
              justifyContent="space-between"
              alignItems="center"
              mb={0.5}
            >
              <Typography variant="body2" color="text.secondary">
                {modeI18nMap[mode] ?? mode}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {count} ({percent}%)
              </Typography>
            </Box>
            <LinearProgress
              variant="determinate"
              value={percent}
              sx={{
                height: 6,
                borderRadius: 3,
                backgroundColor: 'rgba(139, 92, 246, 0.15)',
                '& .MuiLinearProgress-bar': {
                  borderRadius: 3,
                  background: 'linear-gradient(90deg, #8b5cf6, #d946ef)',
                },
              }}
            />
          </Box>
        )
      })}
    </Stack>
  )
}

const StatCard = ({
  label,
  value,
}: {
  label: string
  value: string | number
}) => (
  <Box
    sx={{
      flex: '1 1 0',
      minWidth: 100,
      p: 1.5,
      borderRadius: 2,
      backgroundColor: 'rgba(139, 92, 246, 0.08)',
      border: '1px solid rgba(139, 92, 246, 0.15)',
      textAlign: 'center',
    }}
  >
    <Typography variant="h6" fontSize={20} fontWeight={600}>
      {value}
    </Typography>
    <Typography variant="caption" color="text.secondary">
      {label}
    </Typography>
  </Box>
)

export const StatsPage = () => {
  const { t } = useTranslation()
  const { comments, episodes } = useStore.use.danmaku()

  const stats = useMemo(() => computeStats(comments), [comments])

  if (!episodes || comments.length === 0) {
    return (
      <TabLayout>
        <TabToolbar title={t('statsPage.title', 'Statistics')} />
        <Divider />
        <NothingHere
          message={t('statsPage.noData', 'Mount danmaku to see statistics')}
          size={200}
        />
      </TabLayout>
    )
  }

  return (
    <TabLayout>
      <TabToolbar title={t('statsPage.title', 'Statistics')} />
      <Divider />
      <ScrollBox px={2} pb={2} pt={1} flexGrow={1} sx={{ overflowX: 'hidden' }}>
        <Stack spacing={2}>
          {/* Overview Cards */}
          <Box display="flex" gap={1} flexWrap="wrap">
            <StatCard
              label={t('statsPage.totalCount', 'Total')}
              value={stats.totalCount.toLocaleString()}
            />
            <StatCard
              label={t('statsPage.avgLength', 'Avg Length')}
              value={stats.avgLength}
            />
            {stats.peakDensity && (
              <StatCard
                label={t('statsPage.peakTime', 'Peak Time')}
                value={formatTime(stats.peakDensity.time)}
              />
            )}
          </Box>

          {/* Density Timeline */}
          {stats.densityBuckets.length > 0 && (
            <Box>
              <Typography
                variant="subtitle2"
                color="text.secondary"
                gutterBottom
              >
                {t('statsPage.densityTimeline', 'Density Timeline')}
              </Typography>
              <Box
                sx={{
                  p: 1.5,
                  borderRadius: 2,
                  backgroundColor: 'rgba(139, 92, 246, 0.05)',
                  border: '1px solid rgba(139, 92, 246, 0.1)',
                }}
              >
                <DensityChart buckets={stats.densityBuckets} />
                <Box display="flex" justifyContent="space-between" mt={0.5}>
                  <Typography variant="caption" color="text.secondary">
                    {formatTime(stats.densityBuckets[0].time)}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {formatTime(
                      stats.densityBuckets[stats.densityBuckets.length - 1].time
                    )}
                  </Typography>
                </Box>
              </Box>
            </Box>
          )}

          {/* Type Distribution */}
          {stats.typeDistribution.length > 0 && (
            <Box>
              <Typography
                variant="subtitle2"
                color="text.secondary"
                gutterBottom
              >
                {t('statsPage.typeDistribution', 'Type Distribution')}
              </Typography>
              <TypeDistributionBar
                items={stats.typeDistribution}
                total={stats.totalCount}
              />
            </Box>
          )}

          {/* Top Keywords */}
          {stats.topKeywords.length > 0 && (
            <Box>
              <Typography
                variant="subtitle2"
                color="text.secondary"
                gutterBottom
              >
                {t('statsPage.topKeywords', 'Top Keywords')}
              </Typography>
              <Box display="flex" flexWrap="wrap" gap={0.5}>
                {stats.topKeywords.map(({ word, count }) => (
                  <Chip
                    key={word}
                    label={`${word} (${count})`}
                    size="small"
                    variant="outlined"
                    sx={{
                      borderColor: 'rgba(139, 92, 246, 0.3)',
                      color: 'text.secondary',
                      fontSize: 12,
                    }}
                  />
                ))}
              </Box>
            </Box>
          )}
        </Stack>
      </ScrollBox>
    </TabLayout>
  )
}

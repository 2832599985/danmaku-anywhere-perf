import { parseCommentEntityTime } from '@danmaku-anywhere/danmaku-converter'
import { ContentCopy, PlayArrow } from '@mui/icons-material'
import {
  Box,
  Chip,
  Divider,
  IconButton,
  Stack,
  Typography,
} from '@mui/material'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { ScrollBox } from '@/common/components/layout/ScrollBox'
import { TabLayout } from '@/common/components/layout/TabLayout'
import { TabToolbar } from '@/common/components/layout/TabToolbar'
import { NothingHere } from '@/common/components/NothingHere'
import { useToast } from '@/common/components/Toast/toastStore'
import { useThemeContext } from '@/common/theme/Theme'
import { copyToClipboard } from '@/common/utils/copyToClipboard'
import { useStore } from '@/content/controller/store/store'
import { getAdaptiveBinSize } from '@/content/player/densityPlot/adaptiveDensity'
import { computeDensityBins } from '@/content/player/densityPlot/computeDensityBins'
import {
  detectHighlights,
  formatTimestamp,
  type HighlightMoment,
} from '@/content/player/densityPlot/highlightDetector'

function withAlpha(hex: string, alpha: number): string {
  const r = Number.parseInt(hex.slice(1, 3), 16)
  const g = Number.parseInt(hex.slice(3, 5), 16)
  const b = Number.parseInt(hex.slice(5, 7), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

const HighlightCard = ({
  highlight,
  index,
  onJump,
}: {
  highlight: HighlightMoment
  index: number
  onJump: (time: number) => void
}) => {
  const { palette } = useThemeContext()
  const { t } = useTranslation()

  return (
    <Box
      sx={{
        p: 1.5,
        borderRadius: 2,
        backgroundColor: withAlpha(palette.primary, 0.08),
        border: `1px solid ${withAlpha(palette.primary, 0.15)}`,
        cursor: 'pointer',
        transition: 'background-color 0.2s',
        '&:hover': {
          backgroundColor: withAlpha(palette.primary, 0.15),
        },
      }}
      onClick={() => onJump(highlight.time)}
    >
      <Box display="flex" alignItems="center" justifyContent="space-between">
        <Box display="flex" alignItems="center" gap={1}>
          <Chip
            label={`#${index + 1}`}
            size="small"
            sx={{
              backgroundColor: withAlpha(palette.secondary, 0.2),
              color: palette.secondary,
              fontWeight: 600,
              fontSize: 11,
            }}
          />
          <Typography variant="body2" fontWeight={600}>
            {formatTimestamp(highlight.time)}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {t('highlights.count', { count: highlight.peakCount })}
          </Typography>
        </Box>
        <IconButton
          size="small"
          onClick={(e) => {
            e.stopPropagation()
            onJump(highlight.time)
          }}
        >
          <PlayArrow fontSize="small" />
        </IconButton>
      </Box>
      {highlight.topComments.length > 0 && (
        <Box display="flex" flexWrap="wrap" gap={0.5} mt={1}>
          {highlight.topComments.map((comment) => (
            <Chip
              key={comment}
              label={comment}
              size="small"
              variant="outlined"
              sx={{
                borderColor: withAlpha(palette.primary, 0.3),
                color: 'text.secondary',
                fontSize: 11,
                maxWidth: 200,
              }}
            />
          ))}
        </Box>
      )}
    </Box>
  )
}

export const HighlightsPage = () => {
  const { t } = useTranslation()
  const { comments } = useStore.use.danmaku()
  const toast = useToast()

  const highlights = useMemo(() => {
    if (comments.length === 0) return []
    // Estimate duration from max comment time
    let maxTime = 0
    for (const c of comments) {
      const t = parseCommentEntityTime(c.p)
      if (t > maxTime) maxTime = t
    }
    const duration = maxTime + 30
    const binSize = getAdaptiveBinSize(duration)
    const bins = computeDensityBins(comments, duration, binSize)
    return detectHighlights(bins, comments)
  }, [comments])

  const handleJump = (time: number) => {
    useStore.getState().danmaku.seekToTime(time)
  }

  const handleShare = () => {
    const text = highlights
      .map(
        (h, i) =>
          `#${i + 1} ${formatTimestamp(h.time)} - ${h.topComments[0] ?? ''}`
      )
      .join('\n')
    copyToClipboard(text)
    toast.toast.success(t('highlights.copied'))
  }

  if (comments.length === 0) {
    return (
      <TabLayout>
        <TabToolbar title={t('highlights.title')} />
        <Divider />
        <NothingHere message={t('highlights.noData')} size={200} />
      </TabLayout>
    )
  }

  return (
    <TabLayout>
      <TabToolbar
        title={t('highlights.title')}
        rightElement={
          highlights.length > 0 ? (
            <IconButton
              size="small"
              onClick={handleShare}
              title={t('highlights.share')}
            >
              <ContentCopy fontSize="small" />
            </IconButton>
          ) : undefined
        }
      />
      <Divider />
      <ScrollBox px={2} pb={2} pt={1} flexGrow={1} sx={{ overflowX: 'hidden' }}>
        <Stack spacing={1}>
          {highlights.length === 0 ? (
            <Typography
              variant="body2"
              color="text.secondary"
              textAlign="center"
              py={4}
            >
              {t('highlights.noData')}
            </Typography>
          ) : (
            highlights.map((h, i) => (
              <HighlightCard
                key={h.time}
                highlight={h}
                index={i}
                onJump={handleJump}
              />
            ))
          )}
        </Stack>
      </ScrollBox>
    </TabLayout>
  )
}

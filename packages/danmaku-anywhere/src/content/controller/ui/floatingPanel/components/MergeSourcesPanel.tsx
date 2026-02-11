import { ExpandLess, ExpandMore, MergeType } from '@mui/icons-material'
import {
  Box,
  Chip,
  Collapse,
  IconButton,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { DanmakuSource } from '@/content/controller/store/store'
import { useStore } from '@/content/controller/store/store'

const SourceItem = ({ source }: { source: DanmakuSource }) => {
  return (
    <Box
      display="flex"
      justifyContent="space-between"
      alignItems="center"
      px={1}
      py={0.5}
    >
      <Typography
        variant="body2"
        color="text.secondary"
        noWrap
        sx={{ minWidth: 0, flex: 1, mr: 1 }}
      >
        {source.label}
      </Typography>
      <Chip
        label={source.commentCount.toLocaleString()}
        size="small"
        variant="outlined"
        sx={{
          flexShrink: 0,
          borderColor: 'rgba(139, 92, 246, 0.3)',
          color: 'text.secondary',
          fontSize: 11,
          height: 20,
        }}
      />
    </Box>
  )
}

export const MergeSourcesPanel = () => {
  const { t } = useTranslation()
  const { sources, comments } = useStore.use.danmaku()
  const [expanded, setExpanded] = useState(false)

  // Only show when there are multiple merged sources
  if (sources.length <= 1) return null

  return (
    <Box
      sx={{
        backgroundColor: 'rgba(139, 92, 246, 0.05)',
        borderBottom: '1px solid',
        borderColor: 'divider',
      }}
    >
      <Box
        display="flex"
        alignItems="center"
        px={1}
        py={0.25}
        sx={{ cursor: 'pointer' }}
        onClick={() => setExpanded((prev) => !prev)}
      >
        <Tooltip
          title={t('danmaku.merge.sourceCount', {
            count: sources.length,
          })}
        >
          <MergeType
            fontSize="small"
            sx={{ color: 'rgba(139, 92, 246, 0.7)', mr: 0.5 }}
          />
        </Tooltip>
        <Typography variant="caption" color="text.secondary" sx={{ flex: 1 }}>
          {t('danmaku.merge.sources')} ({sources.length})
        </Typography>
        <Typography variant="caption" color="text.secondary" sx={{ mr: 0.5 }}>
          {t('danmaku.merge.totalMerged', {
            count: comments.length,
          })}
        </Typography>
        <IconButton size="small" sx={{ p: 0 }}>
          {expanded ? (
            <ExpandLess fontSize="small" />
          ) : (
            <ExpandMore fontSize="small" />
          )}
        </IconButton>
      </Box>
      <Collapse in={expanded} unmountOnExit>
        <Stack spacing={0} pb={0.5}>
          {sources.map((source, index) => (
            <SourceItem key={`${source.label}-${index}`} source={source} />
          ))}
        </Stack>
      </Collapse>
    </Box>
  )
}

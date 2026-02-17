import type {
  CommentEntity,
  GenericEpisode,
} from '@danmaku-anywhere/danmaku-converter'
import {
  type DanmakuSourceType,
  parseCommentEntityTime,
} from '@danmaku-anywhere/danmaku-converter'
import { ContentCopy, FilterList, Sync } from '@mui/icons-material'
import {
  Box,
  Chip,
  CircularProgress,
  IconButton,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TableSortLabel,
  Toolbar,
  Tooltip,
  Typography,
} from '@mui/material'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useCallback, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { match } from 'ts-pattern'
import { FilterButton } from '@/common/components/FilterButton'
import { localizedDanmakuSourceType } from '@/common/danmaku/enums'
import {
  buildCommentProviderMap,
  getCommentProvider,
  getSourceInfoFromEpisodes,
  providerColors,
} from '@/common/danmaku/providerColors'
import { ScrollBox } from './layout/ScrollBox'

interface CommentListProps {
  comments: CommentEntity[]
  episodes?: GenericEpisode[]
  isTimeClickable?: boolean
  onTimeClick?: (time: number) => void
  onFilterComment?: (comment: string) => void
  onRefresh?: () => void
  showRefresh?: boolean
  isRefreshing?: boolean
}

const formatTime = (seconds: number) => {
  if (!Number.isFinite(seconds)) {
    return '--:--'
  }
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = Math.floor(seconds % 60)

  return `${String(minutes).padStart(2, '0')}:${String(
    remainingSeconds
  ).padStart(2, '0')}`
}

export const CommentsTable = ({
  comments,
  episodes,
  isTimeClickable,
  onFilterComment,
  onTimeClick,
  onRefresh,
  isRefreshing,
  showRefresh,
}: CommentListProps) => {
  const { t } = useTranslation()

  const headerCells = useMemo(
    () =>
      [
        { id: 'time', label: t('common.time', 'Time'), width: 56 },
        { id: 'comment', label: t('danmaku.commentContent', 'Comment') },
      ] satisfies { id: 'time' | 'comment'; label: string; width?: number }[],
    [t]
  )

  const [orderBy, setOrderBy] = useState<'time' | 'comment'>(headerCells[0].id)
  const [order, setOrder] = useState<'asc' | 'desc'>('asc')
  const [hoverRow, setHoverRow] = useState<number>()
  const [filter, setFilter] = useState('')
  const [hiddenSources, setHiddenSources] = useState<Set<DanmakuSourceType>>(
    new Set()
  )

  const sourceInfoList = useMemo(
    () => getSourceInfoFromEpisodes(episodes),
    [episodes]
  )

  const commentProviderMap = useMemo(
    () => buildCommentProviderMap(comments, episodes),
    [comments, episodes]
  )

  const hasMultipleSources = sourceInfoList.length > 1

  const toggleSource = useCallback((provider: DanmakuSourceType) => {
    setHiddenSources((prev) => {
      const next = new Set(prev)
      if (next.has(provider)) {
        next.delete(provider)
      } else {
        next.add(provider)
      }
      return next
    })
  }, [])

  const filteredComments = useMemo(() => {
    const keyword = filter.trim().toLowerCase()
    let result = comments

    // Apply source filter
    if (hiddenSources.size > 0 && commentProviderMap.size > 0) {
      result = result.filter((c) => {
        const provider = getCommentProvider(c, commentProviderMap)
        return provider === undefined || !hiddenSources.has(provider)
      })
    }

    // Apply text filter
    if (keyword) {
      result = result.filter((c) => c.m.toLowerCase().includes(keyword))
    }

    return result
  }, [comments, filter, hiddenSources, commentProviderMap])

  const sortedComments = useMemo(() => {
    return match(orderBy)
      .with('comment', () => {
        return filteredComments.toSorted((a, b) => {
          return order === 'asc'
            ? a.m.localeCompare(b.m)
            : b.m.localeCompare(a.m)
        })
      })
      .with('time', () => {
        return filteredComments.toSorted((a, b) => {
          const aTime = parseCommentEntityTime(a.p)
          const bTime = parseCommentEntityTime(b.p)
          const invalidValue =
            order === 'asc'
              ? Number.POSITIVE_INFINITY
              : Number.NEGATIVE_INFINITY
          const aValue = Number.isFinite(aTime) ? aTime : invalidValue
          const bValue = Number.isFinite(bTime) ? bTime : invalidValue

          return order === 'asc' ? aValue - bValue : bValue - aValue
        })
      })
      .exhaustive()
  }, [filteredComments, orderBy, order])

  const ref = useRef<HTMLTableSectionElement>(null)

  const virtualizer = useVirtualizer({
    count: sortedComments.length,
    getScrollElement: () => ref.current,
    estimateSize: () => 32,
  })

  const renderSourceChips = () => {
    if (!hasMultipleSources) return null

    return (
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
        {sourceInfoList.map(({ provider, count }) => {
          const isHidden = hiddenSources.has(provider)
          return (
            <Chip
              key={provider}
              label={`${localizedDanmakuSourceType(provider)} (${count})`}
              size="small"
              variant={isHidden ? 'outlined' : 'filled'}
              onClick={() => toggleSource(provider)}
              sx={{
                borderColor: providerColors[provider],
                backgroundColor: isHidden
                  ? 'transparent'
                  : `${providerColors[provider]}20`,
                color: isHidden ? 'text.disabled' : 'text.primary',
                '&:hover': {
                  backgroundColor: isHidden
                    ? `${providerColors[provider]}10`
                    : `${providerColors[provider]}30`,
                },
                '& .MuiChip-label': {
                  fontSize: '0.75rem',
                },
              }}
            />
          )
        })}
      </Box>
    )
  }

  const renderToolbar = () => {
    return (
      <Toolbar
        variant="dense"
        sx={{
          pl: { sm: 2 },
          pr: { xs: 1, sm: 1 },
          minHeight: 32,
          backgroundColor: 'background.paper',
          gap: 1,
          justifyContent: 'space-between',
        }}
      >
        <Typography variant="h6" sx={{ flexGrow: 1 }}>
          {t('danmaku.commentCounted', {
            count:
              filter.trim() || hiddenSources.size > 0
                ? filteredComments.length
                : comments.length,
          })}
        </Typography>
        <FilterButton filter={filter} onChange={setFilter} />
        {showRefresh && (
          <Tooltip title={t('danmaku.refresh', 'Refresh Danmaku')}>
            <IconButton
              color="primary"
              onClick={onRefresh}
              disabled={isRefreshing}
            >
              {isRefreshing ? <CircularProgress size={24} /> : <Sync />}
            </IconButton>
          </Tooltip>
        )}
      </Toolbar>
    )
  }

  return (
    <Box flex={1} display="flex" flexDirection="column" overflow="hidden">
      {renderToolbar()}
      {renderSourceChips()}
      <TableContainer component={ScrollBox} flex={1} overflow="auto" ref={ref}>
        <Table size="small" stickyHeader>
          <TableHead>
            <TableRow>
              {headerCells.map((cell) => (
                <TableCell key={cell.id} width={cell.width}>
                  <TableSortLabel
                    active={orderBy === cell.id}
                    direction={orderBy === cell.id ? order : 'asc'}
                    onClick={() => {
                      if (orderBy !== cell.id) {
                        setOrderBy(cell.id)
                        setOrder('asc')
                      } else {
                        setOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'))
                      }
                    }}
                  >
                    {cell.label}
                  </TableSortLabel>
                </TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody
            sx={{
              height: `${virtualizer.getTotalSize()}px`,
              position: 'relative',
              width: '100%',
            }}
          >
            {sortedComments.length === 0 && (
              <TableRow>
                <TableCell colSpan={2} align="center">
                  {t('danmaku.noComments', 'No comments')}
                </TableCell>
              </TableRow>
            )}
            {virtualizer.getVirtualItems().map((virtualItem) => {
              const comment = sortedComments[virtualItem.index]
              const time = parseCommentEntityTime(comment.p)
              const timeValid = Number.isFinite(time)
              const isHovering = hoverRow === virtualItem.index
              const provider = getCommentProvider(comment, commentProviderMap)
              const dotColor = provider ? providerColors[provider] : undefined

              return (
                <TableRow
                  key={virtualItem.key}
                  data-index={virtualItem.index}
                  ref={virtualizer.measureElement}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    transform: `translateY(${virtualItem.start}px)`,
                    display: 'flex',
                    height: 32,
                  }}
                  onMouseOver={() => setHoverRow(virtualItem.index)}
                >
                  <TableCell
                    width={56}
                    style={{
                      flexShrink: 0,
                    }}
                    sx={{
                      color:
                        isTimeClickable && timeValid && isHovering
                          ? 'primary.main'
                          : 'text.primary',
                    }}
                    onClick={() => {
                      if (!timeValid) return
                      onTimeClick?.(time)
                    }}
                  >
                    <span
                      style={{
                        cursor:
                          isTimeClickable && timeValid && isHovering
                            ? 'pointer'
                            : 'unset',
                      }}
                    >
                      {formatTime(time)}
                    </span>
                  </TableCell>
                  <TableCell
                    style={{
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      flexGrow: 1,
                      display: 'flex',
                      alignItems: 'center',
                    }}
                    title={comment.m}
                  >
                    {dotColor && (
                      <Box
                        component="span"
                        sx={{
                          width: 6,
                          height: 6,
                          borderRadius: '50%',
                          backgroundColor: dotColor,
                          flexShrink: 0,
                          mr: 0.75,
                        }}
                      />
                    )}
                    <Typography
                      variant="body2"
                      sx={{
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                      title={comment.m}
                      flexGrow={1}
                    >
                      {comment.m}
                    </Typography>
                    {isHovering && (
                      <Stack direction="row" spacing={0.5}>
                        <Tooltip title={t('common.copy', 'Copy')}>
                          <IconButton
                            size="small"
                            onClick={() =>
                              navigator.clipboard.writeText(comment.m)
                            }
                          >
                            <ContentCopy fontSize="small" />
                          </IconButton>
                        </Tooltip>
                        {onFilterComment && (
                          <Tooltip title={t('common.filter', 'Filter')}>
                            <IconButton
                              size="small"
                              onClick={() => onFilterComment(comment.m)}
                            >
                              <FilterList fontSize="small" />
                            </IconButton>
                          </Tooltip>
                        )}
                      </Stack>
                    )}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  )
}

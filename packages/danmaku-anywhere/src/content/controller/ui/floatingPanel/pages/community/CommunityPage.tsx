import { DeleteOutline, Refresh, Send } from '@mui/icons-material'
import {
  Box,
  CircularProgress,
  Divider,
  IconButton,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  type CommunityCommentDto,
  communityCommentToEntity,
  deleteCommunityComment,
  deriveEpisodeTarget,
  fetchCommunityComments,
  getAuthBearerToken,
  sendCommunityComment,
} from '@/common/community/communityApi'
import { ScrollBox } from '@/common/components/layout/ScrollBox'
import { TabLayout } from '@/common/components/layout/TabLayout'
import { TabToolbar } from '@/common/components/layout/TabToolbar'
import { NothingHere } from '@/common/components/NothingHere'
import { useToast } from '@/common/components/Toast/toastStore'
import { useAuthSession } from '@/common/hooks/user/useAuthSession'
import { playerRpcClient } from '@/common/rpcClient/background/client'
import { useThemeContext } from '@/common/theme/Theme'
import { mergeComments } from '@/common/utils/utils'
import { useStore } from '@/content/controller/store/store'

function withAlpha(hex: string, alpha: number): string {
  const r = Number.parseInt(hex.slice(1, 3), 16)
  const g = Number.parseInt(hex.slice(3, 5), 16)
  const b = Number.parseInt(hex.slice(5, 7), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

function formatSec(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds))
  const m = Math.floor(safe / 60)
  const s = safe % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

export const CommunityPage = () => {
  const { t } = useTranslation()
  const { palette } = useThemeContext()
  const toast = useToast()
  const { data: authSession } = useAuthSession()

  const episodes = useStore.use.danmaku().episodes
  const mediaInfo = useStore.use.integration().mediaInfo
  const target = useMemo(
    () => deriveEpisodeTarget(episodes, mediaInfo),
    [episodes, mediaInfo]
  )

  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [sending, setSending] = useState(false)
  const [comments, setComments] = useState<CommunityCommentDto[]>([])

  const syncEntitiesToPlayer = useCallback((items: CommunityCommentDto[]) => {
    if (items.length === 0) return
    const entities = items.map(communityCommentToEntity)
    const state = useStore.getState()
    const merged = mergeComments(state.danmaku.comments, entities)
    useStore.setState((draft) => {
      draft.danmaku.comments = merged
    })
    const activeFrame = state.frame.getActiveFrame()
    if (activeFrame && state.danmaku.isMounted) {
      void playerRpcClient.player['relay:command:mount']({
        frameId: activeFrame.frameId,
        data: merged,
      })
    }
  }, [])

  const loadComments = useCallback(async () => {
    if (!target) {
      setComments([])
      return
    }
    setLoading(true)
    try {
      const list = await fetchCommunityComments(target)
      setComments(list)
      syncEntitiesToPlayer(list)
    } catch {
      toast.toast.error(t('community.loadFailed'))
    } finally {
      setLoading(false)
    }
  }, [target, syncEntitiesToPlayer, toast.toast, t])

  useEffect(() => {
    void loadComments()
  }, [loadComments])

  const handleSend = async () => {
    const content = input.trim()
    if (!content || sending) return
    if (!target) {
      toast.toast.info(t('community.noEpisode'))
      return
    }
    const token = await getAuthBearerToken()
    if (!token) {
      toast.toast.info(t('community.authRequired'))
      return
    }

    setSending(true)
    try {
      let currentTime = 0
      const activeFrame = useStore.getState().frame.getActiveFrame()
      if (activeFrame) {
        const playback = await playerRpcClient.player[
          'relay:command:getPlaybackState'
        ]({
          frameId: activeFrame.frameId,
        }).catch(() => null)
        if (playback?.data && Number.isFinite(playback.data.currentTime)) {
          currentTime = playback.data.currentTime
        }
      }

      const { id } = await sendCommunityComment(
        {
          animeTitle: target.animeTitle,
          episodeKey: target.episodeKey,
          time: currentTime,
          mode: 1,
          color: 16777215,
          content,
        },
        token
      )

      const created: CommunityCommentDto = {
        id,
        userId: authSession?.user.id ?? 'me',
        animeTitle: target.animeTitle,
        episodeKey: target.episodeKey,
        time: currentTime,
        mode: 1,
        color: 16777215,
        content,
        createdAt: new Date().toISOString(),
      }

      setComments((prev) => [...prev, created].sort((a, b) => a.time - b.time))
      syncEntitiesToPlayer([created])

      if (activeFrame) {
        void playerRpcClient.player['relay:command:emitComment']({
          frameId: activeFrame.frameId,
          data: { text: content, color: '#ffffff', mode: 'rtl' },
        })
      }

      setInput('')
      toast.toast.success(t('community.sent'))
    } catch {
      toast.toast.error(t('community.sendFailed'))
    } finally {
      setSending(false)
    }
  }

  const handleDelete = async (id: string) => {
    const token = await getAuthBearerToken()
    if (!token) {
      toast.toast.info(t('community.authRequired'))
      return
    }
    try {
      await deleteCommunityComment(id, token)
      setComments((prev) => prev.filter((item) => item.id !== id))
      toast.toast.success(t('community.deleted'))
    } catch {
      toast.toast.error(t('community.deleteFailed'))
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void handleSend()
    }
  }

  return (
    <TabLayout>
      <TabToolbar title={t('community.title')}>
        {target && (
          <IconButton
            size="small"
            onClick={() => void loadComments()}
            disabled={loading}
            title={t('common.refresh')}
          >
            <Refresh fontSize="small" />
          </IconButton>
        )}
      </TabToolbar>
      <Divider />
      <ScrollBox px={2} pb={1} pt={1} flexGrow={1}>
        {!target ? (
          <NothingHere message={t('community.noEpisode')} size={150} />
        ) : loading ? (
          <Box display="flex" justifyContent="center" py={4}>
            <CircularProgress size={24} />
          </Box>
        ) : comments.length === 0 ? (
          <NothingHere message={t('community.empty')} size={150} />
        ) : (
          <Stack spacing={1}>
            {comments.map((item) => {
              const isOwn =
                Boolean(authSession?.user.id) &&
                authSession?.user.id === item.userId
              return (
                <Box
                  key={item.id}
                  onClick={() => useStore.getState().seekToTime(item.time)}
                  sx={{
                    p: 1,
                    borderRadius: 1.5,
                    cursor: 'pointer',
                    backgroundColor: withAlpha(palette.primary, 0.06),
                    border: `1px solid ${withAlpha(palette.primary, 0.12)}`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 1,
                    '&:hover': {
                      backgroundColor: withAlpha(palette.primary, 0.12),
                    },
                  }}
                >
                  <Box minWidth={0} flex={1}>
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      sx={{ fontFamily: 'monospace', mr: 1 }}
                    >
                      {formatSec(item.time)}
                    </Typography>
                    <Typography
                      variant="body2"
                      component="span"
                      sx={{ wordBreak: 'break-word' }}
                    >
                      {item.content}
                    </Typography>
                  </Box>
                  {isOwn && (
                    <IconButton
                      size="small"
                      onClick={(e) => {
                        e.stopPropagation()
                        void handleDelete(item.id)
                      }}
                      title={t('common.delete')}
                    >
                      <DeleteOutline fontSize="small" />
                    </IconButton>
                  )}
                </Box>
              )
            })}
          </Stack>
        )}
      </ScrollBox>
      <Box
        sx={{
          px: 2,
          pb: 1.5,
          pt: 1,
          borderTop: `1px solid ${withAlpha(palette.primary, 0.15)}`,
        }}
      >
        <Stack direction="row" spacing={1} alignItems="center">
          <TextField
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t('community.inputPlaceholder')}
            size="small"
            disabled={!target || sending}
            fullWidth
            sx={{
              '& .MuiOutlinedInput-root': {
                backgroundColor: withAlpha(palette.primary, 0.05),
              },
            }}
          />
          <IconButton
            size="small"
            onClick={() => void handleSend()}
            disabled={!target || sending || !input.trim()}
            sx={{
              color: palette.primary,
            }}
          >
            <Send fontSize="small" />
          </IconButton>
        </Stack>
      </Box>
    </TabLayout>
  )
}

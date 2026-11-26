import {
  ContentCopy,
  Group,
  LinkOff,
  Send,
  Sync as SyncIcon,
} from '@mui/icons-material'
import {
  Box,
  Button,
  Chip,
  Divider,
  IconButton,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { deriveEpisodeTarget } from '@/common/community/communityApi'
import { ScrollBox } from '@/common/components/layout/ScrollBox'
import { TabLayout } from '@/common/components/layout/TabLayout'
import { TabToolbar } from '@/common/components/layout/TabToolbar'
import { useToast } from '@/common/components/Toast/toastStore'
import { useThemeContext } from '@/common/theme/Theme'
import { copyToClipboard } from '@/common/utils/copyToClipboard'
import { useStore } from '@/content/controller/store/store'
import { useWatchPartySession, watchPartySession } from './watchPartyClient'

function withAlpha(hex: string, alpha: number): string {
  const r = Number.parseInt(hex.slice(1, 3), 16)
  const g = Number.parseInt(hex.slice(3, 5), 16)
  const b = Number.parseInt(hex.slice(5, 7), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

export const WatchPartyPage = () => {
  const { t } = useTranslation()
  const { palette } = useThemeContext()
  const toast = useToast()

  const session = useWatchPartySession()
  const episodes = useStore.use.danmaku().episodes
  const mediaInfo = useStore.use.integration().mediaInfo
  const target = useMemo(
    () => deriveEpisodeTarget(episodes, mediaInfo),
    [episodes, mediaInfo]
  )

  const [roomInput, setRoomInput] = useState('')
  const [chatInput, setChatInput] = useState('')

  const handleCreate = async () => {
    try {
      const animeTitle = target?.animeTitle || document.title || 'Watch Party'
      const episode = target?.episodeKey || '1'
      await watchPartySession.createRoom(animeTitle, episode)
    } catch (e) {
      const code = e instanceof Error ? e.message : ''
      if (code === 'AUTH_REQUIRED') {
        toast.toast.info(t('watchParty.authRequired'))
      } else {
        toast.toast.error(t('watchParty.connectFailed'))
      }
    }
  }

  const handleJoin = async () => {
    if (!roomInput.trim()) return
    try {
      await watchPartySession.joinRoom(roomInput)
      setRoomInput('')
    } catch (e) {
      const code = e instanceof Error ? e.message : ''
      if (code === 'AUTH_REQUIRED') {
        toast.toast.info(t('watchParty.authRequired'))
      } else {
        toast.toast.error(t('watchParty.connectFailed'))
      }
    }
  }

  const handleLeave = () => {
    watchPartySession.leave()
  }

  const handleCopyInvite = () => {
    copyToClipboard(`watchparty:${session.roomId}`)
    toast.toast.success(t('watchParty.copied'))
  }

  const handleSyncPlayback = async () => {
    const ok = await watchPartySession.broadcastSync()
    if (ok) {
      toast.toast.success(t('watchParty.synced'))
    }
  }

  const handleSendRoomDanmaku = () => {
    if (!chatInput.trim()) return
    if (watchPartySession.sendRoomDanmaku(chatInput)) {
      setChatInput('')
    }
  }

  return (
    <TabLayout>
      <TabToolbar title={t('watchParty.title')}>
        {session.connected && (
          <Chip
            icon={<Group />}
            label={t('watchParty.members', { count: session.memberCount })}
            size="small"
            color="success"
            variant="outlined"
          />
        )}
      </TabToolbar>
      <Divider />
      <ScrollBox px={2} pb={2} pt={2} flexGrow={1}>
        {session.connected ? (
          <Stack spacing={2}>
            <Box
              sx={{
                p: 2,
                borderRadius: 2,
                backgroundColor: withAlpha(palette.primary, 0.08),
                border: `1px solid ${withAlpha(palette.primary, 0.15)}`,
                textAlign: 'center',
              }}
            >
              <Chip
                label={t('watchParty.connected')}
                color="success"
                size="small"
                sx={{ mb: 1 }}
              />
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{ wordBreak: 'break-all' }}
              >
                {t('watchParty.roomId')}: {session.roomId}
              </Typography>
              {session.animeTitle && (
                <Typography variant="caption" color="text.secondary">
                  {session.animeTitle} · {session.episode}
                </Typography>
              )}
            </Box>

            <Button
              variant="contained"
              size="small"
              startIcon={<SyncIcon />}
              onClick={() => void handleSyncPlayback()}
              fullWidth
            >
              {t('watchParty.syncProgress')}
            </Button>

            <Stack direction="row" spacing={1} alignItems="center">
              <TextField
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    handleSendRoomDanmaku()
                  }
                }}
                placeholder={t('community.inputPlaceholder')}
                size="small"
                fullWidth
              />
              <IconButton
                size="small"
                onClick={handleSendRoomDanmaku}
                disabled={!chatInput.trim()}
                sx={{ color: palette.primary }}
              >
                <Send fontSize="small" />
              </IconButton>
            </Stack>

            <Box display="flex" gap={1}>
              <Button
                variant="outlined"
                size="small"
                startIcon={<ContentCopy />}
                onClick={handleCopyInvite}
                fullWidth
              >
                {t('watchParty.invite')}
              </Button>
              <Button
                variant="outlined"
                size="small"
                color="error"
                startIcon={<LinkOff />}
                onClick={handleLeave}
                fullWidth
              >
                {t('watchParty.leave')}
              </Button>
            </Box>
          </Stack>
        ) : (
          <Stack spacing={2}>
            <Button
              variant="contained"
              size="small"
              onClick={() => void handleCreate()}
              disabled={session.connecting}
              fullWidth
            >
              {t('watchParty.create')}
            </Button>
            <Divider>
              <Typography variant="caption" color="text.secondary">
                OR
              </Typography>
            </Divider>
            <TextField
              label={t('watchParty.roomId')}
              value={roomInput}
              onChange={(e) => setRoomInput(e.target.value)}
              size="small"
              disabled={session.connecting}
              fullWidth
            />
            <Button
              variant="outlined"
              size="small"
              onClick={() => void handleJoin()}
              disabled={session.connecting || !roomInput.trim()}
              fullWidth
            >
              {t('watchParty.join')}
            </Button>
          </Stack>
        )}
      </ScrollBox>
    </TabLayout>
  )
}

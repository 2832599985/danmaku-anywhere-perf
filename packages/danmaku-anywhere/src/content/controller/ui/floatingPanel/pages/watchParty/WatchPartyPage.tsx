import { ContentCopy, Group, LinkOff } from '@mui/icons-material'
import {
  Box,
  Button,
  Chip,
  Divider,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ScrollBox } from '@/common/components/layout/ScrollBox'
import { TabLayout } from '@/common/components/layout/TabLayout'
import { TabToolbar } from '@/common/components/layout/TabToolbar'
import { useToast } from '@/common/components/Toast/toastStore'
import { useThemeContext } from '@/common/theme/Theme'
import { copyToClipboard } from '@/common/utils/copyToClipboard'

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
  const [roomId, setRoomId] = useState('')
  const [connected, setConnected] = useState(false)
  const [memberCount, setMemberCount] = useState(0)

  const handleCreate = async () => {
    // TODO: Wire to WatchPartyService RPC
    toast.toast.info('Watch party creation coming soon')
  }

  const handleJoin = async () => {
    if (!roomId.trim()) return
    // TODO: Wire to WatchPartyService RPC
    toast.toast.info('Watch party join coming soon')
  }

  const handleLeave = () => {
    setConnected(false)
    setMemberCount(0)
  }

  const handleCopyInvite = () => {
    copyToClipboard(`watchparty:${roomId}`)
    toast.toast.success(t('watchParty.copied'))
  }

  return (
    <TabLayout>
      <TabToolbar
        title={t('watchParty.title')}
        rightElement={
          connected ? (
            <Chip
              icon={<Group />}
              label={t('watchParty.members', { count: memberCount })}
              size="small"
              color="success"
              variant="outlined"
            />
          ) : undefined
        }
      />
      <Divider />
      <ScrollBox px={2} pb={2} pt={2} flexGrow={1}>
        {connected ? (
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
              <Typography variant="body2" color="text.secondary">
                {t('watchParty.roomId')}: {roomId}
              </Typography>
            </Box>
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
              onClick={handleCreate}
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
              value={roomId}
              onChange={(e) => setRoomId(e.target.value)}
              size="small"
              fullWidth
            />
            <Button
              variant="outlined"
              size="small"
              onClick={handleJoin}
              disabled={!roomId.trim()}
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

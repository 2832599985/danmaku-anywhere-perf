import { Send } from '@mui/icons-material'
import { Box, Divider, IconButton, Stack, TextField } from '@mui/material'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ScrollBox } from '@/common/components/layout/ScrollBox'
import { TabLayout } from '@/common/components/layout/TabLayout'
import { TabToolbar } from '@/common/components/layout/TabToolbar'
import { NothingHere } from '@/common/components/NothingHere'
import { useToast } from '@/common/components/Toast/toastStore'
import { useThemeContext } from '@/common/theme/Theme'

function withAlpha(hex: string, alpha: number): string {
  const r = Number.parseInt(hex.slice(1, 3), 16)
  const g = Number.parseInt(hex.slice(3, 5), 16)
  const b = Number.parseInt(hex.slice(5, 7), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

export const CommunityPage = () => {
  const { t } = useTranslation()
  const { palette } = useThemeContext()
  const toast = useToast()
  const [input, setInput] = useState('')

  const handleSend = async () => {
    if (!input.trim()) return
    // TODO: Wire to CommunityService RPC
    toast.toast.info('Community danmaku sending coming soon')
    setInput('')
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <TabLayout>
      <TabToolbar title={t('community.title')} />
      <Divider />
      <ScrollBox px={2} pb={1} pt={1} flexGrow={1}>
        <NothingHere message={t('community.title')} size={150} />
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
            fullWidth
            sx={{
              '& .MuiOutlinedInput-root': {
                backgroundColor: withAlpha(palette.primary, 0.05),
              },
            }}
          />
          <IconButton
            size="small"
            onClick={handleSend}
            disabled={!input.trim()}
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

import {
  CloseRounded,
  ExpandMoreRounded,
  FolderOpenRounded,
  SearchRounded,
  SubtitlesRounded,
} from '@mui/icons-material'
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogContent,
  DialogTitle,
  IconButton,
  InputAdornment,
  List,
  ListItemButton,
  ListItemText,
  Stack,
  Tab,
  Tabs,
  TextField,
  Typography,
} from '@mui/material'
import { useState } from 'react'
import type { DdpAnime, DdpEpisode } from '@/danmaku/ddp'
import { fetchEpisodeComments, searchDanmaku } from '@/danmaku/ddp'
import { usePlayerCommands } from '@/player/commands'
import { usePlayerStore } from '@/store/playerStore'
import { errorMessage } from './shared'

const LocalTab = ({ onDone }: { onDone: () => void }) => {
  const commands = usePlayerCommands()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handlePick = async () => {
    setError(null)
    setLoading(true)
    try {
      await commands.loadDanmakuFromFile()
      onDone()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setLoading(false)
    }
  }

  return (
    <Stack spacing={2} sx={{ pt: 1 }}>
      <Typography variant="body2" color="text.secondary">
        从本地导入弹幕文件（支持 Bilibili XML 与
        JSON）。也可以直接把文件拖入播放器窗口。
      </Typography>
      <Button
        variant="contained"
        startIcon={
          loading ? (
            <CircularProgress size={18} color="inherit" />
          ) : (
            <FolderOpenRounded />
          )
        }
        disabled={loading}
        onClick={handlePick}
        sx={{ alignSelf: 'flex-start', px: 3 }}
      >
        选择弹幕文件 (.xml/.json)
      </Button>
      {error && <Alert severity="error">{error}</Alert>}
    </Stack>
  )
}

const OnlineTab = ({ onDone }: { onDone: () => void }) => {
  const [keyword, setKeyword] = useState('')
  const [searching, setSearching] = useState(false)
  const [results, setResults] = useState<DdpAnime[]>([])
  const [searched, setSearched] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<number | null>(null)
  const [fetchingId, setFetchingId] = useState<number | null>(null)

  const handleSearch = async () => {
    const trimmed = keyword.trim()
    if (!trimmed || searching) return
    setSearching(true)
    setError(null)
    try {
      const animes = await searchDanmaku(trimmed)
      setResults(animes)
      setSearched(true)
      setExpanded(animes.length === 1 ? animes[0].animeId : null)
    } catch (e) {
      setError(errorMessage(e))
      setResults([])
      setSearched(true)
    } finally {
      setSearching(false)
    }
  }

  const handlePickEpisode = async (anime: DdpAnime, ep: DdpEpisode) => {
    if (fetchingId !== null) return
    setFetchingId(ep.episodeId)
    setError(null)
    try {
      const comments = await fetchEpisodeComments(ep.episodeId)
      usePlayerStore.getState().setComments(comments, {
        label: `${anime.animeTitle} ${ep.episodeTitle}`,
        count: comments.length,
      })
      onDone()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setFetchingId(null)
    }
  }

  return (
    <Stack spacing={1.5} sx={{ pt: 1 }}>
      <Stack direction="row" spacing={1}>
        <TextField
          fullWidth
          size="small"
          placeholder="搜索番剧 / Search anime title…"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void handleSearch()
          }}
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <SearchRounded fontSize="small" />
                </InputAdornment>
              ),
            },
          }}
        />
        <Button
          variant="contained"
          onClick={() => void handleSearch()}
          disabled={searching || !keyword.trim()}
          sx={{ px: 3, flexShrink: 0 }}
        >
          {searching ? <CircularProgress size={20} color="inherit" /> : '搜索'}
        </Button>
      </Stack>

      {error && <Alert severity="error">{error}</Alert>}

      {searching && (
        <Stack alignItems="center" sx={{ py: 4 }}>
          <CircularProgress />
        </Stack>
      )}

      {!searching && searched && results.length === 0 && !error && (
        <Typography
          variant="body2"
          color="text.secondary"
          sx={{ py: 4, textAlign: 'center' }}
        >
          未找到相关结果 / No results
        </Typography>
      )}

      {!searching && results.length > 0 && (
        <Box sx={{ maxHeight: 360, overflowY: 'auto', mx: -1, px: 1 }}>
          {results.map((anime) => (
            <Accordion
              key={anime.animeId}
              disableGutters
              expanded={expanded === anime.animeId}
              onChange={(_, isOpen) =>
                setExpanded(isOpen ? anime.animeId : null)
              }
              sx={{ '&:not(:last-child)': { mb: 0.5 } }}
            >
              <AccordionSummary expandIcon={<ExpandMoreRounded />}>
                <Stack
                  direction="row"
                  alignItems="center"
                  spacing={1}
                  sx={{ minWidth: 0 }}
                >
                  <SubtitlesRounded
                    fontSize="small"
                    sx={{ color: 'primary.light', flexShrink: 0 }}
                  />
                  <Typography noWrap sx={{ fontWeight: 600, minWidth: 0 }}>
                    {anime.animeTitle}
                  </Typography>
                  <Chip
                    size="small"
                    label={anime.typeDescription || anime.type}
                    sx={{ flexShrink: 0, height: 20, fontSize: 11 }}
                  />
                </Stack>
              </AccordionSummary>
              <AccordionDetails sx={{ p: 0 }}>
                <List dense disablePadding>
                  {anime.episodes.map((ep) => (
                    <ListItemButton
                      key={ep.episodeId}
                      disabled={fetchingId !== null}
                      onClick={() => void handlePickEpisode(anime, ep)}
                    >
                      <ListItemText primary={ep.episodeTitle} />
                      {fetchingId === ep.episodeId && (
                        <CircularProgress size={16} />
                      )}
                    </ListItemButton>
                  ))}
                </List>
              </AccordionDetails>
            </Accordion>
          ))}
        </Box>
      )}
    </Stack>
  )
}

export const DanmakuSourceDialog = () => {
  const open = usePlayerStore((s) => s.danmakuDialogOpen)
  const setDanmakuDialogOpen = usePlayerStore((s) => s.setDanmakuDialogOpen)
  const [tab, setTab] = useState(0)

  const close = () => setDanmakuDialogOpen(false)

  return (
    <Dialog open={open} onClose={close} fullWidth maxWidth="sm">
      <DialogTitle
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          pb: 0.5,
        }}
      >
        <Typography component="span" variant="h6" sx={{ fontWeight: 800 }}>
          加载弹幕
        </Typography>
        <IconButton size="small" onClick={close}>
          <CloseRounded fontSize="small" />
        </IconButton>
      </DialogTitle>
      <Tabs
        value={tab}
        onChange={(_, v) => setTab(v)}
        variant="fullWidth"
        sx={{ px: 2, borderBottom: '1px solid', borderColor: 'divider' }}
      >
        <Tab label="本地 Local" />
        <Tab label="在线 DanDanPlay" />
      </Tabs>
      <DialogContent sx={{ minHeight: 260 }}>
        {tab === 0 ? <LocalTab onDone={close} /> : <OnlineTab onDone={close} />}
      </DialogContent>
    </Dialog>
  )
}

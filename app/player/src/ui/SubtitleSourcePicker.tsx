import { alpha, Box, Typography } from '@mui/material'
import { useState } from 'react'
import { getPlatform } from '@/platform'
import { usePlayerCommands } from '@/player/commands'
import { usePlayerStore } from '@/store/playerStore'
import { mountEmbeddedTrack, trackLabel } from '@/subtitle/embedded'
import { cancelGeneration, startGeneration } from '@/subtitle/generate'
import { GREEN, INK, MONO, PAPER, VERMILION } from '@/theme/theme'
import { QuickAction } from './QuickPanel'

export const SubtitleSourcePicker = ({ compact = false }) => {
  const commands = usePlayerCommands()
  const media = usePlayerStore((s) => s.media)
  const subtitleSource = usePlayerStore((s) => s.subtitleSource)
  const embeddedTracks = usePlayerStore((s) => s.embeddedTracks)
  const activeEmbeddedTrack = usePlayerStore((s) => s.activeEmbeddedTrack)
  const embeddedError = usePlayerStore((s) => s.embeddedError)
  const sttStatus = usePlayerStore((s) => s.sttStatus)
  const sttProgress = usePlayerStore((s) => s.sttProgress)
  const sttError = usePlayerStore((s) => s.sttError)
  const clearSubtitles = usePlayerStore((s) => s.clearSubtitles)
  const isTauri = getPlatform().isTauri

  /**
   * The pick being extracted right now and the last pick's failure, each tied
   * to the file it was made for: when the video switches mid-extraction (e.g.
   * autoplay moves on while this panel is open), the old pick must neither lock
   * the new file's rows nor leave its error message on them.
   */
  const [pick, setPick] = useState<{ index: number; path: string } | null>(null)
  const [failure, setFailure] = useState<{
    message: string
    path: string | undefined
  } | null>(null)
  const pickBusy = pick && pick.path === media?.path ? pick.index : null
  const error = failure && failure.path === media?.path ? failure.message : null

  const selectTrack = (index: number) => {
    const path = media?.path
    if (!path || pickBusy !== null) return
    const token = { index, path }
    setFailure(null)
    setPick(token)
    const fail = (message: string) => setFailure({ message, path })
    void mountEmbeddedTrack(index)
      .then((result) => {
        // 'media-switched' is not a failure of this track: nothing to report.
        if (result === 'empty') fail('这条字幕轨没有可用内容')
      })
      .catch((err: unknown) =>
        fail(err instanceof Error ? err.message : String(err))
      )
      .finally(() => setPick((current) => (current === token ? null : current)))
  }

  const loadFile = () => {
    setFailure(null)
    void commands.loadSubtitleFromFile().catch((err: unknown) =>
      setFailure({
        message: err instanceof Error ? err.message : String(err),
        path: media?.path,
      })
    )
  }

  const generating = sttStatus !== 'idle'
  const generated = subtitleSource?.kind === 'generated'
  // An embedded track is mounted when its index is recorded; an external file
  // otherwise. Either way the header names it.
  const current = subtitleSource
    ? `${subtitleSource.label} · ${subtitleSource.count} 条${subtitleSource.loading ? ' · 读取中…' : ''}`
    : null

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      <Typography
        component="div"
        sx={{
          fontFamily: MONO,
          fontSize: 11,
          fontWeight: 700,
          color: current ? GREEN : alpha(PAPER, 0.45),
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
        title={current ?? undefined}
      >
        {current ? `当前 · ${current}` : '当前没有字幕'}
      </Typography>

      {embeddedError ? (
        <Notice tone="error">无法读取内封字幕 · {embeddedError}</Notice>
      ) : embeddedTracks.length > 0 ? (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <Typography
            sx={{
              fontFamily: MONO,
              fontSize: 9,
              letterSpacing: '0.2em',
              color: alpha(PAPER, 0.45),
            }}
          >
            内封字幕轨 · EMBEDDED
          </Typography>
          {embeddedTracks.map((track) => {
            const active = track.index === activeEmbeddedTrack
            const busy = track.index === pickBusy
            const disabled = !track.text || pickBusy !== null || generating
            return (
              <Box
                key={track.index}
                component="button"
                type="button"
                disabled={disabled}
                onClick={() => selectTrack(track.index)}
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  width: '100%',
                  textAlign: 'left',
                  border: active
                    ? `2px solid ${VERMILION}`
                    : `2px solid ${alpha(PAPER, 0.3)}`,
                  background: active ? alpha(VERMILION, 0.15) : 'transparent',
                  color: disabled ? alpha(PAPER, 0.45) : PAPER,
                  padding: compact ? '6px 10px' : '8px 12px',
                  cursor: disabled ? 'not-allowed' : 'pointer',
                  fontFamily: MONO,
                  fontSize: 12,
                  fontWeight: 700,
                  '&:hover': disabled
                    ? undefined
                    : { background: alpha(VERMILION, 0.2) },
                }}
              >
                <Box
                  component="span"
                  sx={{
                    width: 8,
                    height: 8,
                    flex: '0 0 auto',
                    background: active ? VERMILION : alpha(PAPER, 0.3),
                  }}
                />
                <Box
                  component="span"
                  sx={{
                    flex: 1,
                    minWidth: 0,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {trackLabel(track)}
                </Box>
                {!track.text && (
                  <Box component="span" sx={{ color: VERMILION }}>
                    图形字幕 · 不支持
                  </Box>
                )}
                {busy && <Box component="span">提取中…</Box>}
                {active && !busy && <Box component="span">使用中</Box>}
              </Box>
            )
          })}
        </Box>
      ) : media?.path ? (
        <Typography
          sx={{ fontSize: 11, fontWeight: 700, color: alpha(PAPER, 0.5) }}
        >
          此视频没有内封字幕。同目录下的同名 .srt / .ass 会自动加载。
        </Typography>
      ) : null}

      <Box sx={{ display: 'flex', gap: '6px' }}>
        <QuickAction
          onClick={loadFile}
          disabled={!media || generating || pickBusy !== null}
        >
          加载字幕文件…
        </QuickAction>
        <QuickAction
          danger
          onClick={() => clearSubtitles()}
          disabled={!subtitleSource || generating || pickBusy !== null}
        >
          移除字幕
        </QuickAction>
      </Box>

      {isTauri && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {generating ? (
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                border: `2px solid ${VERMILION}`,
                background: alpha(VERMILION, 0.1),
                padding: '6px 8px',
              }}
            >
              <Typography
                sx={{
                  flex: 1,
                  fontSize: 12,
                  fontWeight: 700,
                  color: PAPER,
                }}
              >
                {sttStatus === 'extracting' ? '提取音频' : '语音识别'}{' '}
                {Math.round(sttProgress * 100)}%
              </Typography>
              <Box
                component="button"
                type="button"
                onClick={() => void cancelGeneration()}
                sx={{
                  appearance: 'none',
                  border: `2px solid ${PAPER}`,
                  background: 'transparent',
                  color: PAPER,
                  padding: '3px 10px',
                  fontSize: 11,
                  fontWeight: 700,
                  cursor: 'pointer',
                  '&:hover': { background: PAPER, color: INK },
                }}
              >
                取消
              </Box>
            </Box>
          ) : (
            <QuickAction
              onClick={() => void startGeneration()}
              disabled={!media?.path || pickBusy !== null}
            >
              {generated ? '继续语音识别' : '语音识别生成字幕'}
            </QuickAction>
          )}
          {sttError && <Notice tone="error">{sttError}</Notice>}
        </Box>
      )}

      {error && <Notice tone="error">{error}</Notice>}
    </Box>
  )
}

const Notice = ({
  tone,
  children,
}: {
  tone: 'error'
  children: React.ReactNode
}) => (
  <Box
    sx={{
      border: `2px solid ${tone === 'error' ? VERMILION : PAPER}`,
      background: alpha(VERMILION, 0.08),
      color: VERMILION,
      fontSize: 12,
      fontWeight: 700,
      padding: '6px 10px',
      wordBreak: 'break-word',
    }}
  >
    {children}
  </Box>
)

import { Box, Button, Stack, Typography } from '@mui/material'
import { alpha } from '@mui/material/styles'
import { useEffect, useState } from 'react'
import { getPlatform } from '@/platform'
import { usePlayerStore } from '@/store/playerStore'
import { downloadModel, type ModelStatus, modelStatus } from '@/subtitle/native'
import { GREEN, INK, LINE_STRONG, MONO, PAPER, VERMILION } from '@/theme/theme'
import { InkLabel, InkLabeledSlider, InkSection, InkSwitch } from './ink'
import { SubtitleSourcePicker } from './SubtitleSourcePicker'

export const SubtitleSettings = () => {
  const subtitle = usePlayerStore((s) => s.subtitleSettings)
  const update = usePlayerStore((s) => s.updateSubtitleSettings)
  const sttStatus = usePlayerStore((s) => s.sttStatus)
  const media = usePlayerStore((s) => s.media)
  const isTauri = getPlatform().isTauri
  const subtitleSource = usePlayerStore((s) => s.subtitleSource)

  const [models, setModels] = useState<ModelStatus[]>([])
  const [downloadingId, setDownloadingId] = useState<string | null>(null)
  const [downloadPercent, setDownloadPercent] = useState(0)

  useEffect(() => {
    if (!isTauri) return
    void modelStatus()
      .then(setModels)
      .catch(() => undefined)
  }, [isTauri, sttStatus])

  const senseVoice = models.find((m) => m.id === 'sensevoice-int8')

  const handleDownload = () => {
    if (downloadingId) return
    setDownloadingId('sensevoice-int8')
    setDownloadPercent(0)
    void downloadModel('sensevoice-int8', (event) => {
      if (event.type === 'downloading') setDownloadPercent(event.percent)
      if (event.type === 'failed') {
        setDownloadingId(null)
        usePlayerStore.getState().setSttError(event.message)
      }
      if (event.type === 'done') {
        setDownloadingId(null)
        void modelStatus()
          .then(setModels)
          .catch(() => undefined)
      }
    }).catch(() => setDownloadingId(null))
  }

  const generating = sttStatus !== 'idle'

  return (
    <Stack spacing={2.5}>
      <InkSection zh="来源" en="SOURCE">
        <SubtitleSourcePicker />
      </InkSection>

      <InkSection zh="显示" en="DISPLAY">
        <Box sx={{ border: LINE_STRONG, padding: '12px' }}>
          <Stack
            direction="row"
            alignItems="center"
            justifyContent="space-between"
          >
            <InkLabel zh="显示字幕" en="VISIBLE · 快捷键 S" size={13} />
            <InkSwitch
              checked={subtitle.visible}
              onChange={(checked) => update({ visible: checked })}
              label="显示字幕"
            />
          </Stack>
        </Box>
        <InkLabeledSlider
          zh="字号"
          en="FONT SIZE"
          display={`${subtitle.fontSize}px`}
          min={16}
          max={64}
          step={2}
          value={subtitle.fontSize}
          onChange={(value) => update({ fontSize: value })}
        />
        <InkLabeledSlider
          zh="底部边距"
          en="BOTTOM OFFSET"
          display={`${subtitle.bottom}%`}
          min={0}
          max={30}
          step={1}
          value={subtitle.bottom}
          onChange={(value) => update({ bottom: value })}
        />
        <InkLabeledSlider
          zh="不透明度"
          en="OPACITY"
          display={`${Math.round(subtitle.opacity * 100)}%`}
          min={0.3}
          max={1}
          step={0.05}
          value={subtitle.opacity}
          onChange={(value) => update({ opacity: value })}
        />
        <InkLabeledSlider
          zh="时轴偏移"
          en="OFFSET · , / ."
          display={`${subtitle.offset >= 0 ? '+' : ''}${subtitle.offset}ms`}
          min={-10000}
          max={10000}
          step={100}
          value={subtitle.offset}
          centerTick
          onChange={(value) => update({ offset: value })}
        />
        <Box sx={{ border: LINE_STRONG, padding: '12px' }}>
          <Stack
            direction="row"
            alignItems="center"
            justifyContent="space-between"
          >
            <InkLabel zh="墨色描边" en="OUTLINE" size={13} />
            <InkSwitch
              checked={subtitle.outline}
              onChange={(checked) => update({ outline: checked })}
              label="墨色描边"
            />
          </Stack>
        </Box>
      </InkSection>

      {isTauri && (
        <InkSection zh="语音识别模型" en="SPEECH MODEL">
          <Stack spacing={1.5}>
            <Box
              sx={{
                border: LINE_STRONG,
                background: alpha(INK, 0.4),
                padding: '10px 12px',
                display: 'flex',
                alignItems: 'center',
                gap: 2,
              }}
            >
              <Box
                component="span"
                sx={{ fontSize: 12, fontWeight: 700, color: PAPER }}
              >
                本地模型 · SenseVoice
              </Box>
              <Box component="span" sx={{ flex: 1 }} />
              <Box
                component="span"
                sx={{
                  fontFamily: MONO,
                  fontSize: 11,
                  fontWeight: 700,
                  color: senseVoice?.downloaded ? GREEN : VERMILION,
                }}
              >
                {senseVoice?.downloaded
                  ? `已就绪 · ${senseVoice.size_label}`
                  : (senseVoice?.size_label ?? '未下载')}
              </Box>
            </Box>
            <Typography
              sx={{
                fontFamily: MONO,
                fontSize: 10,
                fontWeight: 700,
                color: alpha(PAPER, 0.5),
                lineHeight: 1.6,
              }}
            >
              边播边生成：只识别播放位置前面的一小段，播到哪儿补到哪儿；结果会存成同目录的
              .srt。
              {subtitleSource?.kind === 'generated' &&
                ' 当前字幕就是语音识别生成的。'}
            </Typography>
            {senseVoice && !senseVoice.downloaded && (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                <Button
                  variant="outlined"
                  size="small"
                  disabled={downloadingId !== null || generating}
                  onClick={handleDownload}
                  sx={{
                    border: LINE_STRONG,
                    color: PAPER,
                    fontWeight: 700,
                    fontFamily: MONO,
                    '&:hover': { background: alpha(VERMILION, 0.2) },
                  }}
                >
                  {downloadingId
                    ? `下载中 ${Math.round(downloadPercent)}%`
                    : '下载模型（约 240MB）'}
                </Button>
                {downloadingId && (
                  <Box
                    sx={{
                      flex: 1,
                      height: 8,
                      border: `2px solid ${PAPER}`,
                      position: 'relative',
                    }}
                  >
                    <Box
                      sx={{
                        position: 'absolute',
                        inset: 0,
                        width: `${downloadPercent}%`,
                        background: VERMILION,
                      }}
                    />
                  </Box>
                )}
              </Box>
            )}
            {!media?.path && (
              <Typography
                sx={{ fontSize: 11, fontWeight: 700, color: alpha(PAPER, 0.5) }}
              >
                先打开一个本地视频，才能生成字幕。
              </Typography>
            )}
          </Stack>
        </InkSection>
      )}
    </Stack>
  )
}

import { Box, Button, Stack } from '@mui/material'
import { alpha } from '@mui/material/styles'
import { useEffect, useState } from 'react'
import { usePlayerStore } from '@/store/playerStore'
import {
  cancelGeneration,
  isGenerating,
  startGeneration,
} from '@/subtitle/generate'
import { downloadModel, type ModelStatus, modelStatus } from '@/subtitle/native'
import { GREEN, INK, LINE_STRONG, MONO, PAPER, VERMILION } from '@/theme/theme'
import { InkLabeledSlider, InkSection, InkSwitch } from './ink'

export const SubtitleSettings = () => {
  const subtitle = usePlayerStore((s) => s.subtitleSettings)
  const update = usePlayerStore((s) => s.updateSubtitleSettings)
  const sttStatus = usePlayerStore((s) => s.sttStatus)
  const sttProgress = usePlayerStore((s) => s.sttProgress)
  const sttError = usePlayerStore((s) => s.sttError)

  const [models, setModels] = useState<ModelStatus[]>([])
  const [downloadingId, setDownloadingId] = useState<string | null>(null)
  const [downloadPercent, setDownloadPercent] = useState(0)

  useEffect(() => {
    void modelStatus()
      .then(setModels)
      .catch(() => undefined)
  }, [sttStatus])

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

  const generating = isGenerating()

  return (
    <Stack spacing={2.5}>
      <InkSection zh="显示" en="DISPLAY">
        <Stack spacing={1.5}>
          <InkSwitch
            checked={subtitle.visible}
            onChange={(checked) => update({ visible: checked })}
            label="显示字幕"
          />
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
          <InkSwitch
            checked={subtitle.outline}
            onChange={(checked) => update({ outline: checked })}
            label="墨色描边"
          />
        </Stack>
      </InkSection>

      <InkSection zh="语音识别" en="SPEECH TO TEXT">
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
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <Button
              variant="outlined"
              size="small"
              disabled={generating || senseVoice?.downloaded !== true}
              onClick={() =>
                void (generating ? cancelGeneration() : startGeneration())
              }
              sx={{
                border: LINE_STRONG,
                color: generating ? VERMILION : PAPER,
                fontWeight: 700,
                fontFamily: MONO,
                '&:hover': { background: alpha(VERMILION, 0.2) },
                '&:disabled': { opacity: 0.4 },
              }}
            >
              {generating
                ? `取消（${sttStatus === 'extracting' ? '音频' : '识别'} ${Math.round(sttProgress * 100)}%）`
                : '为本片生成字幕'}
            </Button>
          </Box>
          {sttError && (
            <Box
              sx={{
                border: `2px solid ${VERMILION}`,
                background: alpha(VERMILION, 0.08),
                color: VERMILION,
                fontSize: 12,
                fontWeight: 700,
                padding: '8px 10px',
              }}
            >
              {sttError}
            </Box>
          )}
        </Stack>
      </InkSection>

      <InkSection zh="时轴微调" en="TIMING OFFSET">
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
      </InkSection>
    </Stack>
  )
}

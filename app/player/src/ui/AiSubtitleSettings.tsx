import { Box, Stack, Typography } from '@mui/material'
import { alpha } from '@mui/material/styles'
import { useCallback, useEffect, useState } from 'react'
import { usePlayerStore } from '@/store/playerStore'
import type { DisplayMode, ExportKind } from '@/subtitle/aiTrack'
import { exportGenerated, REQUIRED_ASSETS } from '@/subtitle/generate'
import {
  type AssetStatus,
  type AssetsReport,
  downloadAsset,
  gpuInfo,
  saveSrt,
  setSubtitleDataDir,
  subtitleAssets,
} from '@/subtitle/native'
import { GREEN, INK, LINE_STRONG, MONO, PAPER, VERMILION } from '@/theme/theme'
import { InkLabel, type InkOption, InkSwitch, InkToggleGroup } from './ink'
import { QuickAction } from './QuickPanel'
import { errorMessage } from './shared'

const DISPLAY_OPTIONS: readonly InkOption<DisplayMode>[] = [
  { value: 'dual', label: '双语' },
  { value: 'zh', label: '译文' },
  { value: 'ja', label: '原文' },
]

const EXPORTS: { kind: ExportKind; label: string; suffix: string }[] = [
  { kind: 'dual', label: '双语', suffix: 'zh-ja' },
  { kind: 'zh', label: '中文', suffix: 'zh' },
  { kind: 'ja', label: '日文', suffix: 'ja' },
]

const formatBytes = (n: number) =>
  n >= 1e9
    ? `${(n / 1e9).toFixed(1)} GB`
    : `${Math.max(1, Math.round(n / 1e6))} MB`

interface Progress {
  id: string
  text: string
  ratio: number
}

/** 设置 → 字幕 → AI 字幕: data dir, components, GPU, display, export. */
export const AiSubtitleSettings = () => {
  const subtitle = usePlayerStore((s) => s.subtitleSettings)
  const update = usePlayerStore((s) => s.updateSubtitleSettings)
  const aiError = usePlayerStore((s) => s.aiError)
  const media = usePlayerStore((s) => s.media)
  const subtitleSource = usePlayerStore((s) => s.subtitleSource)

  const [report, setReport] = useState<AssetsReport | null>(null)
  const [nvidia, setNvidia] = useState(false)
  const [progress, setProgress] = useState<Progress | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const refresh = useCallback(() => {
    void subtitleAssets()
      .then(setReport)
      .catch((error: unknown) => setMessage(errorMessage(error)))
  }, [])

  useEffect(() => {
    refresh()
    void gpuInfo()
      .then((info) => setNvidia(info.freeMb !== null))
      .catch(() => undefined)
  }, [refresh])

  const download = (asset: AssetStatus) => {
    if (progress) return
    setMessage(null)
    setProgress({ id: asset.id, text: '连接中…', ratio: 0 })
    void downloadAsset(asset.id, (event) => {
      switch (event.type) {
        case 'downloading':
          setProgress({
            id: asset.id,
            text: `${formatBytes(event.received)} / ${formatBytes(event.total)}`,
            ratio: event.total ? event.received / event.total : 0,
          })
          break
        case 'verifying':
          setProgress({ id: asset.id, text: '校验中…', ratio: 1 })
          break
        case 'extracting':
          setProgress({ id: asset.id, text: '解压中…', ratio: 1 })
          break
        case 'failed':
          setMessage(`${asset.label} 下载失败：${event.message}`)
          break
        case 'done':
          break
      }
    })
      .catch((error: unknown) =>
        setMessage(`${asset.label} 下载失败：${errorMessage(error)}`)
      )
      .finally(() => {
        setProgress(null)
        refresh()
      })
  }

  const downloadAll = () => {
    const next = report?.assets.find(
      (a) =>
        !a.installed && (REQUIRED_ASSETS as readonly string[]).includes(a.id)
    )
    if (next) download(next)
  }

  const changeDir = async () => {
    const { open } = await import('@tauri-apps/plugin-dialog')
    const picked = await open({ directory: true, multiple: false })
    if (typeof picked !== 'string') return
    if (/^c:/i.test(picked)) {
      setMessage('C 盘空间紧张，请选择其他磁盘')
      return
    }
    try {
      setReport(await setSubtitleDataDir(picked))
      setMessage(null)
    } catch (error) {
      setMessage(errorMessage(error))
    }
  }

  const exportSrt = async (kind: ExportKind, suffix: string) => {
    const path = media?.path
    if (!path) return
    const text = await exportGenerated(kind)
    if (!text) {
      setMessage('这个视频还没有生成过 AI 字幕')
      return
    }
    const { save } = await import('@tauri-apps/plugin-dialog')
    const target = await save({
      defaultPath: `${path.replace(/\.[^.\\/]+$/, '')}.${suffix}.srt`,
      filters: [{ name: 'SubRip', extensions: ['srt'] }],
    })
    if (!target) return
    try {
      await saveSrt(target, text)
      usePlayerStore.getState().showOsd('字幕已导出', '✓')
    } catch (error) {
      setMessage(`导出失败：${errorMessage(error)}`)
    }
  }

  const visible = (report?.assets ?? []).filter(
    (a) => !a.optional || nvidia || a.installed
  )
  const missingRequired = visible.some(
    (a) => !a.installed && (REQUIRED_ASSETS as readonly string[]).includes(a.id)
  )

  return (
    <Stack spacing={1.5}>
      <Typography
        sx={{
          fontFamily: MONO,
          fontSize: 10,
          fontWeight: 700,
          color: alpha(PAPER, 0.55),
          lineHeight: 1.6,
        }}
      >
        日语原声 → 中文字幕。点「AI
        生成中文字幕」后会自动暂停、借显卡先生成一段，好了自动继续播放；之后边播边用
        CPU 补。识别 Whisper large-v3-turbo，翻译 Murasaki-4B，全部本地运行。
      </Typography>

      <Box sx={{ border: LINE_STRONG, padding: '10px 12px' }}>
        <Stack direction="row" alignItems="center" gap={1.5}>
          <InkLabel zh="数据目录" en="DATA DIR · 模型 / 缓存" size={13} />
          <Box sx={{ flex: 1 }} />
          <QuickAction onClick={() => void changeDir()} disabled={!!progress}>
            更改…
          </QuickAction>
        </Stack>
        <Typography
          sx={{
            mt: '6px',
            fontFamily: MONO,
            fontSize: 11,
            fontWeight: 700,
            color: PAPER,
            wordBreak: 'break-all',
          }}
        >
          {report?.dataDir ?? '读取中…'}
          {report?.freeBytes != null && (
            <Box component="span" sx={{ color: alpha(PAPER, 0.5) }}>
              {' '}
              · 剩余 {formatBytes(report.freeBytes)}
            </Box>
          )}
        </Typography>
      </Box>

      <Box sx={{ border: LINE_STRONG }}>
        {visible.map((asset) => {
          const busy = progress?.id === asset.id
          return (
            <Box
              key={asset.id}
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 1.5,
                padding: '8px 12px',
                borderBottom: `1px solid ${alpha(PAPER, 0.15)}`,
                '&:last-of-type': { borderBottom: 'none' },
                position: 'relative',
                background: alpha(INK, 0.4),
              }}
            >
              {busy && (
                <Box
                  sx={{
                    position: 'absolute',
                    left: 0,
                    bottom: 0,
                    height: '3px',
                    width: `${Math.round((progress?.ratio ?? 0) * 100)}%`,
                    background: VERMILION,
                  }}
                />
              )}
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography
                  sx={{ fontSize: 12, fontWeight: 700, color: PAPER }}
                >
                  {asset.label}
                  {asset.optional && (
                    <Box component="span" sx={{ color: alpha(PAPER, 0.5) }}>
                      {' '}
                      · 可选，N 卡识别提速
                    </Box>
                  )}
                </Typography>
              </Box>
              <Box
                component="span"
                sx={{
                  fontFamily: MONO,
                  fontSize: 11,
                  fontWeight: 700,
                  color: asset.installed ? GREEN : alpha(PAPER, 0.6),
                  whiteSpace: 'nowrap',
                }}
              >
                {busy
                  ? progress?.text
                  : asset.installed
                    ? '已就绪'
                    : asset.partialBytes > 0
                      ? `已下 ${formatBytes(asset.partialBytes)} / ${formatBytes(asset.bytes)}`
                      : formatBytes(asset.bytes)}
              </Box>
              {!asset.installed && !busy && (
                <QuickAction
                  onClick={() => download(asset)}
                  disabled={!!progress}
                >
                  {asset.partialBytes > 0 ? '继续' : '下载'}
                </QuickAction>
              )}
            </Box>
          )
        })}
      </Box>
      {missingRequired && (
        <QuickAction onClick={downloadAll} disabled={!!progress}>
          下载缺少的组件（逐个进行）
        </QuickAction>
      )}

      <Box sx={{ border: LINE_STRONG, padding: '12px' }}>
        <Stack
          direction="row"
          alignItems="center"
          justifyContent="space-between"
        >
          <InkLabel
            zh="借用显卡加速"
            en="GPU BURST · 用完即释放显存"
            size={13}
          />
          <InkSwitch
            checked={subtitle.aiGpu}
            onChange={(checked) => update({ aiGpu: checked })}
            label="借用显卡加速"
          />
        </Stack>
      </Box>

      <Box>
        <InkLabel zh="显示内容" en="DISPLAY · 快捷键 T" size={13} />
        <Box sx={{ mt: '6px' }}>
          <InkToggleGroup
            options={DISPLAY_OPTIONS}
            value={subtitle.aiDisplay}
            onChange={(v) => update({ aiDisplay: v })}
          />
        </Box>
      </Box>

      {media?.path && subtitleSource?.kind === 'generated' && (
        <Box sx={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
          {EXPORTS.map(({ kind, label, suffix }) => (
            <QuickAction
              key={kind}
              onClick={() => void exportSrt(kind, suffix)}
            >
              导出{label} .srt
            </QuickAction>
          ))}
        </Box>
      )}

      {(message || aiError) && (
        <Box
          sx={{
            border: `2px solid ${VERMILION}`,
            background: alpha(VERMILION, 0.08),
            color: VERMILION,
            fontSize: 12,
            fontWeight: 700,
            padding: '6px 10px',
            wordBreak: 'break-word',
          }}
        >
          {message ?? aiError}
        </Box>
      )}
    </Stack>
  )
}

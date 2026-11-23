import { alpha, Box, Fade, Popover, Typography } from '@mui/material'
import { useEffect, useId, useState } from 'react'
import { usePlayerCommands } from '@/player/commands'
import { usePlayerStore } from '@/store/playerStore'
import type { ScreenshotSource } from '@/store/settings'
import {
  hardShadow,
  INK,
  LINE_STRONG,
  LINE_SUBTLE,
  MONO,
  MOTION_POPOVER,
  PAPER,
  VERMILION,
} from '@/theme/theme'
import { CameraIcon } from './icons'
import { InkButton, type InkOption, InkSwitch, InkToggleGroup } from './ink'
import { QuickAction, QuickDivider, QuickRow } from './QuickPanel'

const SOURCE_OPTIONS: InkOption<ScreenshotSource>[] = [
  { value: 'upscaled', label: '超分优先' },
  { value: 'original', label: '原片画面' },
]

/**
 * Bottom-bar screenshot button:
 *  - Left click: capture immediately using the persisted layer selection.
 *  - Right click: open an ink popover to toggle upscaled/original source,
 *    danmaku, subtitles and optional local PNG saving.
 */
export const ScreenshotButton = () => {
  const commands = usePlayerCommands()
  const playback = usePlayerStore((s) => s.playbackSettings)
  const updatePlayback = usePlayerStore((s) => s.updatePlaybackSettings)
  const upscaleEnabled = usePlayerStore((s) => s.upscale.enabled)
  const danmakuSource = usePlayerStore((s) => s.danmakuSource)
  const danmakuVisible = usePlayerStore((s) => s.danmakuSettings.visible)
  const subtitleSource = usePlayerStore((s) => s.subtitleSource)
  const subtitleVisible = usePlayerStore((s) => s.subtitleSettings.visible)
  const holdControls = usePlayerStore((s) => s.holdControls)
  const blocked = usePlayerStore((s) => s.settingsOpen || s.danmakuDialogOpen)

  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const panelId = useId()
  const open = Boolean(anchor) && !blocked
  const close = () => setAnchor(null)

  useEffect(() => {
    if (blocked) setAnchor(null)
  }, [blocked])

  useEffect(() => {
    if (!open) return
    holdControls(1)
    return () => holdControls(-1)
  }, [open, holdControls])

  const hasOverlays =
    playback.screenshotIncludeDanmaku || playback.screenshotIncludeSubtitles
  const modeSummary =
    playback.screenshotIncludeDanmaku && playback.screenshotIncludeSubtitles
      ? '弹幕 + 字幕'
      : playback.screenshotIncludeDanmaku
        ? '含弹幕'
        : playback.screenshotIncludeSubtitles
          ? '含字幕'
          : '纯画面'

  const danmakuHint = !danmakuSource
    ? '当前未挂载弹幕'
    : !danmakuVisible
      ? '当前弹幕已隐藏'
      : `已挂载 ${danmakuSource.count.toLocaleString()} 条`

  const subtitleHint = !subtitleSource
    ? '当前未加载字幕'
    : !subtitleVisible
      ? '当前字幕已隐藏'
      : '合成时自动贴回正常底边'

  return (
    <>
      <Box
        component="button"
        type="button"
        aria-label="截图 (Shift+S) / Screenshot"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        title={`截图：${modeSummary} (Shift+S / Ctrl+S) · 右键选内容`}
        onClick={() => void commands.takeScreenshot()}
        onContextMenu={(e: React.MouseEvent<HTMLElement>) => {
          e.preventDefault()
          setAnchor(open ? null : e.currentTarget)
        }}
        sx={{
          appearance: 'none',
          position: 'relative',
          width: 38,
          height: 38,
          '@media (max-width: 960px)': { width: 34, height: 34 },
          border: open ? `2px solid ${VERMILION}` : LINE_STRONG,
          background: open ? VERMILION : 'transparent',
          color: PAPER,
          fontSize: 13,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          padding: 0,
          lineHeight: 1,
          transition: 'background-color 0ms, color 0ms, border-color 0ms',
          '&:hover': { background: PAPER, color: INK, borderColor: PAPER },
          '&:focus-visible': {
            outline: `2px solid ${VERMILION}`,
            outlineOffset: '2px',
          },
        }}
      >
        <CameraIcon size={16} />
        {hasOverlays && !open && (
          <Box
            component="span"
            aria-hidden
            sx={{
              position: 'absolute',
              top: 3,
              right: 3,
              width: 5,
              height: 5,
              background: VERMILION,
              pointerEvents: 'none',
            }}
          />
        )}
      </Box>

      <Popover
        open={open}
        anchorEl={anchor}
        onClose={close}
        TransitionComponent={Fade}
        transitionDuration={140}
        disableRestoreFocus={blocked}
        anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
        transformOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        slotProps={{
          paper: {
            id: panelId,
            role: 'dialog',
            'aria-label': '截图内容',
            'data-quick-panel': 'screenshot',
            sx: {
              marginTop: '-10px',
              width: 300,
              display: 'flex',
              flexDirection: 'column',
              background: INK,
              backgroundImage: 'none',
              border: LINE_STRONG,
              borderRadius: 0,
              boxShadow: hardShadow(6),
              animation: `ink-popover-rise ${MOTION_POPOVER}`,
              '@media (prefers-reduced-motion: reduce)': {
                animation: 'none',
              },
            },
          } as object,
        }}
      >
        <Box
          sx={{
            padding: '10px 14px 8px',
            borderBottom: LINE_SUBTLE,
            display: 'flex',
            alignItems: 'flex-end',
            justifyContent: 'space-between',
            gap: '8px',
          }}
        >
          <Box>
            <Typography
              component="span"
              sx={{
                display: 'block',
                fontFamily: MONO,
                fontSize: 9,
                fontWeight: 700,
                letterSpacing: '0.28em',
                color: VERMILION,
                textTransform: 'uppercase',
              }}
            >
              SCREENSHOT
            </Typography>
            <Typography
              component="span"
              sx={{ fontSize: 15, fontWeight: 900, color: PAPER }}
            >
              截图内容
            </Typography>
          </Box>
          <Typography
            component="span"
            sx={{
              fontFamily: MONO,
              fontSize: 10,
              fontWeight: 700,
              color: hasOverlays ? VERMILION : alpha(PAPER, 0.55),
              border: `1px solid ${hasOverlays ? VERMILION : alpha(PAPER, 0.25)}`,
              padding: '1px 6px',
            }}
          >
            {modeSummary}
          </Typography>
        </Box>

        <Box
          sx={{
            padding: '12px 14px',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
          }}
        >
          <Box>
            <Typography
              sx={{ fontSize: 12, fontWeight: 700, color: PAPER, mb: '6px' }}
            >
              画面来源
            </Typography>
            <InkToggleGroup
              options={SOURCE_OPTIONS}
              value={playback.screenshotSource}
              onChange={(v) => updatePlayback({ screenshotSource: v })}
              columns={2}
            />
            {playback.screenshotSource === 'upscaled' && !upscaleEnabled && (
              <Typography
                sx={{
                  fontSize: 10,
                  fontWeight: 700,
                  color: alpha(PAPER, 0.45),
                  mt: '5px',
                }}
              >
                当前未开超分，自动截取原片分辨率
              </Typography>
            )}
          </Box>

          <QuickDivider />

          <QuickRow label="包含弹幕" hint={danmakuHint}>
            <InkSwitch
              checked={playback.screenshotIncludeDanmaku}
              onChange={(checked) =>
                updatePlayback({ screenshotIncludeDanmaku: checked })
              }
              label="包含弹幕"
            />
          </QuickRow>

          <QuickRow label="包含字幕" hint={subtitleHint}>
            <InkSwitch
              checked={playback.screenshotIncludeSubtitles}
              onChange={(checked) =>
                updatePlayback({ screenshotIncludeSubtitles: checked })
              }
              label="包含字幕"
            />
          </QuickRow>

          <QuickDivider />

          <QuickRow label="同时保存到本地" hint="默认仅写入剪贴板">
            <InkSwitch
              checked={playback.saveScreenshotToFile}
              onChange={(checked) =>
                updatePlayback({ saveScreenshotToFile: checked })
              }
              label="同时保存到本地"
            />
          </QuickRow>

          <Box sx={{ display: 'flex', gap: '6px', pt: '2px' }}>
            <QuickAction
              disabled={!hasOverlays}
              onClick={() =>
                updatePlayback({
                  screenshotIncludeDanmaku: false,
                  screenshotIncludeSubtitles: false,
                })
              }
            >
              仅纯画面
            </QuickAction>
            <InkButton
              variant="primary"
              size="sm"
              fullWidth
              onClick={() => {
                close()
                void commands.takeScreenshot()
              }}
            >
              立即截图
            </InkButton>
          </Box>
        </Box>
      </Popover>
    </>
  )
}

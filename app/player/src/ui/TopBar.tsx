import { alpha, Box } from '@mui/material'
import type { ReactNode } from 'react'
import type { Platform } from '@/platform'
import { usePlayerCommands } from '@/player/commands'
import { usePlayerStore } from '@/store/playerStore'
import { GOLD, INK, MONO, PAPER, SANS, VERMILION } from '@/theme/theme'

interface TopBarProps {
  /** When false, the bar fades and slides up out of view. */
  visible: boolean
  /** Window chrome lives here now — the native title bar is disabled. */
  platform: Platform
}

/** Marks an element as a native-window drag handle (undecorated Tauri window). */
const dragRegion = { 'data-tauri-drag-region': true }

/** Shared style for the right-hand text buttons (full-height, hard-cut hover). */
const barButtonSx = {
  appearance: 'none',
  border: 0,
  borderLeft: `1px solid ${alpha(PAPER, 0.14)}`,
  background: 'transparent',
  color: alpha(PAPER, 0.8),
  fontFamily: SANS,
  fontSize: 13,
  fontWeight: 700,
  padding: '0 14px',
  height: '100%',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
  flexShrink: 0,
  display: 'flex',
  alignItems: 'center',
  transition: 'background-color 100ms steps(1), color 100ms steps(1)',
  '&:hover': { background: PAPER, color: INK },
} as const

/** Outlined mono badge (HDR10 / 弾 N). */
const Badge = ({
  color,
  title,
  children,
}: {
  color: string
  title?: string
  children: ReactNode
}) => (
  <Box
    component="span"
    title={title}
    sx={{
      border: `2px solid ${color}`,
      color,
      fontFamily: MONO,
      fontSize: 10,
      fontWeight: 700,
      padding: '1px 5px',
      letterSpacing: '0.1em',
      whiteSpace: 'nowrap',
      flexShrink: 0,
      lineHeight: 1.4,
    }}
  >
    {children}
  </Box>
)

export const TopBar = ({ visible, platform }: TopBarProps) => {
  const commands = usePlayerCommands()
  const media = usePlayerStore((s) => s.media)
  const danmakuSource = usePlayerStore((s) => s.danmakuSource)
  const isHdr = usePlayerStore((s) => s.isHdr)
  const hdrTransfer = usePlayerStore((s) => s.hdrTransfer)
  const playlist = usePlayerStore((s) => s.playlist)
  const setDanmakuDialogOpen = usePlayerStore((s) => s.setDanmakuDialogOpen)
  const openSettingsAt = usePlayerStore((s) => s.openSettingsAt)

  const actions = [
    { label: '開 打开', onClick: () => void commands.openVideo() },
    { label: '弾 弹幕源', onClick: () => setDanmakuDialogOpen(true) },
    {
      label: `列 列表${playlist.length > 1 ? ` · ${playlist.length}` : ''}`,
      onClick: () => commands.togglePlaylist(),
    },
    { label: '超 增强', onClick: () => openSettingsAt('upscale') },
    { label: '設 设置', onClick: () => openSettingsAt('shortcuts') },
  ]

  const chrome = [
    {
      glyph: '─',
      size: 14,
      label: '最小化 / Minimize',
      onClick: () => platform.minimizeWindow(),
      danger: false,
    },
    {
      glyph: '□',
      size: 12,
      label: '最大化 / Maximize',
      onClick: () => platform.toggleMaximizeWindow(),
      danger: false,
    },
    {
      glyph: '✕',
      size: 14,
      label: '关闭 / Close',
      onClick: () => platform.closeWindow(),
      danger: true,
    },
  ]

  return (
    <Box
      {...dragRegion}
      sx={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 40,
        height: 48,
        background: INK,
        borderBottom: `2px solid ${PAPER}`,
        display: 'flex',
        alignItems: 'center',
        paddingLeft: '12px',
        opacity: visible ? 1 : 0,
        transform: visible ? 'translateY(0)' : 'translateY(-48px)',
        transition: 'opacity 180ms steps(1), transform 180ms steps(1)',
        pointerEvents: visible ? 'auto' : 'none',
      }}
    >
      {/* Left: mark + wordmark + file + badges. Only the file name may shrink. */}
      <Box
        {...dragRegion}
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          minWidth: 0,
          flex: '0 1 auto',
        }}
      >
        <Box
          sx={{
            width: 26,
            height: 26,
            background: PAPER,
            color: INK,
            fontSize: 12,
            fontWeight: 900,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          ▶
        </Box>
        <Box
          component="span"
          sx={{
            fontSize: 14,
            fontWeight: 900,
            color: PAPER,
            letterSpacing: '0.06em',
            whiteSpace: 'nowrap',
            flexShrink: 0,
          }}
        >
          弾幕プレイヤー
        </Box>

        {media?.name && (
          <>
            <Box
              sx={{
                // '1px' not 1 — MUI reads bare 0..1 numbers as percentages.
                width: '1px',
                height: 18,
                background: alpha(PAPER, 0.25),
                flexShrink: 0,
              }}
            />
            <Box
              component="span"
              title={media.name}
              sx={{
                fontFamily: MONO,
                fontSize: 12,
                color: alpha(PAPER, 0.62),
                maxWidth: 340,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                minWidth: 0,
              }}
            >
              {media.name}
            </Box>
          </>
        )}

        {isHdr && (
          <Badge
            color={GOLD}
            title="HDR 片源 · 需 Windows HDR 模式与 HDR 显示器方可完整呈现"
          >
            {hdrTransfer === 'hlg' ? 'HLG' : 'HDR10'}
          </Badge>
        )}
        {danmakuSource && (
          <Badge color={VERMILION} title={danmakuSource.label}>
            弾 {danmakuSource.count.toLocaleString()}
          </Badge>
        )}
      </Box>

      {/* elastic drag strip between the two clusters */}
      <Box
        {...dragRegion}
        sx={{ flex: '1 1 auto', minWidth: 8, height: '100%' }}
      />

      {/* Right: actions + window chrome, never squeezed */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'stretch',
          height: '100%',
          flexShrink: 0,
        }}
      >
        {actions.map((a) => (
          <Box
            key={a.label}
            component="button"
            type="button"
            onClick={a.onClick}
            sx={barButtonSx}
          >
            {a.label}
          </Box>
        ))}

        {platform.isTauri &&
          chrome.map((c) => (
            <Box
              key={c.glyph}
              component="button"
              type="button"
              aria-label={c.label}
              onClick={c.onClick}
              sx={{
                ...barButtonSx,
                fontFamily: MONO,
                fontSize: c.size,
                color: alpha(PAPER, 0.75),
                padding: '0 15px',
                ...(c.danger && {
                  '&:hover': { background: VERMILION, color: PAPER },
                }),
              }}
            >
              {c.glyph}
            </Box>
          ))}
      </Box>
    </Box>
  )
}

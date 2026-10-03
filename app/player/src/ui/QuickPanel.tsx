import { alpha, Box, Popover, Typography } from '@mui/material'
import { type ReactNode, useEffect, useId, useState } from 'react'
import { usePlayerStore } from '@/store/playerStore'
import {
  hardShadow,
  INK,
  LINE_STRONG,
  MONO,
  PAPER,
  VERMILION,
} from '@/theme/theme'

const HARD_CUT = 'background-color 100ms steps(1), color 100ms steps(1)'

export interface FeatureSplitButtonProps {
  /** Single glyph shown before the label (弾 / 字 / 超). */
  glyph: string
  label: string
  /** Main half: is the feature on right now. */
  on: boolean
  /** Main half click. Omit to make the whole button open the panel. */
  onToggle?: () => void
  /** Extra line under the label on the main half (mono, small). */
  status?: ReactNode
  /** Tint the main half vermilion (a running job / an active pipeline). */
  busy?: boolean
  /** Accessible name of the main half. */
  toggleLabel: string
  /** Panel title and the kicker above it. */
  panelTitle: string
  panelKicker: string
  /** Settings section the 「更多设置」 link jumps to. */
  settingsSection: string
  /** Panel body; receives a close() so an action can dismiss the panel. */
  children: (close: () => void) => ReactNode
}

export const FeatureSplitButton = ({
  glyph,
  label,
  on,
  onToggle,
  status,
  busy = false,
  toggleLabel,
  panelTitle,
  panelKicker,
  settingsSection,
  children,
}: FeatureSplitButtonProps) => {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const openSettingsAt = usePlayerStore((s) => s.openSettingsAt)
  const blocked = usePlayerStore((s) => s.settingsOpen || s.danmakuDialogOpen)
  const panelId = useId()
  const open = Boolean(anchor) && !blocked
  const close = () => setAnchor(null)

  useEffect(() => {
    if (blocked) setAnchor(null)
  }, [blocked])

  const lit = on || busy
  const frame = busy ? VERMILION : lit ? PAPER : alpha(PAPER, 0.6)

  return (
    <>
      <Box
        data-feature-button={settingsSection}
        sx={{
          display: 'flex',
          alignItems: 'stretch',
          flexShrink: 0,
          border: `2px solid ${frame}`,
          background: busy ? alpha(VERMILION, 0.12) : 'transparent',
          boxShadow: open ? hardShadow(3) : 'none',
        }}
      >
        <Box
          component="button"
          type="button"
          aria-label={toggleLabel}
          aria-pressed={onToggle ? on : undefined}
          aria-haspopup={onToggle ? undefined : 'dialog'}
          aria-expanded={onToggle ? undefined : open}
          aria-controls={!onToggle && open ? panelId : undefined}
          onClick={(e: React.MouseEvent<HTMLElement>) => {
            if (onToggle) onToggle()
            else setAnchor(e.currentTarget.parentElement)
          }}
          sx={{
            appearance: 'none',
            border: 0,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            padding: status ? '3px 10px 4px' : '8px 10px',
            cursor: 'pointer',
            whiteSpace: 'nowrap',
            background: lit && !busy ? PAPER : 'transparent',
            color: lit && !busy ? INK : PAPER,
            transition: HARD_CUT,
            '&:hover': { background: VERMILION, color: PAPER },
          }}
        >
          <Box
            component="span"
            sx={{ fontSize: 13, fontWeight: 700, lineHeight: 1.2 }}
          >
            {glyph} {label}
          </Box>
          {status && (
            <Box
              component="span"
              sx={{
                fontFamily: MONO,
                fontSize: 9,
                fontWeight: 700,
                letterSpacing: '0.06em',
                lineHeight: 1.2,
                opacity: 0.75,
              }}
            >
              {status}
            </Box>
          )}
        </Box>
        <Box
          component="button"
          type="button"
          aria-label={`${label}快捷设置`}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={open ? panelId : undefined}
          onClick={(e: React.MouseEvent<HTMLElement>) =>
            setAnchor(open ? null : e.currentTarget.parentElement)
          }
          sx={{
            appearance: 'none',
            border: 0,
            borderLeft: `2px solid ${frame}`,
            width: 22,
            padding: 0,
            cursor: 'pointer',
            fontSize: 9,
            background: open ? VERMILION : 'transparent',
            color: open ? PAPER : lit && !busy ? INK : PAPER,
            ...(lit && !busy && !open && { background: PAPER }),
            transition: HARD_CUT,
            '&:hover': { background: VERMILION, color: PAPER },
          }}
        >
          ▲
        </Box>
      </Box>

      <Popover
        open={open}
        anchorEl={anchor}
        onClose={close}
        disableRestoreFocus={blocked}
        anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
        transformOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        slotProps={{
          paper: {
            id: panelId,
            role: 'dialog',
            'aria-label': panelTitle,
            'data-quick-panel': settingsSection,
            sx: {
              marginTop: '-10px',
              width: 340,
              maxHeight: 'min(560px, calc(100vh - 150px))',
              display: 'flex',
              flexDirection: 'column',
              background: INK,
              backgroundImage: 'none',
              border: LINE_STRONG,
              borderRadius: 0,
              boxShadow: hardShadow(6),
            },
          } as object,
        }}
      >
        <Box
          sx={{
            padding: '10px 14px 8px',
            borderBottom: `2px solid ${alpha(PAPER, 0.25)}`,
            flexShrink: 0,
          }}
        >
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
            {panelKicker}
          </Typography>
          <Typography
            component="span"
            sx={{ fontSize: 15, fontWeight: 900, color: PAPER }}
          >
            {panelTitle}
          </Typography>
        </Box>

        <Box
          sx={{
            padding: '12px 14px',
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
          }}
        >
          {children(close)}
        </Box>

        <Box
          component="button"
          type="button"
          onClick={() => {
            close()
            openSettingsAt(settingsSection)
          }}
          sx={{
            appearance: 'none',
            flexShrink: 0,
            border: 0,
            borderTop: `2px solid ${alpha(PAPER, 0.25)}`,
            background: 'transparent',
            color: alpha(PAPER, 0.7),
            padding: '9px 14px',
            fontSize: 12,
            fontWeight: 700,
            textAlign: 'right',
            cursor: 'pointer',
            transition: HARD_CUT,
            '&:hover': { background: PAPER, color: INK },
          }}
        >
          更多设置 →
        </Box>
      </Popover>
    </>
  )
}

/** Labeled row inside a quick panel: text on the left, control on the right. */
export const QuickRow = ({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: ReactNode
}) => (
  <Box
    sx={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: '12px',
    }}
  >
    <Box sx={{ minWidth: 0 }}>
      <Typography sx={{ fontSize: 12, fontWeight: 700, color: PAPER }}>
        {label}
      </Typography>
      {hint && (
        <Typography
          sx={{
            fontSize: 10,
            fontWeight: 700,
            color: alpha(PAPER, 0.5),
            lineHeight: 1.4,
          }}
        >
          {hint}
        </Typography>
      )}
    </Box>
    {children}
  </Box>
)

/** Thin rule between groups inside a quick panel. */
export const QuickDivider = () => (
  <Box sx={{ borderTop: `1px dashed ${alpha(PAPER, 0.2)}` }} />
)

/** Full-width outlined action inside a quick panel. */
export const QuickAction = ({
  children,
  onClick,
  disabled = false,
  danger = false,
}: {
  children: ReactNode
  onClick: () => void
  disabled?: boolean
  danger?: boolean
}) => (
  <Box
    component="button"
    type="button"
    disabled={disabled}
    onClick={onClick}
    sx={{
      appearance: 'none',
      flex: 1,
      minWidth: 0,
      border: `2px solid ${danger ? alpha(VERMILION, 0.8) : alpha(PAPER, 0.5)}`,
      background: 'transparent',
      color: danger ? VERMILION : PAPER,
      padding: '7px 8px',
      fontSize: 12,
      fontWeight: 700,
      cursor: 'pointer',
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      transition: HARD_CUT,
      '&:hover': danger
        ? { background: VERMILION, color: PAPER }
        : { background: PAPER, color: INK },
      '&:disabled': {
        opacity: 0.35,
        cursor: 'default',
        background: 'transparent',
        color: danger ? VERMILION : PAPER,
      },
    }}
  >
    {children}
  </Box>
)

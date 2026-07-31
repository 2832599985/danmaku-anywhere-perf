import { Box, Stack, Typography } from '@mui/material'
import { alpha } from '@mui/material/styles'
import type { ReactNode } from 'react'
import {
  hardShadow,
  INK,
  LINE_STRONG,
  MONO,
  PAPER,
  VERMILION,
} from '@/theme/theme'

/**
 * 墨线 (ink) atoms — the comic-style replacements for MUI ToggleButtonGroup /
 * Switch / Slider, plus the rotated stamp badge and the 振假名-style two-line
 * label. Every hover is a hard cut (steps(1)), never an ease.
 */

const HARD_CUT = 'background-color 100ms steps(1), color 100ms steps(1)'

// ---------------------------------------------------------------------------

interface InkLabelProps {
  /** Chinese main label, 900 weight. */
  zh: string
  /** English mono micro-label rendered under it (振假名 style). */
  en?: string
  size?: number
}

/** Two-line label: 中文 900 on top, tracked mono english below. */
export const InkLabel = ({ zh, en, size = 13 }: InkLabelProps) => (
  <Box sx={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
    <Typography
      component="span"
      sx={{
        fontSize: size,
        fontWeight: 900,
        color: PAPER,
        letterSpacing: '0.08em',
        lineHeight: 1.3,
      }}
    >
      {zh}
    </Typography>
    {en && (
      <Typography
        component="span"
        sx={{
          fontFamily: MONO,
          fontSize: 9,
          letterSpacing: '0.16em',
          color: alpha(PAPER, 0.45),
          lineHeight: 1.4,
          textTransform: 'uppercase',
          whiteSpace: 'nowrap',
        }}
      >
        {en}
      </Typography>
    )}
  </Box>
)

// ---------------------------------------------------------------------------

export interface InkOption<T extends string | number> {
  value: T
  label: ReactNode
  /** use the mono font for this option (numbers, mode letters). */
  mono?: boolean
}

interface InkToggleGroupProps<T extends string | number> {
  options: readonly InkOption<T>[]
  value: T
  onChange: (value: T) => void
  columns?: number
  disabled?: boolean
  /** paint the selected cell vermilion instead of paper (半填充 variant). */
  accent?: boolean
}

/**
 * The grid toggle: unselected = 2px weak stroke, selected = paper fill + ink
 * text + 3px vermilion hard shadow (or vermilion half-fill with accent).
 */
export const InkToggleGroup = <T extends string | number>({
  options,
  value,
  onChange,
  columns = options.length,
  disabled = false,
  accent = false,
}: InkToggleGroupProps<T>) => (
  <Box
    sx={{
      display: 'grid',
      gridTemplateColumns: `repeat(${columns}, 1fr)`,
      gap: '6px',
      opacity: disabled ? 0.4 : 1,
      pointerEvents: disabled ? 'none' : 'auto',
    }}
  >
    {options.map((opt) => {
      const selected = opt.value === value
      return (
        <Box
          key={String(opt.value)}
          component="button"
          type="button"
          onClick={() => onChange(opt.value)}
          sx={{
            appearance: 'none',
            cursor: 'pointer',
            padding: '7px 0',
            fontFamily: opt.mono ? MONO : 'inherit',
            fontSize: opt.mono ? 12 : 11,
            fontWeight: selected ? 900 : 700,
            letterSpacing: '0.02em',
            transition: HARD_CUT,
            ...(selected
              ? accent
                ? {
                    border: `2px solid ${VERMILION}`,
                    background: alpha(VERMILION, 0.16),
                    color: PAPER,
                  }
                : {
                    border: LINE_STRONG,
                    background: PAPER,
                    color: INK,
                    boxShadow: hardShadow(3),
                  }
              : {
                  border: `2px solid ${alpha(PAPER, 0.3)}`,
                  background: 'transparent',
                  color: alpha(PAPER, 0.75),
                  '&:hover': { borderColor: PAPER, color: PAPER },
                }),
          }}
        >
          {opt.label}
        </Box>
      )
    })}
  </Box>
)

// ---------------------------------------------------------------------------

interface InkSwitchProps {
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
  /** accessibility name. */
  label?: string
}

/** The ON | OFF two-cell switch. Active cell fills vermilion. */
export const InkSwitch = ({
  checked,
  onChange,
  disabled = false,
  label,
}: InkSwitchProps) => (
  <Box
    component="button"
    type="button"
    role="switch"
    aria-checked={checked}
    aria-label={label}
    disabled={disabled}
    onClick={() => onChange(!checked)}
    sx={{
      appearance: 'none',
      display: 'flex',
      padding: 0,
      border: LINE_STRONG,
      background: 'transparent',
      cursor: 'pointer',
      opacity: disabled ? 0.4 : 1,
      flexShrink: 0,
    }}
  >
    {(['ON', 'OFF'] as const).map((cell) => {
      const active = (cell === 'ON') === checked
      return (
        <Box
          key={cell}
          component="span"
          sx={{
            fontFamily: MONO,
            fontSize: 11,
            fontWeight: 700,
            padding: '4px 9px',
            transition: HARD_CUT,
            background: active ? VERMILION : 'transparent',
            color: active ? PAPER : alpha(PAPER, 0.4),
          }}
        >
          {cell}
        </Box>
      )
    })}
  </Box>
)

// ---------------------------------------------------------------------------

interface InkSliderProps {
  value: number
  min: number
  max: number
  step: number
  onChange: (value: number) => void
  /** draw a центр-zero tick (offset sliders). */
  centerTick?: boolean
  'aria-label'?: string
}

/**
 * Rectangular slider: 10px track with 2px paper stroke, paper fill for the
 * played part, 8×22 vermilion block thumb. Pointer-driven (no MUI Slider).
 */
export const InkSlider = ({
  value,
  min,
  max,
  step,
  onChange,
  centerTick = false,
  'aria-label': ariaLabel,
}: InkSliderProps) => {
  const ratio = max > min ? (value - min) / (max - min) : 0

  const commit = (clientX: number, el: HTMLElement) => {
    const rect = el.getBoundingClientRect()
    if (rect.width <= 0) return
    const r = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
    const raw = min + r * (max - min)
    const snapped = Math.round(raw / step) * step
    // avoid float drift (0.30000000000000004)
    const decimals = `${step}`.split('.')[1]?.length ?? 0
    onChange(Math.min(max, Math.max(min, Number(snapped.toFixed(decimals)))))
  }

  return (
    <Box
      role="slider"
      aria-label={ariaLabel}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      tabIndex={0}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId)
        commit(e.clientX, e.currentTarget)
      }}
      onPointerMove={(e) => {
        if (e.buttons & 1) commit(e.clientX, e.currentTarget)
      }}
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
          e.preventDefault()
          onChange(Math.max(min, value - step))
        } else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
          e.preventDefault()
          onChange(Math.min(max, value + step))
        }
      }}
      sx={{
        position: 'relative',
        height: 10,
        border: LINE_STRONG,
        background: INK,
        cursor: 'pointer',
        touchAction: 'none',
        userSelect: 'none',
        // enlarge the hit area without changing the drawn track
        '&::before': { content: '""', position: 'absolute', inset: -8 },
        '&:focus-visible': { outline: `2px solid ${VERMILION}` },
      }}
    >
      {/* fill */}
      <Box
        sx={{
          position: 'absolute',
          left: 0,
          top: 0,
          bottom: 0,
          width: `${ratio * 100}%`,
          background: PAPER,
        }}
      />
      {centerTick && (
        <Box
          sx={{
            position: 'absolute',
            left: '50%',
            top: -3,
            bottom: -3,
            width: 2,
            background: alpha(PAPER, 0.4),
          }}
        />
      )}
      {/* thumb */}
      <Box
        sx={{
          position: 'absolute',
          left: `${ratio * 100}%`,
          top: -6,
          bottom: -6,
          width: 8,
          background: VERMILION,
          border: LINE_STRONG,
          transform: 'translateX(-50%)',
          pointerEvents: 'none',
        }}
      />
    </Box>
  )
}

// ---------------------------------------------------------------------------

interface InkLabeledSliderProps extends InkSliderProps {
  zh: string
  en?: string
  /** formatted value at the right, mono vermilion. */
  display: string
}

/** Label row (中文 + mono en) with the value readout, then the ink slider. */
export const InkLabeledSlider = ({
  zh,
  en,
  display,
  ...slider
}: InkLabeledSliderProps) => (
  <Box sx={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
    <Stack direction="row" justifyContent="space-between" alignItems="baseline">
      <Typography component="span" sx={{ fontSize: 12, fontWeight: 700 }}>
        {zh}
        {en && (
          <Typography
            component="span"
            sx={{
              fontFamily: MONO,
              fontSize: 9,
              color: alpha(PAPER, 0.4),
              ml: '6px',
              letterSpacing: '0.16em',
              textTransform: 'uppercase',
            }}
          >
            {en}
          </Typography>
        )}
      </Typography>
      <Typography
        component="span"
        sx={{
          fontFamily: MONO,
          fontSize: 14,
          fontWeight: 700,
          color: VERMILION,
        }}
      >
        {display}
      </Typography>
    </Stack>
    <InkSlider aria-label={zh} {...slider} />
  </Box>
)

// ---------------------------------------------------------------------------

interface InkStampProps {
  children: ReactNode
  /** rotation degrees (design uses -3 to -8). */
  rotate?: number
  sx?: object
}

/** The rotated vermilion stamp (NOW / NOW PLAYING). */
export const InkStamp = ({ children, rotate = -6, sx }: InkStampProps) => (
  <Box
    component="span"
    sx={{
      background: VERMILION,
      color: PAPER,
      fontFamily: MONO,
      fontSize: 9,
      fontWeight: 700,
      padding: '2px 5px',
      transform: `rotate(${rotate}deg)`,
      border: `2px solid ${INK}`,
      display: 'inline-block',
      letterSpacing: '0.06em',
      ...sx,
    }}
  >
    {children}
  </Box>
)

// ---------------------------------------------------------------------------

interface InkSectionProps {
  zh: string
  en?: string
  action?: ReactNode
  children: ReactNode
}

/** Titled settings block: 「标题 MICRO-LABEL」 header row + content. */
export const InkSection = ({ zh, en, action, children }: InkSectionProps) => (
  <Box sx={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
    <Stack
      direction="row"
      alignItems="baseline"
      justifyContent="space-between"
      spacing={1}
    >
      <Stack direction="row" alignItems="baseline" spacing={1}>
        <Typography
          component="span"
          sx={{
            fontSize: 13,
            fontWeight: 900,
            color: PAPER,
            letterSpacing: '0.08em',
          }}
        >
          {zh}
        </Typography>
        {en && (
          <Typography
            component="span"
            sx={{
              fontFamily: MONO,
              fontSize: 9,
              letterSpacing: '0.2em',
              color: alpha(PAPER, 0.4),
              textTransform: 'uppercase',
            }}
          >
            {en}
          </Typography>
        )}
      </Stack>
      {action}
    </Stack>
    {children}
  </Box>
)

// ---------------------------------------------------------------------------

/** Blinking status dot (steps(1), comic hard blink). */
export const InkBlinkDot = ({
  color = VERMILION,
  size = 7,
}: {
  color?: string
  size?: number
}) => (
  <Box
    component="span"
    sx={{
      width: size,
      height: size,
      background: color,
      borderRadius: '50%',
      flexShrink: 0,
      animation: 'ink-blink 1.4s steps(1) infinite',
    }}
  />
)

/** Inverted (paper ground) drawer/dialog header with mono kicker. */
export const InkPanelHeader = ({
  kicker,
  zh,
  onClose,
}: {
  kicker: string
  zh: string
  onClose: () => void
}) => (
  <Stack
    direction="row"
    alignItems="center"
    justifyContent="space-between"
    sx={{
      padding: '14px 18px',
      borderBottom: LINE_STRONG,
      background: PAPER,
      flexShrink: 0,
    }}
  >
    <Box sx={{ display: 'flex', flexDirection: 'column' }}>
      <Typography
        component="span"
        sx={{
          fontFamily: MONO,
          fontSize: 9,
          letterSpacing: '0.28em',
          color: VERMILION,
          fontWeight: 700,
          textTransform: 'uppercase',
        }}
      >
        {kicker}
      </Typography>
      <Typography
        component="span"
        sx={{
          fontSize: 18,
          fontWeight: 900,
          color: INK,
          letterSpacing: '0.06em',
        }}
      >
        {zh}
      </Typography>
    </Box>
    <Box
      component="button"
      type="button"
      aria-label="关闭 / Close"
      onClick={onClose}
      sx={{
        appearance: 'none',
        width: 30,
        height: 30,
        border: `2px solid ${INK}`,
        background: 'transparent',
        color: INK,
        fontSize: 13,
        cursor: 'pointer',
        transition: HARD_CUT,
        '&:hover': {
          background: VERMILION,
          color: PAPER,
          borderColor: VERMILION,
        },
      }}
    >
      ✕
    </Box>
  </Stack>
)

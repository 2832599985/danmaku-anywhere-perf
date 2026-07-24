import { Box, Slider, Stack, Typography } from '@mui/material'
import type { ReactNode } from 'react'

/** Extract a human-readable message from an unknown thrown value. */
export const errorMessage = (e: unknown): string => {
  if (e instanceof Error) return e.message
  if (typeof e === 'string') return e
  try {
    return String(e)
  } catch {
    return '未知错误 / Unknown error'
  }
}

interface PanelSectionProps {
  label: string
  hint?: string
  action?: ReactNode
  children: ReactNode
}

/** A titled block used throughout the settings panels. */
export const PanelSection = ({
  label,
  hint,
  action,
  children,
}: PanelSectionProps) => (
  <Stack spacing={1}>
    <Stack
      direction="row"
      alignItems="center"
      justifyContent="space-between"
      spacing={1}
    >
      <Box>
        <Typography
          variant="caption"
          sx={{
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            fontWeight: 700,
            color: 'text.secondary',
          }}
        >
          {label}
        </Typography>
        {hint && (
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ display: 'block', mt: 0.25, opacity: 0.8 }}
          >
            {hint}
          </Typography>
        )}
      </Box>
      {action}
    </Stack>
    {children}
  </Stack>
)

interface LabeledSliderProps {
  label: string
  /** Formatted value shown at the right of the label row. */
  display: string
  value: number
  min: number
  max: number
  step: number
  onChange: (value: number) => void
}

/** Label + value readout + MUI slider — the danmaku settings workhorse. */
export const LabeledSlider = ({
  label,
  display,
  value,
  min,
  max,
  step,
  onChange,
}: LabeledSliderProps) => (
  <Box>
    <Stack
      direction="row"
      alignItems="baseline"
      justifyContent="space-between"
      sx={{ mb: 0.25 }}
    >
      <Typography variant="body2" sx={{ fontWeight: 600 }}>
        {label}
      </Typography>
      <Typography
        variant="caption"
        color="primary.light"
        sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: 700 }}
      >
        {display}
      </Typography>
    </Stack>
    <Slider
      size="small"
      value={value}
      min={min}
      max={max}
      step={step}
      onChange={(_, v) => onChange(Array.isArray(v) ? v[0] : v)}
    />
  </Box>
)

import { useTheme } from '@mui/material'
import { useMemo } from 'react'
import type { TypeDistribution } from './statsUtils'

interface PieChartProps {
  data: TypeDistribution
  labels: Record<keyof TypeDistribution, string>
  size?: number
}

const COLORS = [
  'var(--da-pie-0, #8b5cf6)',
  'var(--da-pie-1, #d946ef)',
  'var(--da-pie-2, #06b6d4)',
  'var(--da-pie-3, #f59e0b)',
]

export const PieChart = ({ data, labels, size = 140 }: PieChartProps) => {
  const theme = useTheme()

  const slices = useMemo(() => {
    const allEntries: { key: keyof TypeDistribution; value: number }[] = [
      { key: 'rtl', value: data.rtl },
      { key: 'top', value: data.top },
      { key: 'bottom', value: data.bottom },
      { key: 'ltr', value: data.ltr },
    ]
    const entries = allEntries.filter((e) => e.value > 0)

    const total = entries.reduce((sum, e) => sum + e.value, 0)
    if (total === 0) return []

    const r = size / 2 - 4
    const cx = size / 2
    const cy = size / 2
    let startAngle = -Math.PI / 2

    return entries.map((entry, i) => {
      const fraction = entry.value / total
      const angle = fraction * 2 * Math.PI
      const endAngle = startAngle + angle
      const largeArc = angle > Math.PI ? 1 : 0

      const x1 = cx + r * Math.cos(startAngle)
      const y1 = cy + r * Math.sin(startAngle)
      const x2 = cx + r * Math.cos(endAngle)
      const y2 = cy + r * Math.sin(endAngle)

      // Label position at midpoint
      const midAngle = startAngle + angle / 2
      const labelR = r * 0.65
      const lx = cx + labelR * Math.cos(midAngle)
      const ly = cy + labelR * Math.sin(midAngle)

      const path =
        entries.length === 1
          ? // Full circle
            [
              `M ${cx - r} ${cy}`,
              `A ${r} ${r} 0 1 1 ${cx + r} ${cy}`,
              `A ${r} ${r} 0 1 1 ${cx - r} ${cy}`,
              'Z',
            ].join(' ')
          : [
              `M ${cx} ${cy}`,
              `L ${x1} ${y1}`,
              `A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2}`,
              'Z',
            ].join(' ')

      startAngle = endAngle

      return {
        key: entry.key,
        path,
        color: COLORS[i % COLORS.length],
        label: labels[entry.key],
        percent: `${(fraction * 100).toFixed(1)}%`,
        lx,
        ly,
        showLabel: fraction > 0.08,
      }
    })
  }, [data, labels, size])

  if (slices.length === 0) return null

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      style={{ display: 'block', margin: '0 auto' }}
    >
      {slices.map((s) => (
        <path
          key={s.key}
          d={s.path}
          fill={s.color}
          stroke={theme.palette.background.default}
          strokeWidth={1.5}
        />
      ))}
      {slices.map(
        (s) =>
          s.showLabel && (
            <text
              key={`label-${s.key}`}
              x={s.lx}
              y={s.ly}
              textAnchor="middle"
              dominantBaseline="central"
              fill="#fff"
              fontSize={10}
              fontWeight={600}
              style={{ pointerEvents: 'none' }}
            >
              {s.percent}
            </text>
          )
      )}
    </svg>
  )
}

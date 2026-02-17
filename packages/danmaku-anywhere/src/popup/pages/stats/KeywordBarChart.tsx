import { useTheme } from '@mui/material'
import { useMemo } from 'react'
import type { KeywordEntry } from './statsUtils'

interface KeywordBarChartProps {
  data: KeywordEntry[]
  width?: number
  height?: number
}

export const KeywordBarChart = ({
  data,
  width = 300,
  height = 200,
}: KeywordBarChartProps) => {
  const theme = useTheme()

  const layout = useMemo(() => {
    if (data.length === 0) return null

    const maxCount = data.reduce((m, d) => Math.max(m, d.count), 0)
    const paddingLeft = 50
    const paddingRight = 10
    const paddingTop = 5
    const paddingBottom = 5
    const barAreaWidth = width - paddingLeft - paddingRight
    const barAreaHeight = height - paddingTop - paddingBottom
    const barHeight = Math.min(18, barAreaHeight / data.length - 2)
    const gap = (barAreaHeight - barHeight * data.length) / (data.length + 1)

    return data.map((entry, i) => {
      const y = paddingTop + gap * (i + 1) + barHeight * i
      const barWidth =
        maxCount > 0 ? (entry.count / maxCount) * barAreaWidth : 0
      return {
        word: entry.word,
        count: entry.count,
        x: paddingLeft,
        y,
        barWidth,
        barHeight,
      }
    })
  }, [data, width, height])

  if (!layout || layout.length === 0) return null

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      style={{ display: 'block', width: '100%', height: 'auto' }}
    >
      {layout.map((bar) => (
        <g key={bar.word}>
          <text
            x={bar.x - 6}
            y={bar.y + bar.barHeight / 2}
            textAnchor="end"
            dominantBaseline="central"
            fill={theme.palette.text.secondary}
            fontSize={11}
          >
            {bar.word}
          </text>
          <rect
            x={bar.x}
            y={bar.y}
            width={Math.max(2, bar.barWidth)}
            height={bar.barHeight}
            rx={3}
            fill={'url(#bar-gradient)'}
            opacity={0.85}
          />
          <text
            x={bar.x + bar.barWidth + 5}
            y={bar.y + bar.barHeight / 2}
            dominantBaseline="central"
            fill={theme.palette.text.disabled}
            fontSize={10}
          >
            {bar.count}
          </text>
        </g>
      ))}
      <defs>
        <linearGradient id="bar-gradient" x1="0" y1="0" x2="1" y2="0">
          <stop
            offset="0%"
            stopColor={theme.palette.primary.main}
            stopOpacity={0.9}
          />
          <stop
            offset="100%"
            stopColor={theme.palette.secondary.main}
            stopOpacity={0.7}
          />
        </linearGradient>
      </defs>
    </svg>
  )
}

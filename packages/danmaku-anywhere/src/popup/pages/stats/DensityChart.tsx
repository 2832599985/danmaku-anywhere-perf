import { useTheme } from '@mui/material'
import * as d3 from 'd3'
import { useMemo } from 'react'
import type { DensityBin } from './statsUtils'

interface DensityChartProps {
  data: DensityBin[]
  width?: number
  height?: number
}

export const DensityChart = ({
  data,
  width = 300,
  height = 80,
}: DensityChartProps) => {
  const theme = useTheme()

  const path = useMemo(() => {
    if (data.length === 0) return ''

    const maxTime = data[data.length - 1].time
    if (maxTime <= 0) return ''

    const padX = 0
    const padY = 4
    const w = width - padX * 2
    const h = height - padY * 2

    const x = d3
      .scaleLinear()
      .domain([0, maxTime])
      .range([padX, padX + w])
    const y = d3
      .scaleLinear()
      .domain([0, 1])
      .range([padY + h, padY])

    const padded = [
      { time: 0, value: 0, count: 0 },
      ...data,
      { time: maxTime, value: 0, count: 0 },
    ]

    const area = d3
      .area<(typeof padded)[0]>()
      .x((d) => x(d.time))
      .y0(() => y(0))
      .y1((d) => y(d.value))
      .curve(d3.curveMonotoneX)

    return area(padded) ?? ''
  }, [data, width, height])

  if (!path) return null

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      style={{ display: 'block', width: '100%', height: 'auto' }}
    >
      <defs>
        <linearGradient id="density-fill" x1="0" y1="0" x2="0" y2="1">
          <stop
            offset="0%"
            stopColor={theme.palette.primary.main}
            stopOpacity={0.6}
          />
          <stop
            offset="100%"
            stopColor={theme.palette.primary.main}
            stopOpacity={0.05}
          />
        </linearGradient>
      </defs>
      <path d={path} fill="url(#density-fill)" />
      <path
        d={path}
        fill="none"
        stroke={theme.palette.primary.main}
        strokeWidth={1.5}
        opacity={0.8}
      />
    </svg>
  )
}

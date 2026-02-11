import * as d3 from 'd3'
import { buildDensityAreaPath } from '@/content/player/densityPlot/buildDensityAreaPath'
import type {
  DensityPoint,
  SkipRegion,
} from '@/content/player/densityPlot/types'

export interface DanmakuDensityChartOptions {
  height?: number
  colors?: {
    unplayed?: string
    played?: string
  }
  opacity?: number
}

export class DanmakuDensityChart {
  private readonly wrapper: HTMLElement
  private readonly clipId =
    `danmaku-density-clip-${Math.random().toString(36).slice(2)}`

  private options: {
    height: number
    colors: { unplayed: string; played: string }
    opacity: number
  }

  private svg: d3.Selection<SVGSVGElement, unknown, null, undefined> | null =
    null
  private pathUnplayed: d3.Selection<
    SVGPathElement,
    unknown,
    null,
    undefined
  > | null = null
  private pathPlayed: d3.Selection<
    SVGPathElement,
    unknown,
    null,
    undefined
  > | null = null
  private clipRect: d3.Selection<
    SVGRectElement,
    unknown,
    null,
    undefined
  > | null = null
  private skipRegionGroup: d3.Selection<
    SVGGElement,
    unknown,
    null,
    undefined
  > | null = null
  private legendGroup: d3.Selection<
    SVGGElement,
    unknown,
    null,
    undefined
  > | null = null

  private data: DensityPoint[] = []
  private duration = 0
  private lastCurrentTime = 0
  private skipRegions: SkipRegion[] = []

  constructor(wrapper: HTMLElement, options: DanmakuDensityChartOptions = {}) {
    this.wrapper = wrapper
    this.options = {
      height: options.height ?? 28,
      colors: {
        unplayed: options.colors?.unplayed ?? 'rgba(255,255,255,0.25)',
        played: options.colors?.played ?? 'rgba(255,255,255,0.6)',
      },
      opacity: options.opacity ?? 1,
    }
  }

  private getCssVar(name: string, fallback: string): string {
    const value = getComputedStyle(this.wrapper).getPropertyValue(name).trim()
    return value || fallback
  }

  setup() {
    if (this.svg) {
      return
    }

    const svg = d3
      .select(this.wrapper)
      .append('svg')
      .classed('da-density-chart', true)
      .attr('width', '100%')
      .attr('height', this.options.height)
      .attr('opacity', this.options.opacity)

    const defs = svg.append('defs')
    const clip = defs.append('clipPath').attr('id', this.clipId)
    const clipRect = clip
      .append('rect')
      .attr('x', 0)
      .attr('y', 0)
      .attr('width', 0)
      .attr('height', this.options.height)

    // Skip region overlays (rendered below density paths)
    const skipRegionGroup = svg.append('g').classed('da-skip-regions', true)

    const unplayedColor = this.getCssVar(
      '--da-density-unplayed',
      this.options.colors.unplayed
    )
    const playedColor = this.getCssVar(
      '--da-density-played',
      this.options.colors.played
    )

    const pathUnplayed = svg.append('path').attr('fill', unplayedColor)

    const pathPlayed = svg
      .append('path')
      .attr('fill', playedColor)
      .attr('clip-path', `url(#${this.clipId})`)

    // Legend group (rendered on top)
    const legendGroup = svg.append('g').classed('da-skip-legend', true)

    this.svg = svg
    this.pathUnplayed = pathUnplayed
    this.pathPlayed = pathPlayed
    this.clipRect = clipRect
    this.skipRegionGroup = skipRegionGroup
    this.legendGroup = legendGroup
  }

  teardown() {
    this.svg?.remove()
    this.svg = null
    this.pathUnplayed = null
    this.pathPlayed = null
    this.clipRect = null
    this.skipRegionGroup = null
    this.legendGroup = null
  }

  setOptions(options: DanmakuDensityChartOptions) {
    const next = {
      height: options.height ?? this.options.height,
      colors: {
        unplayed: options.colors?.unplayed ?? this.options.colors.unplayed,
        played: options.colors?.played ?? this.options.colors.played,
      },
      opacity: options.opacity ?? this.options.opacity,
    }
    const heightChanged = next.height !== this.options.height
    const colorsChanged =
      next.colors.unplayed !== this.options.colors.unplayed ||
      next.colors.played !== this.options.colors.played
    const opacityChanged = next.opacity !== this.options.opacity

    this.options = next

    if (this.svg && heightChanged) {
      this.svg.attr('height', this.options.height)
      this.clipRect?.attr('height', this.options.height)
      this.redraw()
    }
    if (colorsChanged) {
      if (this.pathUnplayed)
        this.pathUnplayed.attr('fill', this.options.colors.unplayed)
      if (this.pathPlayed)
        this.pathPlayed.attr('fill', this.options.colors.played)
    }
    if (this.svg && opacityChanged) {
      this.svg.attr('opacity', this.options.opacity)
    }
  }

  updateData(data: DensityPoint[], duration: number) {
    this.data = data
    this.duration = duration
    this.redraw()
  }

  updateSkipRegions(regions: SkipRegion[]) {
    this.skipRegions = regions
    this.drawSkipRegions()
  }

  updateProgress(currentTime: number) {
    this.lastCurrentTime = currentTime
    if (
      !this.svg ||
      !this.clipRect ||
      !Number.isFinite(this.duration) ||
      this.duration <= 0
    ) {
      return
    }
    const { width } = this.getSvgSize()
    const playedRatio = Math.min(1, Math.max(0, currentTime / this.duration))
    const clipWidth = Math.round(width * playedRatio)
    this.clipRect.attr('width', clipWidth)
  }

  show() {
    this.svg?.classed('da-density-chart-visible', true)
  }

  hide() {
    this.svg?.classed('da-density-chart-visible', false)
  }

  private getSvgSize(): { width: number; height: number } {
    const width =
      (this.svg?.node() as SVGSVGElement | null)?.clientWidth ||
      this.wrapper.clientWidth

    return { width, height: this.options.height }
  }

  redraw() {
    if (!this.svg) {
      return
    }

    this.svg.attr('height', this.options.height)
    this.clipRect?.attr('height', this.options.height)

    if (!this.pathUnplayed || !this.pathPlayed) {
      return
    }

    const { width } = this.getSvgSize()

    const d = buildDensityAreaPath(
      this.data,
      width,
      this.options.height,
      this.duration
    )

    this.pathUnplayed.attr('d', d)
    this.pathPlayed.attr('d', d)

    this.drawSkipRegions()
    this.updateProgress(this.lastCurrentTime)
  }

  private drawSkipRegions() {
    if (!this.skipRegionGroup || !this.legendGroup || !this.svg) {
      return
    }

    // Clear previous regions and legend
    this.skipRegionGroup.selectAll('*').remove()
    this.legendGroup.selectAll('*').remove()

    if (
      this.skipRegions.length === 0 ||
      !Number.isFinite(this.duration) ||
      this.duration <= 0
    ) {
      return
    }

    const { width, height } = this.getSvgSize()
    if (width <= 0) return

    const opColor = this.getCssVar(
      '--da-region-op-fill',
      'rgba(96, 165, 250, 0.35)'
    )
    const edColor = this.getCssVar(
      '--da-region-ed-fill',
      'rgba(251, 113, 133, 0.35)'
    )
    const opBorderColor = this.getCssVar(
      '--da-region-op-border',
      'rgba(96, 165, 250, 0.7)'
    )
    const edBorderColor = this.getCssVar(
      '--da-region-ed-border',
      'rgba(251, 113, 133, 0.7)'
    )

    for (const region of this.skipRegions) {
      const x1 = Math.max(0, (region.startTime / this.duration) * width)
      const x2 = Math.min(width, (region.endTime / this.duration) * width)
      const regionWidth = x2 - x1

      if (regionWidth < 1) continue

      const isOp = region.type === 'op'
      const fillColor = isOp ? opColor : edColor
      const borderColor = isOp ? opBorderColor : edBorderColor

      // Overlay rectangle
      this.skipRegionGroup
        .append('rect')
        .attr('x', x1)
        .attr('y', 0)
        .attr('width', regionWidth)
        .attr('height', height)
        .attr('fill', fillColor)
        .attr('stroke', borderColor)
        .attr('stroke-width', 1)
        .classed('da-skip-region', true)
        .classed(isOp ? 'da-skip-region-op' : 'da-skip-region-ed', true)

      // Label inside region (only if wide enough)
      if (regionWidth > 24) {
        this.skipRegionGroup
          .append('text')
          .attr('x', x1 + regionWidth / 2)
          .attr('y', height / 2)
          .attr('text-anchor', 'middle')
          .attr('dominant-baseline', 'central')
          .attr('fill', isOp ? opBorderColor : edBorderColor)
          .attr('font-size', '10px')
          .attr('font-family', 'sans-serif')
          .attr('pointer-events', 'none')
          .text(isOp ? 'OP' : 'ED')
      }
    }

    // Draw legend in top-right corner
    this.drawLegend(width)
  }

  private drawLegend(svgWidth: number) {
    if (!this.legendGroup || this.skipRegions.length === 0) return

    const hasOp = this.skipRegions.some((r) => r.type === 'op')
    const hasEd = this.skipRegions.some((r) => r.type === 'ed')

    if (!hasOp && !hasEd) return

    const items: Array<{ label: string; color: string }> = []
    if (hasOp)
      items.push({
        label: 'OP',
        color: this.getCssVar(
          '--da-region-op-border',
          'rgba(96, 165, 250, 0.7)'
        ),
      })
    if (hasEd)
      items.push({
        label: 'ED',
        color: this.getCssVar(
          '--da-region-ed-border',
          'rgba(251, 113, 133, 0.7)'
        ),
      })

    const itemWidth = 30
    const totalWidth = items.length * itemWidth
    const startX = svgWidth - totalWidth - 4
    const y = 4

    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      const x = startX + i * itemWidth

      this.legendGroup
        .append('rect')
        .attr('x', x)
        .attr('y', y)
        .attr('width', 8)
        .attr('height', 8)
        .attr('rx', 1)
        .attr('fill', item.color)

      this.legendGroup
        .append('text')
        .attr('x', x + 11)
        .attr('y', y + 4)
        .attr('dominant-baseline', 'central')
        .attr('fill', 'rgba(255, 255, 255, 0.8)')
        .attr('font-size', '9px')
        .attr('font-family', 'sans-serif')
        .attr('pointer-events', 'none')
        .text(item.label)
    }
  }
}

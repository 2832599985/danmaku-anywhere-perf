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

export interface DensityTooltipInfo {
  /** X position relative to the SVG element */
  x: number
  /** Y position relative to the SVG element (top of svg) */
  y: number
  /** Time in seconds at cursor position */
  time: number
  /** Comment count at cursor position */
  count: number
}

export type TooltipCallback = (info: DensityTooltipInfo | null) => void
export type SeekCallback = (time: number) => void

export class DanmakuDensityChart {
  private readonly wrapper: HTMLElement
  private readonly clipId =
    `danmaku-density-clip-${Math.random().toString(36).slice(2)}`
  private readonly gradientId =
    `danmaku-density-grad-${Math.random().toString(36).slice(2)}`

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
  private progressLine: d3.Selection<
    SVGLineElement,
    unknown,
    null,
    undefined
  > | null = null
  private hoverLine: d3.Selection<
    SVGLineElement,
    unknown,
    null,
    undefined
  > | null = null
  private interactionRect: d3.Selection<
    SVGRectElement,
    unknown,
    null,
    undefined
  > | null = null

  private data: DensityPoint[] = []
  private duration = 0
  private lastCurrentTime = 0
  private skipRegions: SkipRegion[] = []

  private tooltipCallback: TooltipCallback | null = null
  private seekCallback: SeekCallback | null = null

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

  /** Reduce opacity of a color to create a dimmer version. Accepts hex
   * (#rgb / #rrggbb), rgb() and rgba() — the injected --da-primary is hex, so
   * an rgba-only parse would silently no-op and flatten the density band. */
  private dimColor(color: string, opacityMultiplier: number): string {
    const c = color.trim()
    const hex = c.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)
    if (hex) {
      const h = hex[1]
      const full =
        h.length === 3
          ? h
              .split('')
              .map((ch) => ch + ch)
              .join('')
          : h
      const r = Number.parseInt(full.slice(0, 2), 16)
      const g = Number.parseInt(full.slice(2, 4), 16)
      const b = Number.parseInt(full.slice(4, 6), 16)
      return `rgba(${r}, ${g}, ${b}, ${opacityMultiplier.toFixed(2)})`
    }
    const rgba = c.match(
      /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)/
    )
    if (!rgba) {
      return color
    }
    const [, r, g, b, a] = rgba
    const base = a === undefined ? 1 : Number.parseFloat(a)
    const newOpacity = (base * opacityMultiplier).toFixed(2)
    return `rgba(${r}, ${g}, ${b}, ${newOpacity})`
  }

  onTooltip(callback: TooltipCallback | null) {
    this.tooltipCallback = callback
  }

  onSeek(callback: SeekCallback | null) {
    this.seekCallback = callback
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

    // Theme-derived single-hue light band: density maps to brightness/opacity
    const gradient = defs
      .append('linearGradient')
      .attr('id', this.gradientId)
      .attr('gradientUnits', 'userSpaceOnUse')
      .attr('x1', 0)
      .attr('y1', this.options.height)
      .attr('x2', 0)
      .attr('y2', 0)

    // Read theme colors from CSS variables
    const primaryColor = this.getCssVar(
      '--da-primary',
      'rgba(139, 92, 246, 0.6)'
    )
    const secondaryColor = this.getCssVar(
      '--da-secondary',
      'rgba(217, 70, 239, 0.8)'
    )

    // Gradient: dim primary at base → bright primary → secondary bloom at peak
    gradient
      .append('stop')
      .attr('offset', '0%')
      .attr('stop-color', this.dimColor(primaryColor, 0.3))
    gradient
      .append('stop')
      .attr('offset', '55%')
      .attr('stop-color', this.dimColor(primaryColor, 0.7))
    gradient
      .append('stop')
      .attr('offset', '100%')
      .attr('stop-color', this.dimColor(secondaryColor, 0.95))

    // Diagonal hatch patterns for OP/ED regions: opposite stroke directions so
    // the two are distinguishable by texture, not hue alone (color-blind safe).
    const opHatch = defs
      .append('pattern')
      .attr('id', `${this.gradientId}-op-hatch`)
      .attr('patternUnits', 'userSpaceOnUse')
      .attr('width', 6)
      .attr('height', 6)
      .attr('patternTransform', 'rotate(45)')
    opHatch
      .append('line')
      .attr('x1', 0)
      .attr('y1', 0)
      .attr('x2', 0)
      .attr('y2', 6)
      .attr('stroke-width', 1.4)
      .classed('da-region-hatch-op', true)
    const edHatch = defs
      .append('pattern')
      .attr('id', `${this.gradientId}-ed-hatch`)
      .attr('patternUnits', 'userSpaceOnUse')
      .attr('width', 6)
      .attr('height', 6)
      .attr('patternTransform', 'rotate(-45)')
    edHatch
      .append('line')
      .attr('x1', 0)
      .attr('y1', 0)
      .attr('x2', 0)
      .attr('y2', 6)
      .attr('stroke-width', 1.4)
      .classed('da-region-hatch-ed', true)

    // Skip region overlays (rendered below density paths)
    const skipRegionGroup = svg.append('g').classed('da-skip-regions', true)

    const unplayedGradient = `url(#${this.gradientId})`
    const playedColor = this.getCssVar(
      '--da-density-played',
      this.options.colors.played
    )

    const pathUnplayed = svg.append('path').attr('fill', unplayedGradient)

    const pathPlayed = svg
      .append('path')
      .attr('fill', playedColor)
      .attr('clip-path', `url(#${this.clipId})`)

    // Legend group (rendered on top)
    const legendGroup = svg.append('g').classed('da-skip-legend', true)

    // Playback progress indicator line
    const progressLineColor = this.getCssVar(
      '--da-secondary',
      'rgba(217, 70, 239, 0.9)'
    )
    const progressLine = svg
      .append('line')
      .classed('da-density-progress-line', true)
      .attr('y1', 0)
      .attr('y2', this.options.height)
      .attr('stroke', progressLineColor)
      .attr('stroke-width', 1.5)
      .attr('pointer-events', 'none')
      .style('display', 'none')

    // Hover indicator line
    const hoverLineColor = this.getCssVar(
      '--da-primary',
      'rgba(139, 92, 246, 0.6)'
    )
    const hoverLine = svg
      .append('line')
      .classed('da-density-hover-line', true)
      .attr('y1', 0)
      .attr('y2', this.options.height)
      .attr('stroke', hoverLineColor)
      .attr('stroke-width', 1)
      .attr('pointer-events', 'none')
      .style('display', 'none')

    // Transparent interaction layer on top for mouse events
    const interactionRect = svg
      .append('rect')
      .classed('da-density-interaction', true)
      .attr('width', '100%')
      .attr('height', this.options.height)
      .attr('fill', 'transparent')
      .attr('pointer-events', 'auto')
      .style('cursor', 'pointer')

    interactionRect.on('mousemove', (event: MouseEvent) => {
      this.handleHover(event)
    })
    interactionRect.on('mouseleave', () => {
      this.handleHoverEnd()
    })
    interactionRect.on('click', (event: MouseEvent) => {
      this.handleClick(event)
    })

    this.svg = svg
    this.pathUnplayed = pathUnplayed
    this.pathPlayed = pathPlayed
    this.clipRect = clipRect
    this.skipRegionGroup = skipRegionGroup
    this.legendGroup = legendGroup
    this.progressLine = progressLine
    this.hoverLine = hoverLine
    this.interactionRect = interactionRect
  }

  teardown() {
    // Dismiss any visible tooltip before removing DOM
    this.tooltipCallback?.(null)
    this.svg?.remove()
    this.svg = null
    this.pathUnplayed = null
    this.pathPlayed = null
    this.clipRect = null
    this.skipRegionGroup = null
    this.legendGroup = null
    this.progressLine = null
    this.hoverLine = null
    this.interactionRect = null
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
      this.hoverLine?.attr('y2', this.options.height)
      this.progressLine?.attr('y2', this.options.height)
      this.interactionRect?.attr('height', this.options.height)
      this.redraw()
    }
    if (colorsChanged) {
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

    // Move progress indicator line
    if (this.progressLine) {
      this.progressLine.attr('x1', clipWidth).attr('x2', clipWidth)
      // Split branches: the string|null union defeats d3's style() overloads
      if (clipWidth > 0) {
        this.progressLine.style('display', null)
      } else {
        this.progressLine.style('display', 'none')
      }
    }
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

    // Update gradient vertical range
    this.updateGradient()

    this.drawSkipRegions()
    this.updateProgress(this.lastCurrentTime)
  }

  private updateGradient() {
    if (!this.svg) return
    this.svg
      .select(`#${this.gradientId}`)
      .attr('y1', this.options.height)
      .attr('y2', 0)
  }

  private handleHover(event: MouseEvent) {
    if (
      !this.svg ||
      !this.tooltipCallback ||
      this.data.length === 0 ||
      !Number.isFinite(this.duration) ||
      this.duration <= 0
    ) {
      return
    }

    const svgNode = this.svg.node()
    if (!svgNode) return

    const rect = svgNode.getBoundingClientRect()
    const x = event.clientX - rect.left
    const { width } = this.getSvgSize()

    if (width <= 0) return

    const ratio = Math.min(1, Math.max(0, x / width))
    const time = ratio * this.duration

    // Find the closest bin
    const bin = this.findClosestBin(time)
    const count = bin?.count ?? 0

    // Show hover line
    this.hoverLine?.attr('x1', x).attr('x2', x).style('display', null)

    this.tooltipCallback({ x, y: 0, time, count })
  }

  private handleHoverEnd() {
    this.hoverLine?.style('display', 'none')
    this.tooltipCallback?.(null)
  }

  private handleClick(event: MouseEvent) {
    if (
      !this.svg ||
      !this.seekCallback ||
      !Number.isFinite(this.duration) ||
      this.duration <= 0
    ) {
      return
    }

    const svgNode = this.svg.node()
    if (!svgNode) return

    const rect = svgNode.getBoundingClientRect()
    const x = event.clientX - rect.left
    const { width } = this.getSvgSize()

    if (width <= 0) return

    const ratio = Math.min(1, Math.max(0, x / width))
    const time = ratio * this.duration

    this.seekCallback(time)
  }

  private findClosestBin(time: number): DensityPoint | null {
    if (this.data.length === 0) return null

    let closest = this.data[0]
    let closestDist = Math.abs(closest.time - time)

    for (let i = 1; i < this.data.length; i++) {
      const dist = Math.abs(this.data[i].time - time)
      if (dist < closestDist) {
        closest = this.data[i]
        closestDist = dist
      }
    }

    return closest
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

      // Diagonal hatch overlay — texture cue on top of the fill so OP/ED read
      // apart without depending on color.
      this.skipRegionGroup
        .append('rect')
        .attr('x', x1)
        .attr('y', 0)
        .attr('width', regionWidth)
        .attr('height', height)
        .attr('fill', `url(#${this.gradientId}-${isOp ? 'op' : 'ed'}-hatch)`)
        .attr('pointer-events', 'none')

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

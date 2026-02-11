import type { CommentEntity } from '@danmaku-anywhere/danmaku-converter'
import { debounce } from '@mui/material'
import { inject, injectable } from 'inversify'
import { uiContainer } from '@/common/ioc/uiIoc'
import { type ILogger, LoggerSymbol } from '@/common/Logger'
import { ExtensionOptionsService } from '@/common/options/extensionOptions/service'
import { PerfTimer } from '@/common/utils/perf'
import { DanmakuLayoutService } from '@/content/player/danmakuLayout/DanmakuLayout.service'
import {
  filterByAdaptiveDensity,
  getAdaptiveBinSize,
} from '@/content/player/densityPlot/adaptiveDensity'
import { computeDensityBins } from '@/content/player/densityPlot/computeDensityBins'
import { DanmakuDensityChart } from '@/content/player/densityPlot/DanmakuDensityChart'
import type {
  DensityPoint,
  SkipRegion,
} from '@/content/player/densityPlot/types'
import { VideoEventService } from '@/content/player/videoEvent/VideoEvent.service'

export type DensityFilterCallback = (filtered: CommentEntity[]) => void

@injectable('Singleton')
export class DanmakuDensityService {
  private logger: ILogger
  private comments: CommentEntity[] = []
  private currentVideo: HTMLVideoElement | null = null

  private chart: DanmakuDensityChart
  private enabled = false
  private autoDensityEnabled = false

  private data: DensityPoint[] = []
  private chartHeight = 28
  private computeTimer: number | null = null
  private perfEnabled = false
  private perfTimer: PerfTimer

  private showChartTimeout: ReturnType<typeof setTimeout> | null = null
  private resizeObserver: ResizeObserver | null = null

  private densityFilterCallback: DensityFilterCallback | null = null

  private readonly boundHandleTimeUpdate: (event: Event) => void
  private readonly boundHandleSeeked: () => void
  private readonly boundHandleMouseMove: (event: MouseEvent) => void
  private readonly boundHandleResize: () => void

  constructor(
    @inject(VideoEventService)
    private readonly videoEventService: VideoEventService,
    @inject(DanmakuLayoutService)
    private readonly layoutService: DanmakuLayoutService,
    @inject(LoggerSymbol) logger: ILogger
  ) {
    this.logger = logger.sub('[DanmakuDensityService]')
    this.perfTimer = new PerfTimer(this.logger, 'densityPlot', false)
    this.boundHandleTimeUpdate = this.handleTimeUpdate.bind(this)
    this.boundHandleSeeked = this.handleSeeked.bind(this)
    this.boundHandleMouseMove = this.handleMouseMove.bind(this)
    this.boundHandleResize = debounce(this.handleResize.bind(this), 100)
    this.chart = new DanmakuDensityChart(this.layoutService.wrapper, {
      height: this.chartHeight,
      colors: {
        unplayed: 'rgba(255,255,255,0.25)',
        played: 'rgba(255, 255, 255, 0.45)',
      },
    })

    const extensionOptionsService = uiContainer.get(ExtensionOptionsService)
    extensionOptionsService
      .get()
      .then((options) => {
        this.perfEnabled = options.debug
        this.perfTimer.setEnabled(options.debug)
      })
      .catch((e) => this.logger.error(e))
    extensionOptionsService.onChange((options) => {
      this.perfEnabled = options.debug
      this.perfTimer.setEnabled(options.debug)
    })
  }

  enable() {
    // Guard prevents duplicate listeners: if already enabled, early return
    // ensures setupEventListeners() is only called once.
    if (this.enabled) {
      return
    }
    this.enabled = true
    this.logger.debug('Enabling density plot')
    this.chart.setup()
    this.scheduleCompute()
    this.setupEventListeners()
  }

  disable() {
    if (!this.enabled) {
      return
    }
    this.enabled = false
    this.logger.debug('Disabling density plot')
    if (this.computeTimer !== null) {
      window.clearTimeout(this.computeTimer)
      this.computeTimer = null
    }
    this.cleanup()
  }

  setAutoDensity(enabled: boolean) {
    if (this.autoDensityEnabled === enabled) return
    this.autoDensityEnabled = enabled
    this.logger.debug(`Auto density: ${enabled}`)
    // Re-filter when toggled while comments are loaded
    if (this.comments.length > 0) {
      this.applyDensityFilter()
    }
  }

  /**
   * Register a callback to receive density-filtered comments.
   * Called whenever comments change or auto-density is toggled.
   */
  onDensityFilter(callback: DensityFilterCallback | null) {
    this.densityFilterCallback = callback
  }

  setComments(comments: CommentEntity[]) {
    this.comments = comments
    if (!this.enabled) {
      // Even if chart is disabled, still apply density filter if auto-density is on
      this.applyDensityFilter()
      return
    }
    this.scheduleCompute()
    this.applyDensityFilter()
  }

  clear() {
    this.comments = []
    this.data = []
    this.chart.updateData([], 0)
    this.chart.updateSkipRegions([])
  }

  /**
   * Update the OP/ED skip region overlays on the density chart.
   */
  updateSkipRegions(regions: SkipRegion[]) {
    this.chart.updateSkipRegions(regions)
  }

  private applyDensityFilter() {
    if (!this.densityFilterCallback) return

    if (!this.autoDensityEnabled) {
      // Pass through all comments when disabled
      this.densityFilterCallback(this.comments)
      return
    }

    const duration = this.currentVideo?.duration ?? 0
    if (!Number.isFinite(duration) || duration <= 0) {
      this.densityFilterCallback(this.comments)
      return
    }

    const binSize = getAdaptiveBinSize(duration)
    const filtered = filterByAdaptiveDensity(this.comments, duration, binSize)

    if (this.perfEnabled) {
      this.logger.debug(
        `Auto density: ${this.comments.length} -> ${filtered.length} comments (${Math.round((1 - filtered.length / this.comments.length) * 100)}% filtered)`
      )
    }

    this.densityFilterCallback(filtered)
  }

  private setupEventListeners() {
    this.videoEventService.addVideoEventListener(
      'timeupdate',
      this.boundHandleTimeUpdate
    )
    this.videoEventService.addVideoEventListener(
      'seeked',
      this.boundHandleSeeked
    )
    this.videoEventService.addVideoEventListener(
      'loadedmetadata',
      this.boundHandleTimeUpdate
    )
    document.addEventListener('mousemove', this.boundHandleMouseMove)

    // Set up video resize observation
    const videoElement = this.videoEventService.getVideoElement()
    if (videoElement) {
      this.setupVideoResizeObserver(videoElement)
    }
  }

  private removeEventListeners() {
    this.videoEventService.removeVideoEventListener(
      'timeupdate',
      this.boundHandleTimeUpdate
    )
    this.videoEventService.removeVideoEventListener(
      'seeked',
      this.boundHandleSeeked
    )
    this.videoEventService.removeVideoEventListener(
      'loadedmetadata',
      this.boundHandleTimeUpdate
    )
    document.removeEventListener('mousemove', this.boundHandleMouseMove)
    this.cleanupVideoResizeObserver()
  }

  private computeBins(duration: number) {
    const start = performance.now()
    const binSize = getAdaptiveBinSize(duration)
    this.data = computeDensityBins(this.comments, duration, binSize)
    const elapsed = performance.now() - start
    if (this.perfEnabled) {
      this.perfTimer.measure('density_compute_ms', elapsed, {
        comments: this.comments.length,
        bins: this.data.length,
        binSize,
      })
    }
  }

  private scheduleCompute() {
    if (this.computeTimer !== null) {
      window.clearTimeout(this.computeTimer)
    }
    this.computeTimer = window.setTimeout(() => {
      this.computeTimer = null
      this.tryComputeAndRender()
    }, 0)
  }

  private tryComputeAndRender() {
    const active = this.currentVideo
    const duration = active?.duration ?? Number.NaN
    if (!active || !Number.isFinite(duration) || duration <= 0) {
      return
    }

    this.computeBins(duration)
    this.chart.updateData(this.data, duration)
    this.chart.updateProgress(active.currentTime)
  }

  private handleSeeked() {
    if (!this.currentVideo) return
    this.chart.updateProgress(this.currentVideo.currentTime)
  }

  private handleTimeUpdate(event: Event) {
    const newVideo = event.target as HTMLVideoElement
    if (this.currentVideo !== newVideo) {
      this.currentVideo = newVideo
      this.setupVideoResizeObserver(newVideo)
    }
    if (this.data.length === 0) {
      this.tryComputeAndRender()
    } else {
      this.chart.updateProgress(this.currentVideo.currentTime)
    }
  }

  private handleMouseMove(event: MouseEvent) {
    const videoElement = this.videoEventService.getVideoElement()
    if (!(event.target instanceof Element) || !videoElement) {
      return
    }
    if (
      !videoElement.isEqualNode(event.target) &&
      !event.target.contains(videoElement) &&
      !videoElement.contains(event.target)
    ) {
      return
    }
    this.chart.show()
    if (this.showChartTimeout) {
      clearTimeout(this.showChartTimeout)
    }
    this.showChartTimeout = setTimeout(() => {
      this.chart.hide()
    }, 2000)
  }

  private setupVideoResizeObserver(videoElement: HTMLVideoElement) {
    this.cleanupVideoResizeObserver()

    this.resizeObserver = new ResizeObserver(this.boundHandleResize)
    this.resizeObserver.observe(videoElement)
  }

  private cleanupVideoResizeObserver() {
    if (this.resizeObserver) {
      this.resizeObserver.disconnect()
      this.resizeObserver = null
    }
  }

  private handleResize() {
    this.chart.redraw()
  }

  private cleanup() {
    this.removeEventListeners()
    this.chart.teardown()
  }
}

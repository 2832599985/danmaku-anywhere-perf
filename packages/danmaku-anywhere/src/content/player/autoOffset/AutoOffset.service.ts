import type { CommentEntity } from '@danmaku-anywhere/danmaku-converter'
import { inject, injectable } from 'inversify'
import { uiContainer } from '@/common/ioc/uiIoc'
import { type ILogger, LoggerSymbol } from '@/common/Logger'
import { DanmakuOptionsService } from '@/common/options/danmakuOptions/service'
import { getAdaptiveBinSize } from '@/content/player/densityPlot/adaptiveDensity'
import { computeDensityBins } from '@/content/player/densityPlot/computeDensityBins'
import { VideoEventService } from '@/content/player/videoEvent/VideoEvent.service'
import type { SkipTarget } from '@/content/player/videoSkip/SkipTarget'
import { VideoSkipService } from '@/content/player/videoSkip/VideoSkip.service'

export interface AutoOffsetResult {
  /** Computed offset in milliseconds (positive = danmaku appears later) */
  offsetMs: number
  /** Confidence score 0-1 */
  confidence: number
  /** The detected density spike time in seconds */
  densitySpikeTime: number
  /** The OP end time in seconds (from VideoSkipService) */
  opEndTime: number
}

type AutoOffsetCallback = (result: AutoOffsetResult | null) => void

/**
 * Detects and calibrates danmaku timeline offset automatically.
 *
 * Algorithm:
 * 1. Compute density bins from comments
 * 2. Find the first significant density spike (density[i] > mean * 2 AND density[i] > density[i-1] * 1.5)
 * 3. Compare spike time with OP end time from VideoSkipService
 * 4. If difference > 5 seconds, suggest an offset correction
 */
@injectable('Singleton')
export class AutoOffsetService {
  private logger: ILogger
  private comments: CommentEntity[] = []
  private calibrated = false
  private lastResult: AutoOffsetResult | null = null
  private onResultCallbacks: AutoOffsetCallback[] = []
  private calibrationTimer: number | null = null

  constructor(
    @inject(VideoSkipService)
    private videoSkipService: VideoSkipService,
    @inject(VideoEventService)
    private videoEventService: VideoEventService,
    @inject(LoggerSymbol) logger: ILogger
  ) {
    this.logger = logger.sub('[AutoOffsetService]')
  }

  /**
   * Register a callback to receive calibration results.
   */
  onResult(callback: AutoOffsetCallback) {
    this.onResultCallbacks.push(callback)
  }

  offResult(callback: AutoOffsetCallback) {
    this.onResultCallbacks = this.onResultCallbacks.filter(
      (cb) => cb !== callback
    )
  }

  /**
   * Set comments and attempt auto-calibration.
   * Called when danmaku is first loaded.
   */
  setComments(comments: CommentEntity[]) {
    this.comments = comments
    this.calibrated = false
    this.lastResult = null
    // Schedule calibration after targets are parsed
    this.scheduleCalibration()
  }

  clear() {
    this.comments = []
    this.calibrated = false
    this.lastResult = null
    this.clearCalibrationTimer()
    this.notifyCallbacks(null)
  }

  /**
   * Get the last calibration result.
   */
  getLastResult(): AutoOffsetResult | null {
    return this.lastResult
  }

  /**
   * Force recalibration (e.g. when user clicks "Auto calibrate").
   */
  calibrate(): AutoOffsetResult | null {
    this.calibrated = false
    return this.doCalibrate()
  }

  /**
   * Apply the auto-detected offset to danmaku options.
   */
  async applyOffset(offsetMs: number): Promise<void> {
    const danmakuOptionsService = uiContainer.get(DanmakuOptionsService)
    const current = await danmakuOptionsService.get()
    await danmakuOptionsService.update({ offset: current.offset + offsetMs })
    this.logger.debug(`Applied auto offset: ${offsetMs}ms`)
  }

  private scheduleCalibration() {
    // Wait a tick for VideoSkipService to finish parsing targets
    this.clearCalibrationTimer()
    this.calibrationTimer = window.setTimeout(() => {
      this.calibrationTimer = null
      this.doCalibrate()
    }, 500)
  }

  private clearCalibrationTimer() {
    if (this.calibrationTimer !== null) {
      window.clearTimeout(this.calibrationTimer)
      this.calibrationTimer = null
    }
  }

  private doCalibrate(): AutoOffsetResult | null {
    if (this.calibrated || this.comments.length === 0) {
      return this.lastResult
    }

    const video = this.videoEventService.getVideoElement()
    const duration = video?.duration ?? 0
    if (!Number.isFinite(duration) || duration <= 0) {
      this.logger.debug('Cannot calibrate: no valid video duration')
      return null
    }

    // Find OP end time from VideoSkipService
    const targets = this.videoSkipService.getJumpTargets()
    const opTarget = this.findOpTarget(targets)

    if (!opTarget) {
      this.logger.debug('Cannot calibrate: no OP target detected')
      this.calibrated = true
      return null
    }

    // Compute density bins
    const binSize = getAdaptiveBinSize(duration)
    const bins = computeDensityBins(this.comments, duration, binSize)

    if (bins.length === 0) {
      this.logger.debug('Cannot calibrate: no density bins')
      this.calibrated = true
      return null
    }

    // Find the first significant density spike
    const spikeTime = this.findFirstDensitySpike(bins, binSize)

    if (spikeTime === null) {
      this.logger.debug('Cannot calibrate: no density spike found')
      this.calibrated = true
      return null
    }

    const opEndTime = opTarget.endTime
    const diffSeconds = spikeTime - opEndTime
    const diffMs = Math.round(diffSeconds * 1000)

    this.logger.debug(
      `Calibration: density spike at ${spikeTime.toFixed(1)}s, OP ends at ${opEndTime.toFixed(1)}s, diff = ${diffSeconds.toFixed(1)}s`
    )

    this.calibrated = true

    // Only suggest offset if difference is significant (> 5 seconds)
    if (Math.abs(diffSeconds) < 5) {
      this.logger.debug('Offset difference < 5s, no calibration needed')
      this.lastResult = null
      this.notifyCallbacks(null)
      return null
    }

    // Compute confidence based on spike prominence
    const confidence = Math.min(1, Math.abs(diffSeconds) / 30)

    const result: AutoOffsetResult = {
      offsetMs: -diffMs, // negate: if danmaku spike is AFTER OP end, danmaku is late, need negative offset
      confidence,
      densitySpikeTime: spikeTime,
      opEndTime,
    }

    this.lastResult = result
    this.notifyCallbacks(result)
    return result
  }

  /**
   * Find the first OP target (start time < 5 minutes).
   */
  private findOpTarget(targets: readonly SkipTarget[]): SkipTarget | undefined {
    return targets.find((t) => t.startTime < 300)
  }

  /**
   * Find the first significant density spike.
   * A spike is defined as:
   *  - density[i] > mean(density) * 2
   *  - density[i] > density[i-1] * 1.5
   *  - time is in the first half of the video (to avoid ED spikes)
   */
  private findFirstDensitySpike(
    bins: { time: number; value: number }[],
    binSize: number
  ): number | null {
    if (bins.length < 3) return null

    // Compute mean of non-zero values
    let sum = 0
    let nonZeroCount = 0
    for (const bin of bins) {
      if (bin.value > 0) {
        sum += bin.value
        nonZeroCount++
      }
    }
    if (nonZeroCount === 0) return null

    const mean = sum / nonZeroCount
    const threshold = mean * 2
    // Only look at the first half of the video
    const maxTime = bins[bins.length - 1].time / 2

    for (let i = 1; i < bins.length; i++) {
      const current = bins[i]
      const prev = bins[i - 1]

      if (current.time > maxTime) break

      if (current.value > threshold && current.value > prev.value * 1.5) {
        return current.time
      }
    }

    return null
  }

  private notifyCallbacks(result: AutoOffsetResult | null) {
    for (const cb of this.onResultCallbacks) {
      cb(result)
    }
  }
}

import type { CommentEntity } from '@danmaku-anywhere/danmaku-converter'
import { inject, injectable } from 'inversify'
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { uiContainer } from '@/common/ioc/uiIoc'
import { type ILogger, LoggerSymbol } from '@/common/Logger'
import { ExtensionOptionsService } from '@/common/options/extensionOptions/service'
import { getTrackingService } from '@/common/telemetry/getTrackingService'
import { PerfTimer } from '@/common/utils/perf'
import { SkipButton } from '@/content/player/components/SkipButton/SkipButton'
import { DanmakuLayoutService } from '@/content/player/danmakuLayout/DanmakuLayout.service'
import { shouldAutoSkipOp } from '@/content/player/videoSkip/autoSkipOp'
import type { SkipTarget } from '@/content/player/videoSkip/SkipTarget'
import { VideoEventService } from '../videoEvent/VideoEvent.service'
import { parseCommentsForJumpTargets } from './videoSkipParser'

type ActiveButtonEntry = { node: HTMLElement; root: Root }

@injectable('Singleton')
export class VideoSkipService {
  private logger: ILogger

  private enabled = false
  private showSkipButtonEnabled = true
  private autoSkipOpEnabled = false
  private hasAutoSkippedOp = false
  private comments: CommentEntity[] = []
  private jumpTargets: SkipTarget[] = []
  private activeButton: ActiveButtonEntry | null = null
  private currentVideo: HTMLVideoElement | null = null

  private lastChecked = 0
  private parseTimer: number | null = null
  private perfEnabled = false
  private perfTimer: PerfTimer

  private readonly boundHandleTimeUpdate: (event: Event) => void
  private readonly boundHandleSeek: () => void

  constructor(
    @inject(VideoEventService)
    private videoEventService: VideoEventService,
    @inject(DanmakuLayoutService)
    private layoutManager: DanmakuLayoutService,
    @inject(LoggerSymbol) logger: ILogger
  ) {
    this.logger = logger.sub('[VideoSkipService]')
    this.perfTimer = new PerfTimer(this.logger, 'videoSkip', false)
    this.boundHandleTimeUpdate = this.handleTimeUpdate.bind(this)
    this.boundHandleSeek = this.handleSeek.bind(this)

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
    if (this.enabled) {
      return
    }
    this.enabled = true
    this.logger.debug('Enabling')
    this.setupEventListeners()
    if (this.comments.length > 0) {
      this.scheduleParse()
    }
  }

  disable() {
    if (!this.enabled) {
      return
    }
    this.enabled = false
    this.logger.debug('Disabling')
    this.cleanup()
    this.jumpTargets = []
    if (this.parseTimer !== null) {
      window.clearTimeout(this.parseTimer)
      this.parseTimer = null
    }
  }

  setPlayerOptions(opts: { showSkipButton: boolean; autoSkipOp: boolean }) {
    this.showSkipButtonEnabled = opts.showSkipButton
    this.autoSkipOpEnabled = opts.autoSkipOp

    // If the user disables the button while it's shown, remove it immediately.
    if (!this.showSkipButtonEnabled) {
      this.removeSkipButton()
    }

    // Ensure settings changes take effect quickly.
    this.lastChecked = 0
  }

  setComments(comments: CommentEntity[]) {
    this.comments = comments
    this.hasAutoSkippedOp = false
    if (!this.enabled) {
      return
    }
    this.scheduleParse()
  }

  clear() {
    this.comments = []
    this.jumpTargets = []
    this.hasAutoSkippedOp = false
    if (this.parseTimer !== null) {
      window.clearTimeout(this.parseTimer)
      this.parseTimer = null
    }
    if (this.activeButton) {
      this.activeButton.root.unmount()
      this.activeButton = null
    }
    this.currentVideo = null
  }

  private setupEventListeners() {
    this.videoEventService.addVideoEventListener(
      'timeupdate',
      this.boundHandleTimeUpdate
    )
    this.videoEventService.addVideoEventListener('seeked', this.boundHandleSeek)
  }

  private removeEventListeners() {
    this.videoEventService.removeVideoEventListener(
      'timeupdate',
      this.boundHandleTimeUpdate
    )
    this.videoEventService.removeVideoEventListener(
      'seeked',
      this.boundHandleSeek
    )
  }

  private handleTimeUpdate(event: Event) {
    const now = Date.now()

    // throttle check to every 2s
    if (now - this.lastChecked < 2000) {
      return
    }

    this.lastChecked = now

    const video = event.target as HTMLVideoElement
    this.currentVideo = video
    const currentTime = video.currentTime

    if (this.autoSkipOpEnabled) {
      for (const target of this.jumpTargets) {
        if (!shouldAutoSkipOp(target, currentTime, this.hasAutoSkippedOp))
          continue

        this.logger.debug('Auto skipping OP', target)
        this.jumpToTime(target.endTime)
        target.close()
        this.hasAutoSkippedOp = true
        this.removeSkipButton()
        return
      }
    }

    if (!this.showSkipButtonEnabled) {
      return
    }

    for (const target of this.jumpTargets) {
      if (
        !target.isShown() &&
        !target.isClosed() &&
        target.isInRange(currentTime)
      ) {
        // show the skip button when we are in its range
        this.showSkipButton(target)
      } else if (
        target.isShown() &&
        this.activeButton !== null &&
        !target.isInRange(currentTime)
      ) {
        // hide the button after the range elapses
        this.removeSkipButton()
      }
    }
  }

  private handleSeek() {
    // reset shown status after seeking
    this.removeSkipButton()
    this.jumpTargets.forEach((target: SkipTarget) => {
      target.hide()
    })
  }

  private scheduleParse() {
    if (this.parseTimer !== null) {
      window.clearTimeout(this.parseTimer)
    }
    this.parseTimer = window.setTimeout(() => {
      this.parseTimer = null
      const start = performance.now()
      this.jumpTargets = parseCommentsForJumpTargets(this.comments)
      const elapsed = performance.now() - start
      this.logger.debug(
        `Parsed ${this.jumpTargets.length} jump targets from ${this.comments.length} comments`,
        this.jumpTargets
      )
      if (this.perfEnabled) {
        this.perfTimer.measure('skip_parse_ms', elapsed, {
          comments: this.comments.length,
          targets: this.jumpTargets.length,
        })
      }
    }, 0)
  }

  private showSkipButton(target: SkipTarget) {
    if (!this.layoutManager.wrapper) return

    this.logger.debug('Creating skip buttons', target)

    const mountNode = document.createElement('div')
    this.layoutManager.wrapper.appendChild(mountNode)

    const root = createRoot(mountNode)
    root.render(
      createElement(SkipButton, {
        target,
        onClick: () => {
          getTrackingService().track('clickSkipButton', { target })
          this.jumpToTime(target.endTime)
          this.removeSkipButton()
        },
        onClose: () => {
          target.close()
          this.removeSkipButton()
        },
      })
    )

    this.activeButton = { node: mountNode, root }
    target.show()
  }

  private jumpToTime(targetTime: number) {
    if (this.currentVideo) {
      this.logger.debug(`Jumping to time: ${targetTime}s`)
      this.currentVideo.currentTime = targetTime
    }
  }

  private removeSkipButton() {
    const entry = this.activeButton
    if (!entry) {
      return
    }
    this.logger.debug('Removing active button', entry)
    entry.root.unmount()
    entry.node.remove()
    this.activeButton = null
  }

  private cleanup() {
    this.removeEventListeners()
    this.removeSkipButton()
  }
}

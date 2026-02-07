import { inject, injectable } from 'inversify'
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import { type ILogger, LoggerSymbol } from '@/common/Logger'
import { FixedSkipButton } from '@/content/player/components/FixedSkipButton/FixedSkipButton'
import { VideoEventService } from '@/content/player/videoEvent/VideoEvent.service'

type ActiveButtonEntry = { node: HTMLElement; root: Root }

@injectable('Singleton')
export class FixedSkipService {
  private logger: ILogger

  private enabled = false
  private fixedSkipSeconds = 90
  private activeButton: ActiveButtonEntry | null = null
  private currentVideo: HTMLVideoElement | null = null
  private skipButtonContainer: HTMLElement | null = null
  private isTemporarilyHidden = false

  private readonly boundHandleTimeUpdate: (event: Event) => void

  constructor(
    @inject(VideoEventService)
    private videoEventService: VideoEventService,
    @inject(LoggerSymbol) logger: ILogger
  ) {
    this.logger = logger.sub('[FixedSkipService]')
    this.boundHandleTimeUpdate = this.handleTimeUpdate.bind(this)
  }

  enable() {
    if (this.enabled) {
      return
    }
    this.enabled = true
    this.logger.debug('Enabling')
    this.videoEventService.addVideoEventListener(
      'timeupdate',
      this.boundHandleTimeUpdate
    )
    // Don't render immediately - wait for video to be detected
    // The button will be rendered on first timeupdate event
  }

  disable() {
    if (!this.enabled) {
      return
    }
    this.enabled = false
    this.logger.debug('Disabling')
    this.videoEventService.removeVideoEventListener(
      'timeupdate',
      this.boundHandleTimeUpdate
    )
    this.removeButton()
  }

  setOptions(opts: { fixedSkipSeconds: number }) {
    this.fixedSkipSeconds = opts.fixedSkipSeconds ?? 90
    if (this.enabled) {
      this.renderButton()
    }
  }

  setSkipButtonContainer(container: HTMLElement) {
    this.skipButtonContainer = container
  }

  private handleTimeUpdate(event: Event) {
    this.currentVideo = event.target as HTMLVideoElement
    // Render button only when we have a video, button isn't already shown, and not temporarily hidden
    if (this.currentVideo && !this.activeButton && !this.isTemporarilyHidden) {
      this.renderButton()
    }
  }

  private renderButton() {
    this.removeButton()

    const container = this.skipButtonContainer
    if (!container) return

    const mountNode = document.createElement('div')
    container.appendChild(mountNode)

    const root = createRoot(mountNode)
    root.render(
      createElement(FixedSkipButton, {
        seconds: this.fixedSkipSeconds,
        onClick: () => {
          this.skipForward()
          this.hideButtonTemporarily()
        },
      })
    )

    this.activeButton = { node: mountNode, root }
  }

  private skipForward() {
    const video = this.currentVideo ?? this.videoEventService.getVideoElement()
    if (video) {
      this.logger.debug(`Skipping forward ${this.fixedSkipSeconds}s`)
      video.currentTime += this.fixedSkipSeconds
    }
  }

  private hideButtonTemporarily() {
    this.isTemporarilyHidden = true
    this.removeButton()
    // Re-show button after 3 seconds so user can skip again if needed
    setTimeout(() => {
      this.isTemporarilyHidden = false
      if (this.enabled) {
        this.renderButton()
      }
    }, 3000)
  }

  private removeButton() {
    if (!this.activeButton) return
    this.activeButton.root.unmount()
    this.activeButton.node.remove()
    this.activeButton = null
  }
}

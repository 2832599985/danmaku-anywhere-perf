import { uiContainer } from '@/common/ioc/uiIoc'
import { Logger as _Logger } from '@/common/Logger'
import { DanmakuOptionsService } from '@/common/options/danmakuOptions/service'
import { ExtensionOptionsService } from '@/common/options/extensionOptions/service'
import { createRpcServer } from '@/common/rpc/server'
import {
  chromeRpcClient,
  playerRpcClient,
} from '@/common/rpcClient/background/client'
import type { PlayerRelayCommands } from '@/common/rpcClient/background/types'
import { getTrackingService } from '@/common/telemetry/getTrackingService'
import { createPopoverRoot } from '@/content/common/host/createPopoverRoot'
import { injectCss } from '@/content/common/injectCss'
import danmakuComponentCss from '@/content/player/components/DanmakuComponent.css?inline'
import fixedSkipButtonCss from '@/content/player/components/FixedSkipButton/FixedSkipButton.css?inline'
import skipButtonCss from '@/content/player/components/SkipButton/SkipButton.css?inline'
import { PLAYER_ROOT_ID } from '@/content/player/constants/rootId'
import { DanmakuManagerService } from '@/content/player/danmakuManager/DanmakuManager.service'
import { DanmakuDensityService } from '@/content/player/densityPlot/DanmakuDensity.service'
import densityPlotCss from '@/content/player/densityPlot/DanmakuDensityChart.css?inline'
import { FixedSkipService } from '@/content/player/fixedSkip/FixedSkip.service'
import { createPipWindow, moveElement } from '@/content/player/pipUtils'
import { VideoEventService } from '@/content/player/videoEvent/VideoEvent.service'
import { VideoNodeObserverService } from '@/content/player/videoObserver/VideoNodeObserver.service'
import { VideoSkipService } from '@/content/player/videoSkip/VideoSkip.service'

const { data: frameId } = await chromeRpcClient.getFrameId()

const Logger = _Logger.sub(`[Player-${frameId}]`)

Logger.info('Player script loaded')

const videoNodeObserverService = uiContainer.get(VideoNodeObserverService)
const managerService = uiContainer.get(DanmakuManagerService)
const videoEventService = uiContainer.get(VideoEventService)
const videoSkipService = uiContainer.get(VideoSkipService)
const fixedSkipService = uiContainer.get(FixedSkipService)
const danmakuDensityService = uiContainer.get(DanmakuDensityService)

const { shadowRoot, root } = createPopoverRoot({
  id: PLAYER_ROOT_ID,
})

// Give shadowRoot proper dimensions so absolutely positioned children can reference it
shadowRoot.style.position = 'fixed'
shadowRoot.style.top = '0'
shadowRoot.style.left = '0'
shadowRoot.style.width = '100vw'
shadowRoot.style.height = '100vh'
shadowRoot.style.pointerEvents = 'none'

// Create a dedicated container for the skip button that allows pointer events
// The wrapper has pointer-events: none which blocks clicks in fullscreen mode
const skipButtonContainer = document.createElement('div')
skipButtonContainer.id = 'danmaku-anywhere-skip-button-container'
skipButtonContainer.style.position = 'absolute'
skipButtonContainer.style.top = '0'
skipButtonContainer.style.left = '0'
skipButtonContainer.style.width = '100%'
skipButtonContainer.style.height = '100%'
skipButtonContainer.style.pointerEvents = 'none'
skipButtonContainer.style.zIndex = '10001'
shadowRoot.appendChild(skipButtonContainer)

videoSkipService.setSkipButtonContainer(skipButtonContainer)
fixedSkipService.setSkipButtonContainer(skipButtonContainer)
managerService.setParent(shadowRoot)
injectCss(shadowRoot, [
  skipButtonCss,
  fixedSkipButtonCss,
  densityPlotCss,
  danmakuComponentCss,
])

let pipWindow: Window | undefined

const playerRpcServer = createRpcServer<PlayerRelayCommands>(
  {
    'relay:command:mount': async ({ data: comments }) => {
      managerService.mount(comments)
      videoSkipService.setComments(comments)
      danmakuDensityService.setComments(comments)
      return true
    },
    'relay:command:unmount': async () => {
      managerService.unmount()
      videoSkipService.clear()
      danmakuDensityService.clear()
      return true
    },
    'relay:command:start': async ({ data: query }) => {
      managerService.start(query)
    },
    'relay:command:seek': async ({ data: time }) => {
      managerService.seek(time)
    },
    'relay:command:show': async ({ data: show }) => {
      if (show) {
        managerService.show()
      } else {
        managerService.hide()
      }
    },
    'relay:command:enterPip': async () => {
      // TODO: https://github.com/WICG/document-picture-in-picture/issues/97
      pipWindow = await createPipWindow()

      const pipContainer = pipWindow.document.createElement('div')
      pipContainer.style.setProperty('position', 'absolute', 'important')
      pipContainer.style.setProperty('z-index', '2147483647', 'important')
      pipContainer.style.setProperty('left', '0', 'important')
      pipContainer.style.setProperty('top', '0', 'important')

      pipWindow.document.body.appendChild(pipContainer)

      const delayResize = () => {
        setTimeout(() => {
          managerService.resize()
        }, 100)
      }

      const restoreWrapper = moveElement(
        managerService.getWrapper(),
        pipContainer
      )
      const video = managerService.video
      if (!video) {
        Logger.warn('Failed to enter PiP: video element not found')
        return
      }
      const restoreVideo = moveElement(video, pipWindow.document.body)

      delayResize()

      pipWindow.addEventListener('pagehide', () => {
        restoreVideo()
        restoreWrapper()
        delayResize()
      })
    },
  },
  {
    logger: Logger,
    context: { frameId },
    filter: (_, data) => {
      if (import.meta.env.DEV) {
        // safety check, frameId should always be present
        if (data.frameId === undefined) throw new Error('frameId is required')
      }
      if (data.frameId !== frameId) {
        Logger.debug(
          `Ignoring message for frame ${data.frameId} in frame ${frameId}`
        )
        return false
      }
      return true
    },
  }
)

/**
 * Lifecycle events
 */
videoNodeObserverService.addEventListener('videoNodeChange', () => {
  playerRpcClient.controller['relay:event:videoChange']({ frameId })
})

videoNodeObserverService.addEventListener('videoNodeRemove', () => {
  // This event is debounced
  playerRpcClient.controller['relay:event:videoRemoved']({ frameId })
})

videoEventService.onTimeEvent(0.5, () => {
  playerRpcClient.controller['relay:event:preloadNextEpisode']({ frameId })
})

/**
 * Storage events
 */
const danmakuOptionsService = uiContainer.get(DanmakuOptionsService)
danmakuOptionsService.onChange((options) => {
  managerService.updateConfig(options)
})

danmakuOptionsService.get().then((options) => {
  managerService.updateConfig(options)
})

const extensionOptionsService = uiContainer.get(ExtensionOptionsService)

const applyPlayerOptions = (
  options: Awaited<ReturnType<typeof extensionOptionsService.get>>
) => {
  videoSkipService.setPlayerOptions(options.playerOptions)
  if (
    options.playerOptions.showSkipButton ||
    options.playerOptions.autoSkipOp
  ) {
    videoSkipService.enable()
  } else {
    videoSkipService.disable()
  }
  if (options.playerOptions.showDanmakuTimeline) {
    danmakuDensityService.enable()
  } else {
    danmakuDensityService.disable()
  }
  fixedSkipService.setOptions({
    fixedSkipSeconds: options.playerOptions.fixedSkipSeconds,
  })
  if (options.playerOptions.enableFixedSkip) {
    fixedSkipService.enable()
  } else {
    fixedSkipService.disable()
  }
}

extensionOptionsService.get().then(applyPlayerOptions)

extensionOptionsService.onChange(applyPlayerOptions)

/**
 * Window events
 */
const handleFullscreenChange = () => {
  /**
   * The last element in the top layer is shown on top.
   * Hiding then showing the popover will make it the last element in the top layer.
   *
   * Do this every time something goes fullscreen, to ensure the popover is always on top.
   */
  root.hidePopover()
  root.showPopover()
  // Then notify the controller so that the controller can also toggle popover to stay on top
  void playerRpcClient.controller['relay:event:showPopover']({ frameId })
}

document.addEventListener('fullscreenchange', handleFullscreenChange)

playerRpcServer.listen(chrome.runtime.onMessage)

window.addEventListener('pagehide', () => {
  document.removeEventListener('fullscreenchange', handleFullscreenChange)
  playerRpcServer.unlisten(chrome.runtime.onMessage)
  managerService.stop()
  videoSkipService.disable()
  fixedSkipService.disable()
  danmakuDensityService.disable()
})

Logger.debug('Player script listening')

playerRpcClient.controller['relay:event:playerReady']({ frameId })
  .then(() => {
    void playerRpcClient.controller['relay:event:showPopover']({ frameId })
  })
  .catch((err) => {
    getTrackingService().track('playerInitError', err)
  })

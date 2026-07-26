import type { CommentEntity } from '@danmaku-anywhere/danmaku-converter'
import { inject, injectable } from 'inversify'
import { type ILogger, LoggerSymbol } from '@/common/Logger'
import { DanmakuOptionsService } from '@/common/options/danmakuOptions/service'
import type { UserTheme } from '@/common/options/extensionOptions/schema'
import { ExtensionOptionsService } from '@/common/options/extensionOptions/service'
import { createRpcServer } from '@/common/rpc/server'
import { playerRpcClient } from '@/common/rpcClient/background/client'
import type { PlayerRelayCommands } from '@/common/rpcClient/background/types'
import { ColorMode } from '@/common/theme/enums'
import { getThemePalette, resolveColorScheme } from '@/common/theme/themes'
import { getThemeCssVarsString } from '@/common/theme/themeVars'
import { createPopoverRoot } from '@/content/common/host/createPopoverRoot'
import { injectCss } from '@/content/common/injectCss'
import { AutoOffsetService } from '@/content/player/autoOffset/AutoOffset.service'
import danmakuComponentCss from '@/content/player/components/DanmakuComponent.css?inline'
import fixedSkipButtonCss from '@/content/player/components/FixedSkipButton/FixedSkipButton.css?inline'
import skipButtonCss from '@/content/player/components/SkipButton/SkipButton.css?inline'
import { PLAYER_ROOT_ID } from '@/content/player/constants/rootId'
import { DanmakuManagerService } from '@/content/player/danmakuManager/DanmakuManager.service'
import { DanmakuDensityService } from '@/content/player/densityPlot/DanmakuDensity.service'
import densityPlotCss from '@/content/player/densityPlot/DanmakuDensityChart.css?inline'
import type { SkipRegion } from '@/content/player/densityPlot/types'
import { FixedSkipService } from '@/content/player/fixedSkip/FixedSkip.service'
import { createPipWindow, moveElement } from '@/content/player/pipUtils'
import { UpscaleService } from '@/content/player/upscaler/Upscale.service'
import { VideoEventService } from '@/content/player/videoEvent/VideoEvent.service'
import { VideoNodeObserverService } from '@/content/player/videoObserver/VideoNodeObserver.service'
import type { SkipTarget } from '@/content/player/videoSkip/SkipTarget'
import { VideoSkipService } from '@/content/player/videoSkip/VideoSkip.service'
import { reparentPopover } from '../common/reparentPopover'

interface StartContext {
  frameId: number
  query: string
  sendPlayerReady: () => void
}

/**
 * Convert VideoSkip jump targets to SkipRegion overlays for the density chart.
 * Heuristic: regions starting before 5 minutes (300s) are labeled OP, others ED.
 */
const OP_THRESHOLD_SECONDS = 300

function convertTargetsToSkipRegions(targets: SkipTarget[]): SkipRegion[] {
  return targets.map((t) => ({
    startTime: t.startTime,
    endTime: t.endTime,
    type: t.startTime < OP_THRESHOLD_SECONDS ? 'op' : 'ed',
  }))
}

@injectable('Singleton')
export class PlayerCommandHandler {
  private logger: ILogger
  private frameId = -1
  private root!: HTMLDivElement
  private enableFullscreenInteraction = true
  private autoNextEpisodeEnabled = true
  private urlChangeCheckInterval: ReturnType<typeof setInterval> | undefined
  private urlChangeCleanups: (() => void)[] = []
  private lastUrl = ''
  private started = false
  private sendPlayerReady: () => void = () => {
    // no-op, replace in start()
  }

  constructor(
    @inject(DanmakuManagerService) private manager: DanmakuManagerService,
    @inject(VideoNodeObserverService)
    private videoNodeObs: VideoNodeObserverService,
    @inject(VideoEventService) private videoEvent: VideoEventService,
    @inject(VideoSkipService) private videoSkip: VideoSkipService,
    @inject(DanmakuDensityService) private density: DanmakuDensityService,
    @inject(FixedSkipService) private fixedSkip: FixedSkipService,
    @inject(AutoOffsetService) private autoOffset: AutoOffsetService,
    @inject(UpscaleService) private upscale: UpscaleService,
    @inject(DanmakuOptionsService)
    private danmakuOptions: DanmakuOptionsService,
    @inject(ExtensionOptionsService)
    private extensionOptions: ExtensionOptionsService,
    @inject(LoggerSymbol) logger: ILogger
  ) {
    this.logger = logger.sub('[PlayerCommandHandler]')
  }

  /**
   * Initialize DOM, wire events, create the full RPC server, and start video detection.
   */
  async start(ctx: StartContext) {
    // The bootstrap keeps its lite server listening until this resolves, and
    // setupDom() can wait a long time for document.body. A second `start`
    // arriving in that window must not build a second popover root, a second
    // RPC server, and a duplicate set of window listeners.
    // The in-flight first call ends with manager.start(), so nothing is lost
    // by returning here; starting the manager early would race the lifecycle
    // wiring and drop the first videoNodeChange relay.
    if (this.started) {
      this.logger.debug('Already started, ignoring duplicate start')
      return
    }
    this.started = true
    this.frameId = ctx.frameId
    this.sendPlayerReady = ctx.sendPlayerReady

    await this.setupDom()
    this.wireLifecycleEvents()
    this.wireStorageEvents()
    this.wireWindowEvents()
    this.createRpcServer()

    this.manager.start(ctx.query)
  }

  private async setupDom() {
    const { root, shadowRoot, shadowContainer } = await createPopoverRoot({
      id: PLAYER_ROOT_ID,
    })
    this.root = root
    this.upscale.setTopLayerRestore(() => {
      reparentPopover(this.root, document, document.fullscreenElement)
      void playerRpcClient.controller['relay:event:showPopover']({
        frameId: this.frameId,
      })
    })
    this.upscale.setFailureNotifier((kind) => {
      void playerRpcClient.controller['relay:event:upscaleError']({
        frameId: this.frameId,
        data: { kind },
      })
    })

    // Create a style element for theme CSS variables
    const themeStyleEl = document.createElement('style')
    shadowContainer.appendChild(themeStyleEl)

    const systemThemeQuery = window.matchMedia('(prefers-color-scheme: dark)')
    let currentTheme: UserTheme | undefined
    const applyTheme = (theme: UserTheme) => {
      currentTheme = theme
      const colorScheme = resolveColorScheme(
        theme.colorMode,
        systemThemeQuery.matches
      )
      const palette = getThemePalette(theme.themeId, colorScheme)
      themeStyleEl.textContent = getThemeCssVarsString(palette)
    }

    // Apply initial theme
    this.extensionOptions.get().then((options) => {
      applyTheme(options.theme)
    })
    this.extensionOptions.onChange((options) => {
      applyTheme(options.theme)
    })
    systemThemeQuery.addEventListener('change', () => {
      if (currentTheme?.colorMode === ColorMode.System) {
        applyTheme(currentTheme)
      }
    })

    // Give shadowRoot proper dimensions so absolutely positioned children can reference it
    shadowRoot.style.position = 'fixed'
    shadowRoot.style.top = '0'
    shadowRoot.style.left = '0'
    shadowRoot.style.width = '100vw'
    shadowRoot.style.height = '100vh'
    shadowRoot.style.pointerEvents = 'none'

    // Create a dedicated container for the skip button that allows pointer events
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

    this.videoSkip.setSkipButtonContainer(skipButtonContainer)
    this.fixedSkip.setSkipButtonContainer(skipButtonContainer)

    this.manager.setParent(shadowRoot)
    injectCss(shadowRoot, [
      skipButtonCss,
      fixedSkipButtonCss,
      densityPlotCss,
      danmakuComponentCss,
    ])

    // When auto-density filters comments, re-mount with the filtered set
    this.density.onDensityFilter((filtered) => {
      if (this.manager.isMounted) {
        this.manager.mount(filtered)
      }
    })

    // Forward OP/ED regions from VideoSkipService to the density chart
    this.videoSkip.onTargetsChange((targets) => {
      this.density.updateSkipRegions(convertTargetsToSkipRegions(targets))
    })
  }

  private wireLifecycleEvents() {
    this.videoNodeObs.addEventListener('videoNodeChange', (video) => {
      playerRpcClient.controller['relay:event:videoChange']({
        frameId: this.frameId,
        data: {
          src: video.src || video.currentSrc,
          width: video.clientWidth,
          height: video.clientHeight,
          playing: !video.paused,
          muted: video.muted,
        },
      })
    })

    this.videoNodeObs.addEventListener('videoNodeRemove', () => {
      playerRpcClient.controller['relay:event:videoRemoved']({
        frameId: this.frameId,
      })
    })

    for (const event of ['play', 'pause', 'volumechange'] as const) {
      this.videoEvent.addVideoEventListener(event, () => {
        const video = this.videoEvent.getVideoElement()
        if (video) this.sendVideoState(video)
      })
    }

    this.videoEvent.onTimeEvent(0.5, () => {
      if (!this.autoNextEpisodeEnabled) return
      playerRpcClient.controller['relay:event:preloadNextEpisode']({
        frameId: this.frameId,
      })
    })

    // Detect video ended to trigger re-matching for next episode
    this.videoEvent.addVideoEventListener('ended', () => {
      if (!this.autoNextEpisodeEnabled) return
      this.logger.debug('Video ended, notifying controller for next episode')
      playerRpcClient.controller['relay:event:videoEnded']({
        frameId: this.frameId,
      })
    })

    // Start URL change detection for SPA navigations
    this.lastUrl = location.href
    if (this.autoNextEpisodeEnabled) {
      this.startUrlChangeDetection()
    }
  }

  private sendVideoState(video: HTMLVideoElement) {
    void playerRpcClient.controller['relay:event:videoStateChange']({
      frameId: this.frameId,
      data: {
        playing: !video.paused,
        muted: video.muted,
      },
    })
  }

  private wireStorageEvents() {
    this.danmakuOptions.onChange((options) => {
      this.manager.updateConfig(options)
    })
    this.danmakuOptions.get().then((options) => {
      this.manager.updateConfig(options)
    })

    this.extensionOptions.get().then((options) => {
      this.applyExtensionOptions(options)
    })
    this.extensionOptions.onChange((options) => {
      this.applyExtensionOptions(options)
    })
  }

  private applyExtensionOptions(options: {
    playerOptions: {
      showSkipButton: boolean
      autoSkipOp: boolean
      showDanmakuTimeline: boolean
      autoDensity: boolean
      enableFullscreenInteraction: boolean
      autoNextEpisode: boolean
      enableFixedSkip: boolean
      fixedSkipSeconds: number
      upscale: {
        enabled: boolean
        modeId:
          | 'builtin-mode-a'
          | 'builtin-mode-b'
          | 'builtin-mode-c'
          | 'builtin-mode-aa'
          | 'builtin-mode-bb'
          | 'builtin-mode-ca'
        performanceTier: 'performance' | 'balanced' | 'quality' | 'ultra'
        targetResolution:
          | 'x2'
          | 'x4'
          | 'x8'
          | '720p'
          | '1080p'
          | '2k'
          | '4k'
          | 'native'
        enableCrossOriginFix: boolean
        frameInterpolation: {
          enabled: boolean
          resolution: '480p' | '720p'
        }
      }
    }
  }) {
    this.videoSkip.setPlayerOptions({
      showSkipButton: options.playerOptions.showSkipButton,
      autoSkipOp: options.playerOptions.autoSkipOp,
    })
    if (
      options.playerOptions.showSkipButton ||
      options.playerOptions.autoSkipOp
    ) {
      this.videoSkip.enable()
    } else {
      this.videoSkip.disable()
    }
    if (options.playerOptions.showDanmakuTimeline) {
      this.density.enable()
    } else {
      this.density.disable()
    }
    this.density.setAutoDensity(options.playerOptions.autoDensity)
    this.enableFullscreenInteraction =
      options.playerOptions.enableFullscreenInteraction

    this.autoNextEpisodeEnabled = options.playerOptions.autoNextEpisode
    if (this.autoNextEpisodeEnabled) {
      this.startUrlChangeDetection()
    } else {
      this.stopUrlChangeDetection()
    }

    this.fixedSkip.setOptions({
      fixedSkipSeconds: options.playerOptions.fixedSkipSeconds,
    })
    if (options.playerOptions.enableFixedSkip) {
      this.fixedSkip.enable()
    } else {
      this.fixedSkip.disable()
    }
    void this.upscale
      .applyOptions(options.playerOptions.upscale)
      .catch((error: unknown) => {
        this.logger.warn('Failed to apply upscale options', error)
      })
  }

  private wireWindowEvents() {
    document.addEventListener('fullscreenchange', () => {
      if (this.enableFullscreenInteraction) {
        reparentPopover(this.root, document, document.fullscreenElement)
      } else {
        reparentPopover(this.root, document, null)
      }
      void playerRpcClient.controller['relay:event:showPopover']({
        frameId: this.frameId,
      })
    })

    this.wireInteractionProxy()
  }

  /**
   * Forward user interaction events to the controller so the FAB
   * shows/hides correctly when the user interacts inside an iframe.
   * Only active for iframe frames (frameId > 0) since the main frame
   * already has direct event listeners on its own window.
   */
  private wireInteractionProxy() {
    if (this.frameId === 0) {
      return
    }

    let lastSent = 0
    const THROTTLE_MS = 1000

    const sendInteraction = () => {
      const now = Date.now()
      if (now - lastSent < THROTTLE_MS) {
        return
      }
      lastSent = now
      void playerRpcClient.controller['relay:event:userInteraction'](
        { frameId: this.frameId },
        { silent: true, optional: true }
      )
    }

    document.addEventListener('mousemove', sendInteraction, { capture: true })
    document.addEventListener('click', sendInteraction, { capture: true })
    document.addEventListener('touchmove', sendInteraction, {
      capture: true,
      passive: true,
    })
  }

  /**
   * Full RPC server, replaces the lite server after handshake
   */
  private createRpcServer() {
    const server = createRpcServer<PlayerRelayCommands>(
      {
        'relay:command:start': async ({ data: query }) => {
          // Already started — idempotent
          this.manager.start(query)
        },
        'relay:command:mount': async ({ data: comments }) => {
          this.mount(comments)
          return true
        },
        'relay:command:unmount': async () => {
          this.unmount()
          return true
        },
        'relay:command:seek': async ({ data: time }) => {
          this.manager.seek(time)
        },
        'relay:command:show': async ({ data: show }) => {
          if (show) {
            this.manager.show()
          } else {
            this.manager.hide()
          }
        },
        'relay:command:controllerReady': async () => {
          this.logger.debug('Controller ready, re-sending playerReady')
          this.sendPlayerReady()
        },
        'relay:command:skipOp': async () => {
          this.videoSkip.skipOpNow()
        },
        'relay:command:autoCalibrate': async () => {
          return this.autoOffset.calibrate()
        },
        'relay:command:applyAutoOffset': async ({ data: offsetMs }) => {
          await this.autoOffset.applyOffset(offsetMs)
        },
        'relay:command:enterPip': async () => {
          await this.enterPip()
        },
        'relay:command:debugSkipButton': async () => {
          this.videoSkip.debugShowSkipButton()
        },
        'relay:command:upscale:toggle': async ({ data: enabled }) => {
          const options = await this.extensionOptions.get()
          await this.extensionOptions.update({
            playerOptions: {
              ...options.playerOptions,
              upscale: { ...options.playerOptions.upscale, enabled },
            },
          })
        },
        'relay:command:upscale:setMode': async ({ data }) => {
          const options = await this.extensionOptions.get()
          await this.extensionOptions.update({
            playerOptions: {
              ...options.playerOptions,
              upscale: { ...options.playerOptions.upscale, ...data },
            },
          })
        },
      },
      {
        logger: this.logger,
        context: { frameId: this.frameId },
        filter: (method, data) => {
          if (method === 'relay:command:controllerReady') return true
          if (import.meta.env.DEV) {
            if (data.frameId === undefined)
              throw new Error('frameId is required')
          }
          if (data.frameId !== this.frameId) return false
          return true
        },
      }
    )

    server.listen(chrome.runtime.onMessage)
  }

  private mount(comments: CommentEntity[]) {
    this.manager.mount(comments)
    this.videoSkip.setComments(comments)
    this.density.setComments(comments)
    this.autoOffset.setComments(comments)
  }

  private unmount() {
    this.manager.unmount()
    this.videoSkip.clear()
    this.density.clear()
    this.autoOffset.clear()
  }

  private async enterPip() {
    const pipWindow = await createPipWindow()

    const pipContainer = pipWindow.document.createElement('div')
    pipContainer.style.setProperty('position', 'absolute', 'important')
    pipContainer.style.setProperty('z-index', '2147483647', 'important')
    pipContainer.style.setProperty('left', '0', 'important')
    pipContainer.style.setProperty('top', '0', 'important')

    pipWindow.document.body.appendChild(pipContainer)

    const delayResize = () => {
      setTimeout(() => {
        this.manager.resize()
      }, 100)
    }

    const video = this.manager.video
    if (!video) throw new Error('Cannot enter PiP without an active video')

    // The upscale canvas can't follow the video into the PiP document (its
    // geometry sync is bound to this window), and leaving it behind shows a
    // transparent video (opacity 0). Suspend before moving either element so
    // in-flight initialization is invalidated as well. Option changes made
    // during PiP are recorded and applied only after resume().
    this.upscale.suspend()

    let restoreWrapper: (() => void) | undefined
    let restoreVideo: (() => void) | undefined
    try {
      restoreWrapper = moveElement(this.manager.getWrapper(), pipContainer)
      restoreVideo = moveElement(video, pipWindow.document.body)

      delayResize()

      pipWindow.addEventListener(
        'pagehide',
        () => {
          restoreVideo?.()
          restoreWrapper?.()
          delayResize()
          void this.upscale.resume().catch(() => undefined)
        },
        { once: true }
      )
    } catch (error) {
      restoreVideo?.()
      restoreWrapper?.()
      await this.upscale.resume().catch(() => undefined)
      throw error
    }
  }

  private handleUrlChange() {
    if (location.href !== this.lastUrl) {
      this.logger.debug('URL changed:', this.lastUrl, '->', location.href)
      this.lastUrl = location.href
      playerRpcClient.controller['relay:event:videoEnded']({
        frameId: this.frameId,
      })
    }
  }

  private startUrlChangeDetection() {
    if (this.urlChangeCheckInterval !== undefined) return

    // 1. Listen for popstate events (back/forward navigation)
    const onPopState = () => this.handleUrlChange()
    window.addEventListener('popstate', onPopState)
    this.urlChangeCleanups.push(() =>
      window.removeEventListener('popstate', onPopState)
    )

    // 2. Use Navigation API if available (modern browsers, covers all navigations)
    if ('navigation' in window) {
      const navigation = window.navigation as EventTarget & {
        addEventListener(type: string, listener: EventListener): void
        removeEventListener(type: string, listener: EventListener): void
      }
      const onNavigate = () => {
        // Navigation API fires before URL changes; defer check to next microtask
        queueMicrotask(() => this.handleUrlChange())
      }
      navigation.addEventListener('navigatesuccess', onNavigate)
      this.urlChangeCleanups.push(() =>
        navigation.removeEventListener('navigatesuccess', onNavigate)
      )
    }

    // 3. Fallback polling (some SPA frameworks don't trigger History/Navigation API)
    this.urlChangeCheckInterval = setInterval(
      () => this.handleUrlChange(),
      1000
    )
  }

  private stopUrlChangeDetection() {
    if (this.urlChangeCheckInterval !== undefined) {
      clearInterval(this.urlChangeCheckInterval)
      this.urlChangeCheckInterval = undefined
    }
    for (const cleanup of this.urlChangeCleanups) {
      cleanup()
    }
    this.urlChangeCleanups = []
  }
}

import type { CommentEntity } from '@danmaku-anywhere/danmaku-converter'
import {
  DanmakuRenderer,
  type DanmakuRenderProps,
  type PerfReporter,
} from '@danmaku-anywhere/danmaku-engine'
import { inject, injectable } from 'inversify'
import { uiContainer } from '@/common/ioc/uiIoc'
import { type ILogger, LoggerSymbol } from '@/common/Logger'
import type { DanmakuOptions } from '@/common/options/danmakuOptions/constant'
import { ExtensionOptionsService } from '@/common/options/extensionOptions/service'
import { PerfTimer } from '@/common/utils/perf'
import { injectCss } from '@/content/common/injectCss'
import { DanmakuLayoutService } from '@/content/player/danmakuLayout/DanmakuLayout.service'
import { RectObserver } from '@/content/player/danmakuManager/RectObserver'
import { DanmakuDebugOverlayService } from '@/content/player/debugOverlay/DanmakuDebugOverlay.service'
import { VideoNodeObserverService } from '@/content/player/videoObserver/VideoNodeObserver.service'
import { createRemotePreparseTransport } from './remotePreparseTransport'

/**
 * DOM node pool for danmaku inner elements.
 * Recycles <div> nodes to reduce GC pressure from frequent creation/destruction.
 */
class DanmakuNodePool {
  private pool: HTMLDivElement[] = []
  private maxSize: number

  constructor(maxSize = 200) {
    this.maxSize = maxSize
  }

  acquire(): HTMLDivElement {
    const node = this.pool.pop()
    if (node) {
      return node
    }
    return document.createElement('div')
  }

  release(node: HTMLDivElement): void {
    if (this.pool.length >= this.maxSize) return
    // Reset all custom styles and attributes for safe reuse
    node.className = ''
    node.style.cssText = ''
    node.textContent = ''
    node.removeAttribute('data-text')
    this.pool.push(node)
  }

  clear(): void {
    this.pool.length = 0
  }
}

/**
 * Pure DOM render function — replaces the per-danmaku React Root.
 * Creates (or reuses from pool) an inner <div> with text, CSS classes,
 * and CSS custom properties that mirror the old DanmakuComponent output.
 */
function renderDanmaku(
  node: HTMLElement,
  props: DanmakuRenderProps,
  pool: DanmakuNodePool
): void {
  const { text, color, mode, gradient } = props

  const inner = pool.acquire()

  // Build className
  let className = `da-danmaku da-danmaku-${mode} da-danmaku-text-shadow`
  if (gradient) {
    className += gradient.stroke
      ? ' da-danmaku-gradient-stroke'
      : ' da-danmaku-gradient'
  }
  inner.className = className

  // Set text safely (no innerHTML)
  inner.textContent = text
  inner.setAttribute('data-text', text)

  // Set CSS custom properties via inline style
  const style = inner.style
  style.pointerEvents = 'none'
  style.setProperty('--color', color)

  if (gradient) {
    style.setProperty('--gradient-start', gradient.start)
    style.setProperty('--gradient-end', gradient.end)
    style.setProperty('--gradient-stroke', gradient.stroke ? '2px' : '0px')
  }

  node.appendChild(inner)
}

@injectable('Singleton')
export class DanmakuManagerService {
  private logger: ILogger

  private readonly nodePool = new DanmakuNodePool()

  private readonly renderer = new DanmakuRenderer((node, props) => {
    renderDanmaku(node, props, this.nodePool)
  })
  private readonly nodes: {
    wrapper: HTMLElement
    container: HTMLElement
  }

  private parent?: HTMLElement

  public video: HTMLVideoElement | null = null
  private comments: CommentEntity[] = []
  private hasComments = false

  // State
  public isMounted = false
  private started = false

  // Styles
  private rect = new DOMRectReadOnly()
  private injectedCss: HTMLElement[] = []
  private perfEnabled = false
  private perfTimer: PerfTimer

  // Observers
  private rectObs?: RectObserver

  // Bound event handlers (stable references for add/removeEventListener)
  private readonly boundHandleVideoNodeChange: (video: HTMLVideoElement) => void
  private readonly boundHandleVideoNodeRemove: (video: HTMLVideoElement) => void

  constructor(
    @inject(VideoNodeObserverService)
    private videoNodeObs: VideoNodeObserverService,
    @inject(DanmakuLayoutService)
    layoutManager: DanmakuLayoutService,
    @inject(DanmakuDebugOverlayService)
    private debugOverlayService: DanmakuDebugOverlayService,
    @inject(LoggerSymbol) logger: ILogger
  ) {
    this.logger = logger.sub('[DanmakuManagerService]')
    this.perfTimer = new PerfTimer(this.logger, 'player.mount', false)

    this.nodes = {
      wrapper: layoutManager.wrapper,
      container: layoutManager.container,
    }

    // If the page CSP blocks creating extension URL workers, we can stream preparse from background.
    this.renderer.setRemotePreparseTransport(createRemotePreparseTransport())

    this.debugOverlayService.attach(this.renderer)

    this.boundHandleVideoNodeChange = this.handleVideoNodeChange.bind(this)
    this.boundHandleVideoNodeRemove = this.handleVideoNodeRemove.bind(this)

    const extensionOptionsService = uiContainer.get(ExtensionOptionsService)

    extensionOptionsService
      .get()
      .then((options) => {
        this.debugOverlayService.setDebugEnabled(options.debug)
        this.setPerfEnabled(options.debug)
      })
      .catch((e) => this.logger.error(e))
    extensionOptionsService.onChange((options) => {
      this.debugOverlayService.setDebugEnabled(options.debug)
      this.setPerfEnabled(options.debug)
    })
  }

  private setPerfEnabled(enabled: boolean) {
    this.perfEnabled = enabled
    this.perfTimer.setEnabled(enabled)
    const reporter: PerfReporter | undefined = enabled
      ? this.perfTimer.measure.bind(this.perfTimer)
      : undefined
    this.renderer.setPerfReporter(reporter)
  }

  start(videoSelector: string) {
    if (this.started) return
    this.started = true
    this.logger.debug('Starting')

    this.videoNodeObs.addEventListener(
      'videoNodeChange',
      this.boundHandleVideoNodeChange
    )
    this.videoNodeObs.addEventListener(
      'videoNodeRemove',
      this.boundHandleVideoNodeRemove
    )

    this.videoNodeObs.start(videoSelector).catch((e) => {
      this.logger.error(e)
    })
  }

  public getWrapper() {
    return this.nodes.wrapper
  }

  private setupObs(video: HTMLVideoElement) {
    this.rectObs = new RectObserver(video)

    this.rectObs.onRectChange(this.handleRectChange)
  }

  private teardownObs() {
    this.rectObs?.cleanup()
    this.rectObs = undefined
  }

  private handleVideoNodeChange = (video: HTMLVideoElement) => {
    this.video = video

    this.teardownObs()
    this.setupObs(video)
    this.nodes.wrapper.style.visibility = 'visible'

    if (this.hasComments) {
      this.createDanmaku()
      this.debugOverlayService.mount()
    }
  }

  private handleVideoNodeRemove = (prev: HTMLVideoElement) => {
    this.video = null
    this.teardownObs()
    this.unmount()
    this.nodes.wrapper.style.visibility = 'hidden'
  }

  private handleRectChange = (rect: DOMRectReadOnly, notify = true) => {
    this.rect = rect
    this.updateContainerStyles()
    this.renderer.resize()
  }

  private updateContainerStyles() {
    this.nodes.wrapper.style.top = `${this.rect.top}px`
    this.nodes.wrapper.style.left = `${this.rect.left}px`
    this.nodes.wrapper.style.width = `${this.rect.width}px`
    this.nodes.wrapper.style.height = `${this.rect.height}px`
  }

  private createDanmaku() {
    if (!this.video || !this.hasComments) return

    if (!this.isMounted) {
      this.logger.debug('Mounting danmaku')

      this.attachContainer()

      if (this.perfEnabled) {
        this.perfTimer.mark('mount_enter')
      }
      this.renderer.create(this.nodes.container, this.video, this.comments)
      this.isMounted = true
      if (this.perfEnabled) {
        this.perfTimer.mark('renderer_create_done')
        this.perfTimer.summary('mount')
      }
    } else {
      // recreate danmaku if it's already mounted
      // this fixes an issue where danmaku can get "stuck" on the screen
      if (this.renderer.created) {
        this.recyclePooledNodes()
        this.renderer.destroy()
      }

      if (this.perfEnabled) {
        this.perfTimer.mark('mount_enter')
      }
      this.renderer.create(this.nodes.container, this.video, this.comments)
      if (this.perfEnabled) {
        this.perfTimer.mark('renderer_create_done')
        this.perfTimer.summary('mount')
      }
    }
  }

  mount(comments: CommentEntity[]) {
    this.comments = comments
    this.hasComments = true
    // Allow deferring the creation of danmaku
    // if video is not ready, danmaku will be created when video is ready
    if (this.video) {
      this.logger.debug('Mounting danmaku')
      this.createDanmaku()
      this.debugOverlayService.mount()
    } else {
      this.logger.debug('Video is not ready, waiting for video to be ready')
    }
  }

  unmount() {
    // If the danmaku is not mounted, only clear the comments
    if (!this.isMounted) {
      if (this.hasComments) {
        this.hasComments = false
        this.comments = []
      }
      return
    }

    this.cleanupInjectedCss()
    this.logger.debug('Unmounting danmaku')
    this.debugOverlayService.unmount()
    this.recyclePooledNodes()
    this.removeContainer()
    this.renderer.destroy()
    this.comments = []
    this.hasComments = false
    this.isMounted = false
  }

  setParent(parent: HTMLElement) {
    this.parent = parent
    this.parent.appendChild(this.nodes.wrapper)
  }

  updateConfig(config: Partial<DanmakuOptions>) {
    this.cleanupInjectedCss()
    if (this.parent && config.useCustomCss === true && config.customCss) {
      // TODO: validate css
      this.injectedCss = injectCss(this.parent, [config.customCss])
    }
    this.renderer.updateConfig(config)
    this.updateContainerStyles()
  }

  seek(time: number) {
    if (this.video) {
      this.video.currentTime = time
    }
  }

  private removeContainer() {
    this.nodes.container.remove()
  }

  private attachContainer() {
    // If the wrapper is already in the document, do nothing
    if (this.nodes.container.isConnected) return
    this.nodes.wrapper.appendChild(this.nodes.container)
  }

  show() {
    this.renderer.show()
  }

  hide() {
    this.renderer.hide()
  }

  resize() {
    this.handleRectChange(this.rect, false)
  }

  stop() {
    this.logger.debug('Stopping')
    this.started = false

    this.teardownObs()
    this.videoNodeObs.stop()
    this.debugOverlayService.unmount()
    this.unmount()
    this.nodePool.clear()
  }

  private cleanupInjectedCss() {
    this.injectedCss.forEach((style) => style.remove())
    this.injectedCss = []
  }

  /**
   * Collect all pooled inner <div> nodes from the container before
   * the engine destroys the DOM tree, and return them to the pool.
   */
  private recyclePooledNodes() {
    const container = this.nodes.container
    // The engine creates outer nodes (spans) inside container.
    // Each outer node has one inner <div> child created by renderDanmaku().
    const outerNodes = container.children
    for (const outer of outerNodes) {
      const inner = outer.firstElementChild
      if (inner instanceof HTMLDivElement) {
        this.nodePool.release(inner)
      }
    }
  }
}

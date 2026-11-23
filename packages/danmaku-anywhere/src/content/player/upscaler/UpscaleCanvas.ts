export class UpscaleCanvas {
  readonly element: HTMLCanvasElement
  private readonly video: HTMLVideoElement
  private resizeObserver: ResizeObserver | undefined
  private interval: ReturnType<typeof setInterval> | undefined
  private readonly onTopLayerChanged?: () => void
  private readonly originalOpacity: string

  constructor(video: HTMLVideoElement, onTopLayerChanged?: () => void) {
    this.video = video
    this.onTopLayerChanged = onTopLayerChanged
    this.originalOpacity = video.style.opacity
    this.element = document.createElement('canvas')
    this.element.dataset.danmakuAnywhereUpscale = 'true'
    this.element.style.position = 'absolute'
    this.element.style.pointerEvents = 'none'
    this.element.style.display = 'block'
    this.element.style.visibility = 'hidden'
    const slot = video.getAttribute('slot')
    if (slot) this.element.setAttribute('slot', slot)
    video.insertAdjacentElement('afterend', this.element)
    this.syncGeometry()
    this.resizeObserver = new ResizeObserver(() => this.syncGeometry())
    this.resizeObserver.observe(video)
    window.addEventListener('resize', this.syncGeometry)
    window.addEventListener('scroll', this.syncGeometry, true)
    document.addEventListener('fullscreenchange', this.handleFullscreenChange)
    this.interval = setInterval(this.syncGeometry, 1000)
  }

  setBufferSize(width: number, height: number) {
    this.element.width = Math.max(1, Math.floor(width))
    this.element.height = Math.max(1, Math.floor(height))
    this.syncGeometry()
  }

  show() {
    this.element.style.visibility = 'visible'
    this.video.style.opacity = '0'
    this.handleFullscreenChange()
  }

  hide() {
    this.element.style.visibility = 'hidden'
    this.video.style.opacity = this.originalOpacity
  }

  cleanup() {
    this.resizeObserver?.disconnect()
    window.removeEventListener('resize', this.syncGeometry)
    window.removeEventListener('scroll', this.syncGeometry, true)
    document.removeEventListener(
      'fullscreenchange',
      this.handleFullscreenChange
    )
    if (this.interval) clearInterval(this.interval)
    this.element.remove()
    this.video.style.opacity = this.originalOpacity
  }

  private syncGeometry = () => {
    const rect = this.video.getBoundingClientRect()
    const parent = this.element.offsetParent
    const parentRect =
      parent instanceof HTMLElement
        ? parent.getBoundingClientRect()
        : { left: 0, top: 0 }
    const sameOffsetParent = this.video.offsetParent === parent
    this.element.style.left = `${sameOffsetParent ? this.video.offsetLeft : rect.left - parentRect.left}px`
    this.element.style.top = `${sameOffsetParent ? this.video.offsetTop : rect.top - parentRect.top}px`
    this.element.style.width = `${this.video.offsetWidth || rect.width}px`
    this.element.style.height = `${this.video.offsetHeight || rect.height}px`
    const videoStyle = getComputedStyle(this.video)
    this.element.style.objectFit = videoStyle.objectFit
    this.element.style.objectPosition = videoStyle.objectPosition
    this.element.style.transform =
      videoStyle.transform === 'none' ? '' : videoStyle.transform
    this.element.style.transformOrigin = videoStyle.transformOrigin
    this.element.style.borderRadius = videoStyle.borderRadius
  }

  private handleFullscreenChange = () => {
    const videoIsFullscreen = document.fullscreenElement === this.video
    if (videoIsFullscreen && this.element.style.visibility === 'visible') {
      // Sibling elements of a fullscreen <video> are not rendered; promote the
      // canvas to the top layer via the Popover API for the duration.
      this.element.setAttribute('popover', 'manual')
      if (!this.isPopoverOpen() && 'showPopover' in this.element)
        this.element.showPopover()
      this.element.style.position = 'fixed'
      this.element.style.inset = '0'
      this.element.style.width = '100vw'
      this.element.style.height = '100vh'
      queueMicrotask(() => this.onTopLayerChanged?.())
      return
    }
    if (this.isPopoverOpen() && 'hidePopover' in this.element)
      this.element.hidePopover()
    // The UA stylesheet hides closed popovers with display:none !important,
    // so the attribute must not remain outside of fullscreen.
    this.element.removeAttribute('popover')
    this.element.style.position = 'absolute'
    this.element.style.inset = ''
    this.syncGeometry()
  }

  private isPopoverOpen() {
    try {
      return this.element.matches(':popover-open')
    } catch {
      return false
    }
  }
}

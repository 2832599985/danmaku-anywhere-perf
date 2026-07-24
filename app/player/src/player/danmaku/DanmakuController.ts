import type { CommentEntity } from '@danmaku-anywhere/danmaku-converter'
import {
  type DanmakuOptions,
  DanmakuRenderer,
  type DanmakuRenderProps,
} from '@danmaku-anywhere/danmaku-engine'
import type { DanmakuSettings } from '@/store/settings'

/**
 * The render callback the engine invokes per danmaku node. Ported from the
 * extension's renderDanmaku: append an inner <div> carrying the .da-danmaku*
 * classes + CSS custom properties. Never innerHTML. The matching CSS ships in
 * public/danmaku.css.
 */
const renderDanmaku = (node: HTMLElement, props: DanmakuRenderProps): void => {
  const { text, mode, color, gradient } = props
  const inner = document.createElement('div')
  let className = `da-danmaku da-danmaku-${mode} da-danmaku-text-shadow`
  if (gradient) {
    className += gradient.stroke
      ? ' da-danmaku-gradient-stroke'
      : ' da-danmaku-gradient'
  }
  inner.className = className
  inner.textContent = text
  inner.style.pointerEvents = 'none'
  inner.style.setProperty('--color', color)
  if (gradient) {
    inner.style.setProperty('--gradient-start', gradient.start)
    inner.style.setProperty('--gradient-end', gradient.end)
    inner.style.setProperty(
      '--gradient-stroke',
      gradient.stroke ? '2px' : '0px'
    )
  }
  node.appendChild(inner)
}

const toEngineConfig = (s: DanmakuSettings): Partial<DanmakuOptions> => ({
  show: s.visible,
  style: {
    opacity: s.opacity,
    fontSize: s.fontSize,
    fontFamily: 'sans-serif',
  },
  speed: s.speed,
  area: { yStart: 0, yEnd: s.area, xStart: 0, xEnd: 100 },
  offset: s.offset,
  maxOnScreen: s.maxOnScreen,
  overlap: s.overlap,
})

/**
 * Owns the DanmakuRenderer over an overlay container. All video↔danmaku
 * synchronization (play/pause/seek/time) is automatic inside the engine's
 * bindVideo plugin — we only feed comments + config and forward resizes.
 */
export class DanmakuController {
  private readonly container: HTMLElement
  private readonly renderer: DanmakuRenderer
  private mounted = false

  constructor(container: HTMLElement) {
    this.container = container
    this.renderer = new DanmakuRenderer(renderDanmaku)
  }

  /** (Re)mount comments against the given video. create() destroys any prior instance. */
  setComments(
    video: HTMLVideoElement,
    comments: CommentEntity[],
    settings: DanmakuSettings
  ): void {
    this.renderer.create(
      this.container,
      video,
      comments,
      toEngineConfig(settings)
    )
    this.mounted = true
    this.applyVisibility(settings.visible)
  }

  updateSettings(settings: DanmakuSettings): void {
    if (!this.mounted) return
    this.renderer.updateConfig(toEngineConfig(settings))
    this.applyVisibility(settings.visible)
  }

  private applyVisibility(visible: boolean): void {
    if (visible) this.renderer.show()
    else this.renderer.hide()
  }

  resize(): void {
    if (this.mounted) this.renderer.resize()
  }

  /** Remove all danmaku (e.g. when the source is cleared). */
  clear(): void {
    this.renderer.destroy()
    this.mounted = false
  }

  destroy(): void {
    this.renderer.destroy()
    this.mounted = false
  }
}

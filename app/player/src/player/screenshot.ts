import type { SubtitleSettings } from '@/store/settings'

/**
 * Video-frame screenshot compositor: captures the clean `<video>` or upscaled
 * WebGPU `<canvas>` (never chrome/OSD/progress bar), then optionally draws the
 * active danmaku and/or subtitle layers onto the same canvas at full output
 * resolution.
 */

export interface CapturedFrame {
  width: number
  height: number
  /** Top-down RGBA8 pixels (width * height * 4 bytes). */
  rgba: Uint8Array
  /** PNG bytes/blob, populated when requested (browser clipboard or local save). */
  pngBlob: Blob | null
  pngBytes: Uint8Array | null
  upscaled: boolean
  drewDanmaku: boolean
  drewSubtitles: boolean
}

export interface VideoBox {
  x: number
  y: number
  width: number
  height: number
}

export interface CaptureOptions {
  /** Whether to encode a PNG blob/bytes in addition to raw RGBA pixels. */
  encodePng?: boolean
  /** Stage element whose bounding box frames `object-fit: contain`. */
  stageEl?: HTMLElement | null
  /** Live danmaku DOM container; pass only when danmaku should be composited. */
  danmakuLayer?: HTMLElement | null
  /** Live subtitle DOM container; pass only when subtitles should be composited. */
  subtitleLayer?: HTMLElement | null
  /** User subtitle appearance (used to place bottom/top rows unlifted). */
  subtitleSettings?: Pick<
    SubtitleSettings,
    'visible' | 'fontSize' | 'bottom' | 'opacity' | 'outline'
  >
}

/**
 * Compute the rendered `object-fit: contain` rectangle of a video inside its
 * stage container (all values in CSS px relative to the stage top-left).
 */
export const computeVideoBox = (
  stageWidth: number,
  stageHeight: number,
  videoWidth: number,
  videoHeight: number
): VideoBox => {
  if (
    !(stageWidth > 0 && stageHeight > 0 && videoWidth > 0 && videoHeight > 0)
  ) {
    return {
      x: 0,
      y: 0,
      width: Math.max(1, stageWidth),
      height: Math.max(1, stageHeight),
    }
  }
  const stageAr = stageWidth / stageHeight
  const videoAr = videoWidth / videoHeight
  if (stageAr > videoAr) {
    // Pillarboxed (black bars left & right)
    const width = stageHeight * videoAr
    return { x: (stageWidth - width) / 2, y: 0, width, height: stageHeight }
  }
  // Letterboxed (black bars top & bottom)
  const height = stageWidth / videoAr
  return { x: 0, y: (stageHeight - height) / 2, width: stageWidth, height }
}

const sampleHasOpaquePixel = (
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number
): boolean => {
  const xs = [0.15, 0.5, 0.85]
  const ys = [0.15, 0.5, 0.85]
  for (const fx of xs) {
    for (const fy of ys) {
      const x = Math.min(width - 1, Math.max(0, Math.floor(width * fx)))
      const y = Math.min(height - 1, Math.max(0, Math.floor(height * fy)))
      const pixel = ctx.getImageData(x, y, 1, 1).data
      if (pixel[3] > 0) return true
    }
  }
  return false
}

const canvasToPngBlob = (canvas: HTMLCanvasElement): Promise<Blob> =>
  new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob)
      else reject(new Error('无法编码 PNG 截图'))
    }, 'image/png')
  })

/** Build a clean default file name like `葬送的芙莉莲_12-34.png`. */
export const screenshotFileName = (
  mediaName: string,
  currentTimeSec: number
): string => {
  const stem =
    Array.from(mediaName.replace(/\.[^./\\]+$/, ''), (ch) =>
      ch.charCodeAt(0) < 0x20 ? '_' : ch
    )
      .join('')
      .replace(/[<>:"/\\|?*]+/g, '_')
      .trim() || 'screenshot'
  const total =
    Number.isFinite(currentTimeSec) && currentTimeSec > 0
      ? Math.floor(currentTimeSec)
      : 0
  const s = total % 60
  const m = Math.floor((total / 60) % 60)
  const h = Math.floor(total / 3600)
  const pad = (n: number) => n.toString().padStart(2, '0')
  const stamp = h > 0 ? `${h}-${pad(m)}-${pad(s)}` : `${pad(m)}-${pad(s)}`
  return `${stem}_${stamp}.png`
}

/** Human summary shown in the OSD after a screenshot completes. */
export const formatScreenshotOsd = (params: {
  upscaled: boolean
  requestedOriginal: boolean
  drewDanmaku: boolean
  drewSubtitles: boolean
  copied: boolean
  saved: boolean
}): string => {
  const layers: string[] = []
  if (params.requestedOriginal) layers.push('原片')
  else if (params.upscaled) layers.push('超分')
  if (params.drewDanmaku) layers.push('弹幕')
  if (params.drewSubtitles) layers.push('字幕')
  const tag = layers.length > 0 ? layers.join(' + ') : '纯画面'

  if (params.copied && params.saved) return `已截图（${tag}）· 已复制并保存`
  if (params.copied) return `已截图（${tag}）· 已复制到剪贴板`
  return `已保存截图（${tag}）· 剪贴板写入失败`
}

/** Multiply CSS opacity walking from `node` up to (excluding) `stopAt`. */
const effectiveOpacity = (node: HTMLElement, stopAt: HTMLElement): number => {
  let alpha = 1
  let cur: HTMLElement | null = node
  while (cur && cur !== stopAt) {
    const cs = window.getComputedStyle(cur)
    if (cs.display === 'none' || cs.visibility === 'hidden') return 0
    const op = Number.parseFloat(cs.opacity)
    if (Number.isFinite(op)) alpha *= op
    if (alpha <= 0.001) return 0
    cur = cur.parentElement
  }
  return Math.max(0, Math.min(1, alpha))
}

/** Draw all currently visible `.da-danmaku` DOM nodes onto the screenshot canvas. */
const compositeDanmaku = (
  ctx: CanvasRenderingContext2D,
  layer: HTMLElement,
  stageRect: DOMRect,
  videoBox: VideoBox,
  outWidth: number,
  outHeight: number
): boolean => {
  const nodes = layer.querySelectorAll<HTMLElement>('.da-danmaku')
  if (nodes.length === 0) return false
  const scale = outWidth / videoBox.width
  let drewAny = false

  ctx.save()
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'left'
  ctx.lineJoin = 'round'

  for (const node of nodes) {
    const text = node.textContent
    if (!text) continue
    const alpha = effectiveOpacity(node, layer)
    if (alpha <= 0.001) continue

    const rect = node.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) continue

    const x = (rect.left - stageRect.left - videoBox.x) * scale
    const y = (rect.top - stageRect.top - videoBox.y) * scale
    const w = rect.width * scale
    const h = rect.height * scale
    if (x + w < 0 || x > outWidth || y + h < 0 || y > outHeight) continue

    const cs = window.getComputedStyle(node)
    const fontPx = Math.max(10, (Number.parseFloat(cs.fontSize) || 24) * scale)
    const weight = cs.fontWeight || '700'
    const family = cs.fontFamily || 'sans-serif'
    const cy = y + h / 2

    ctx.globalAlpha = alpha
    ctx.font = `${weight} ${fontPx}px ${family}`

    const gradStart = cs.getPropertyValue('--gradient-start').trim()
    const gradEnd = cs.getPropertyValue('--gradient-end').trim()

    // Crisp dark outline matching `.da-danmaku-text-shadow`
    ctx.shadowColor = 'rgba(0, 0, 0, 0.55)'
    ctx.shadowBlur = Math.max(2, fontPx * 0.12)
    ctx.shadowOffsetX = 0
    ctx.shadowOffsetY = Math.max(1, fontPx * 0.06)
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.9)'
    ctx.lineWidth = Math.max(2, fontPx * 0.1)
    ctx.strokeText(text, x, cy)

    ctx.shadowColor = 'transparent'
    if (gradStart && gradEnd) {
      const grad = ctx.createLinearGradient(x, cy, x + w, cy)
      grad.addColorStop(0, gradStart)
      grad.addColorStop(1, gradEnd)
      ctx.fillStyle = grad
    } else {
      ctx.fillStyle = cs.color || '#ffffff'
    }
    ctx.fillText(text, x, cy)
    drewAny = true
  }

  ctx.restore()
  return drewAny
}

/** Wrap a single text paragraph to fit inside `maxWidth` px on `ctx`. */
const wrapParagraph = (
  ctx: CanvasRenderingContext2D,
  paragraph: string,
  maxWidth: number
): string[] => {
  if (!paragraph) return ['']
  if (ctx.measureText(paragraph).width <= maxWidth) return [paragraph]
  const lines: string[] = []
  let current = ''
  for (const ch of Array.from(paragraph)) {
    const next = current + ch
    if (current && ctx.measureText(next).width > maxWidth) {
      lines.push(current)
      current = ch === ' ' ? '' : ch
    } else {
      current = next
    }
  }
  if (current) lines.push(current)
  return lines
}

interface PreparedSubLine {
  wrapped: string[]
  font: string
  fontPx: number
  lineHeightPx: number
  align: CanvasTextAlign
  secondary: boolean
}

const prepareSubLine = (
  ctx: CanvasRenderingContext2D,
  node: HTMLElement,
  scale: number,
  maxWidth: number
): PreparedSubLine | null => {
  const raw = node.textContent
  if (!raw?.trim()) return null
  const cs = window.getComputedStyle(node)
  const fontPx = Math.max(12, (Number.parseFloat(cs.fontSize) || 30) * scale)
  const style = cs.fontStyle === 'italic' ? 'italic ' : ''
  const weight = cs.fontWeight || '700'
  const family =
    cs.fontFamily ||
    '"Noto Sans SC", "Microsoft YaHei", "PingFang SC", system-ui, sans-serif'
  const font = `${style}${weight} ${fontPx}px ${family}`
  ctx.font = font
  const wrapped = raw
    .split(/\r?\n/)
    .flatMap((para) => wrapParagraph(ctx, para, maxWidth))
  const h = node.dataset.h
  const align: CanvasTextAlign =
    h === 'left' ? 'left' : h === 'right' ? 'right' : 'center'
  return {
    wrapped,
    font,
    fontPx,
    lineHeightPx: fontPx * 1.35,
    align,
    secondary: node.dataset.secondary === 'true',
  }
}

export const drawPreparedSubLine = (
  ctx: CanvasRenderingContext2D,
  line: PreparedSubLine,
  x: number,
  startY: number,
  outline: boolean
): number => {
  ctx.font = line.font
  ctx.textAlign = line.align
  ctx.textBaseline = 'top'
  let y = startY
  for (const text of line.wrapped) {
    if (outline) {
      ctx.shadowColor = 'rgba(10, 10, 12, 0.85)'
      ctx.shadowBlur = Math.max(3, line.fontPx * 0.2)
      ctx.shadowOffsetX = 0
      ctx.shadowOffsetY = Math.max(1, line.fontPx * 0.04)
      ctx.strokeStyle = '#0a0a0c'
      ctx.lineWidth = Math.max(2, line.fontPx * 0.14)
      ctx.strokeText(text, x, y)
      ctx.shadowColor = 'transparent'
      ctx.shadowBlur = 0
    } else {
      ctx.shadowColor = 'rgba(10, 10, 12, 0.9)'
      ctx.shadowBlur = Math.max(3, line.fontPx * 0.12)
      ctx.shadowOffsetX = 0
      ctx.shadowOffsetY = 0
    }
    ctx.fillStyle = line.secondary ? 'rgba(244, 241, 232, 0.84)' : '#f4f1e8'
    ctx.fillText(text, x, y)
    ctx.shadowColor = 'transparent'
    ctx.shadowBlur = 0
    y += line.lineHeightPx
  }
  return y
}

/**
 * Draw active subtitle lines onto the screenshot canvas.
 *
 * Bottom & top rows are anchored at their true resting margin (`bottom%` / `3%`)
 * rather than their live `.sub-lifted` screen coordinates, so clicking the
 * screenshot button while the control bar is open never leaves subtitles
 * floating awkwardly in mid-air.
 */
const compositeSubtitles = (
  ctx: CanvasRenderingContext2D,
  layer: HTMLElement,
  stageRect: DOMRect,
  videoBox: VideoBox,
  outWidth: number,
  outHeight: number,
  settings: Pick<
    SubtitleSettings,
    'visible' | 'fontSize' | 'bottom' | 'opacity' | 'outline'
  >
): boolean => {
  if (!settings.visible) return false
  const root = layer.querySelector<HTMLElement>('.sub-root')
  if (!root) return false
  if (window.getComputedStyle(root).visibility === 'hidden') return false

  const scale = outWidth / videoBox.width
  const padX = outWidth * 0.04
  const maxWidth = outWidth - padX * 2
  let drewAny = false

  ctx.save()
  ctx.globalAlpha = Math.max(0, Math.min(1, settings.opacity))
  ctx.lineJoin = 'round'

  const drawRow = (
    selector: string,
    anchor: 'top' | 'middle' | 'bottom'
  ): void => {
    const nodes = root.querySelectorAll<HTMLElement>(`${selector} > .sub-line`)
    if (nodes.length === 0) return
    const prepared: PreparedSubLine[] = []
    for (const node of nodes) {
      const p = prepareSubLine(ctx, node, scale, maxWidth)
      if (p) prepared.push(p)
    }
    if (prepared.length === 0) return

    const rowGapPx = Math.max(
      2,
      (prepared[0]?.fontPx ?? settings.fontSize * scale) * 0.16
    )
    const totalHeight =
      prepared.reduce((sum, p) => sum + p.wrapped.length * p.lineHeightPx, 0) +
      rowGapPx * Math.max(0, prepared.length - 1)

    let y =
      anchor === 'top'
        ? outHeight * 0.03
        : anchor === 'middle'
          ? (outHeight - totalHeight) / 2
          : outHeight * (1 - settings.bottom / 100) - totalHeight

    for (const line of prepared) {
      const x =
        line.align === 'left'
          ? padX
          : line.align === 'right'
            ? outWidth - padX
            : outWidth / 2
      y = drawPreparedSubLine(ctx, line, x, y, settings.outline) + rowGapPx
      drewAny = true
    }
  }

  drawRow('.sub-row-top', 'top')
  drawRow('.sub-row-middle', 'middle')
  drawRow('.sub-row-bottom', 'bottom')

  // ASS `\pos` signs live inside `.sub-frame` (= videoBox) and are never lifted.
  const signs = root.querySelectorAll<HTMLElement>('.sub-frame > .sub-sign')
  for (const node of signs) {
    const rect = node.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) continue
    const prepared = prepareSubLine(ctx, node, scale, outWidth * 0.9)
    if (!prepared) continue
    const left = (rect.left - stageRect.left - videoBox.x) * scale
    const top = (rect.top - stageRect.top - videoBox.y) * scale
    const width = rect.width * scale
    const x =
      prepared.align === 'left'
        ? left
        : prepared.align === 'right'
          ? left + width
          : left + width / 2
    drawPreparedSubLine(ctx, prepared, x, top, settings.outline)
    drewAny = true
  }

  ctx.restore()
  return drewAny
}

export const captureVideoFrame = async (
  video: HTMLVideoElement,
  upscaleCanvas: HTMLCanvasElement | null,
  options: CaptureOptions = {}
): Promise<CapturedFrame> => {
  if (video.readyState < 2 || !video.videoWidth || !video.videoHeight) {
    throw new Error('视频尚未加载出画面')
  }

  const out = document.createElement('canvas')
  const ctx = out.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('无法创建截图画布')

  let upscaled = false
  if (
    upscaleCanvas &&
    upscaleCanvas.width > 0 &&
    upscaleCanvas.height > 0 &&
    upscaleCanvas.style.visibility !== 'hidden'
  ) {
    // Wait one rAF when playing so the WebGPU presentation pass has just
    // painted into the swapchain for this compositor turn.
    if (!video.paused) {
      await new Promise<void>((resolve) =>
        window.requestAnimationFrame(() => resolve())
      )
    }
    try {
      out.width = upscaleCanvas.width
      out.height = upscaleCanvas.height
      ctx.clearRect(0, 0, out.width, out.height)
      ctx.drawImage(upscaleCanvas, 0, 0, out.width, out.height)
      if (sampleHasOpaquePixel(ctx, out.width, out.height)) {
        upscaled = true
      }
    } catch {
      upscaled = false
    }
  }

  if (!upscaled) {
    out.width = video.videoWidth
    out.height = video.videoHeight
    ctx.drawImage(video, 0, 0, out.width, out.height)
  }

  let drewDanmaku = false
  let drewSubtitles = false
  if (options.stageEl && (options.danmakuLayer || options.subtitleLayer)) {
    const stageRect = options.stageEl.getBoundingClientRect()
    const videoBox = computeVideoBox(
      stageRect.width,
      stageRect.height,
      video.videoWidth,
      video.videoHeight
    )
    if (options.danmakuLayer) {
      drewDanmaku = compositeDanmaku(
        ctx,
        options.danmakuLayer,
        stageRect,
        videoBox,
        out.width,
        out.height
      )
    }
    if (options.subtitleLayer && options.subtitleSettings) {
      drewSubtitles = compositeSubtitles(
        ctx,
        options.subtitleLayer,
        stageRect,
        videoBox,
        out.width,
        out.height,
        options.subtitleSettings
      )
    }
  }

  const imageData = ctx.getImageData(0, 0, out.width, out.height)
  const rgba = new Uint8Array(
    imageData.data.buffer,
    imageData.data.byteOffset,
    imageData.data.byteLength
  )

  let pngBlob: Blob | null = null
  let pngBytes: Uint8Array | null = null
  if (options.encodePng) {
    pngBlob = await canvasToPngBlob(out)
    pngBytes = new Uint8Array(await pngBlob.arrayBuffer())
  }

  return {
    width: out.width,
    height: out.height,
    rgba,
    pngBlob,
    pngBytes,
    upscaled,
    drewDanmaku,
    drewSubtitles,
  }
}

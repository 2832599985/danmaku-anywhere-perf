/**
 * Pure video-frame screenshot capture (no chrome, OSD, danmaku or subtitles).
 *
 * When Anime4K super-resolution is active and the WebGPU canvas has a readable
 * frame in its current swapchain buffer, we capture that upscaled frame. If
 * the swapchain was already cleared (common when paused), we detect the empty
 * alpha channel and fall back transparently to the native `<video>` frame so
 * a screenshot is never blank.
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

export const captureVideoFrame = async (
  video: HTMLVideoElement,
  upscaleCanvas: HTMLCanvasElement | null,
  options: { encodePng?: boolean } = {}
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
  }
}

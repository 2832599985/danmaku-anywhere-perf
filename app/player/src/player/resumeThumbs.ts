/**
 * "Continue watching" thumbnails: the frame on screen when a video was last
 * left (paused, switched away, window closed), shown on the idle screen's
 * resume cards.
 *
 * Stored by the platform (desktop: JPEG files in the app cache, see
 * src-tauri/src/thumbs.rs), never in localStorage — a localStorage write made
 * while the window closes does not reach disk. The close path therefore
 * awaits `snapshotThumb` inside `Platform.onCloseRequested`.
 */
import type { Platform } from '@/platform/types'

export const THUMB_WIDTH = 320

/** Luma (0..255) under which a sample counts as black. */
const BLACK_LUMA = 24
/** Share of samples that must be lit for a frame to count as a picture. */
const LIT_SHARE = 0.03

/**
 * A frame is "black" (scene cut, fade, the OP's black lead-in) when almost
 * none of its samples are lit. Such a frame is skipped and the previous
 * thumbnail kept. `rgba` is ImageData.data.
 */
export const isMostlyBlack = (rgba: ArrayLike<number>): boolean => {
  const samples = Math.floor(rgba.length / 4)
  if (samples === 0) return true
  let lit = 0
  for (let i = 0; i < samples; i += 1) {
    const o = i * 4
    const luma = 0.299 * rgba[o] + 0.587 * rgba[o + 1] + 0.114 * rgba[o + 2]
    if (luma > BLACK_LUMA) lit += 1
  }
  return lit / samples < LIT_SHARE
}

/**
 * Draw the video's current frame into a THUMB_WIDTH canvas — synchronously,
 * so the pixels are taken before a src swap — or null when there is no frame
 * yet, the frame is black, or the canvas is tainted.
 */
export const captureFrame = (
  video: HTMLVideoElement
): HTMLCanvasElement | null => {
  if (video.readyState < 2 || !video.videoWidth || !video.videoHeight) {
    return null
  }
  const width = THUMB_WIDTH
  const height = Math.max(
    1,
    Math.round((width * video.videoHeight) / video.videoWidth)
  )
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  try {
    ctx.drawImage(video, 0, 0, width, height)
    // A coarse 32-wide sample is plenty to tell a picture from black.
    const probe = document.createElement('canvas')
    probe.width = 32
    probe.height = Math.max(1, Math.round((32 * height) / width))
    const probeCtx = probe.getContext('2d', { willReadFrequently: true })
    if (!probeCtx) return null
    probeCtx.drawImage(canvas, 0, 0, probe.width, probe.height)
    const { data } = probeCtx.getImageData(0, 0, probe.width, probe.height)
    return isMostlyBlack(data) ? null : canvas
  } catch {
    // Tainted canvas (a non-CORS source) or a decoder hiccup: no thumbnail.
    return null
  }
}

const encodeJpeg = (canvas: HTMLCanvasElement): Promise<Uint8Array | null> =>
  new Promise((resolve) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          resolve(null)
          return
        }
        blob
          .arrayBuffer()
          .then((buf) => resolve(new Uint8Array(buf)))
          .catch(() => resolve(null))
      },
      'image/jpeg',
      0.72
    )
  })

/**
 * Capture the current frame for `path` and store it; a black or absent frame
 * keeps the previous thumbnail. Never rejects — thumbnails are a nicety.
 */
export const snapshotThumb = async (
  platform: Platform,
  path: string,
  video: HTMLVideoElement
): Promise<void> => {
  const canvas = captureFrame(video)
  if (!canvas) return
  try {
    const jpeg = await encodeJpeg(canvas)
    if (jpeg) await platform.saveResumeThumb(path, jpeg)
  } catch {
    // ignore
  }
}

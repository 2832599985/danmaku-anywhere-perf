/**
 * Detect whether the currently-decoded video frame is HDR by reading its
 * WebCodecs VideoColorSpace transfer function:
 *   - 'pq'  → HDR10 / PQ (also the base layer of Dolby Vision profile 8.1)
 *   - 'hlg' → HLG HDR
 * Chromium/WebView2 does not expose the transfer function on the <video>
 * element directly, but constructing a VideoFrame from a painted frame does.
 * Call from a requestVideoFrameCallback (or after 'loadeddata') so a decoded
 * frame exists. Returns the transfer string when HDR, otherwise null.
 */
export const detectHdrTransfer = (video: HTMLVideoElement): string | null => {
  if (typeof VideoFrame === 'undefined') return null
  let frame: VideoFrame | null = null
  try {
    frame = new VideoFrame(video)
    // The DOM lib's VideoTransferCharacteristics union predates the HDR values,
    // so read it as a plain string. Runtime reports 'pq' / 'hlg' for HDR.
    const transfer = (frame.colorSpace?.transfer ?? null) as string | null
    return transfer === 'pq' || transfer === 'hlg' ? transfer : null
  } catch {
    // Not enough of a frame yet, or construction unsupported — treat as SDR.
    return null
  } finally {
    frame?.close()
  }
}

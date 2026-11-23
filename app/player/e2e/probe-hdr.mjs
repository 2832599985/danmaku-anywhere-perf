// Probe the running player's WebView2 for HDR10 / HEVC / AV1 decode capability.
// Launch the exe first with WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222
import { chromium } from '@playwright/test'

const cdp = await chromium.connectOverCDP('http://127.0.0.1:9222')
const page = cdp.contexts().flatMap((c) => c.pages())[0]
if (!page) {
  console.log('FATAL: no page')
  process.exit(1)
}

const info = await page.evaluate(async () => {
  const out = {}

  // --- display / HDR signalling ---
  out.dynamicRangeHigh = matchMedia('(dynamic-range: high)').matches
  out.videoDynamicRangeHigh = matchMedia('(video-dynamic-range: high)').matches
  out.colorGamutP3 = matchMedia('(color-gamut: p3)').matches
  out.colorGamutRec2020 = matchMedia('(color-gamut: rec2020)').matches
  out.colorDepth = screen.colorDepth
  out.devicePixelRatio = window.devicePixelRatio

  // --- canPlayType quick check ---
  const v = document.createElement('video')
  out.canPlay = {
    hevcMain10: v.canPlayType('video/mp4; codecs="hvc1.2.4.L153.B0"'),
    hevc8: v.canPlayType('video/mp4; codecs="hvc1.1.6.L153.B0"'),
    av1_10bit: v.canPlayType('video/mp4; codecs="av01.0.09M.10"'),
    h264: v.canPlayType('video/mp4; codecs="avc1.640028"'),
    eac3_atmosCore: v.canPlayType('audio/mp4; codecs="ec-3"'),
    ac3: v.canPlayType('audio/mp4; codecs="ac-3"'),
  }

  // --- mediaCapabilities: proper HDR10 decode query ---
  const q = async (label, contentType, hdr) => {
    try {
      const cfg = {
        type: 'file',
        video: {
          contentType,
          width: 3840,
          height: 2160,
          bitrate: 20_000_000,
          framerate: 24,
          ...(hdr
            ? {
                transferFunction: 'pq',
                colorGamut: 'rec2020',
                hdrMetadataType: 'smpteSt2086',
              }
            : {}),
        },
      }
      const r = await navigator.mediaCapabilities.decodingInfo(cfg)
      return `${label}: supported=${r.supported} smooth=${r.smooth} powerEfficient=${r.powerEfficient}`
    } catch (e) {
      return `${label}: ERROR ${e.message}`
    }
  }

  out.mediaCapabilities = []
  out.mediaCapabilities.push(
    await q('HEVC Main10 HDR10', 'video/mp4; codecs="hvc1.2.4.L153.B0"', true)
  )
  out.mediaCapabilities.push(
    await q('HEVC Main10 SDR', 'video/mp4; codecs="hvc1.2.4.L153.B0"', false)
  )
  out.mediaCapabilities.push(
    await q('AV1 10-bit HDR10', 'video/mp4; codecs="av01.0.09M.10"', true)
  )
  out.mediaCapabilities.push(
    await q('H.264 SDR', 'video/mp4; codecs="avc1.640028"', false)
  )
  return out
})

console.log(JSON.stringify(info, null, 2))
await cdp.close()

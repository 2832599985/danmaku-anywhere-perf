import { describe, expect, it } from 'vitest'
import {
  computeVideoBox,
  formatScreenshotOsd,
  screenshotFileName,
} from './screenshot'

describe('screenshotFileName', () => {
  it('formats mm-ss and hh-mm-ss timestamps and strips illegal chars', () => {
    expect(screenshotFileName('葬送的芙莉莲 - 01.mkv', 75.8)).toBe(
      '葬送的芙莉莲 - 01_01-15.png'
    )
    expect(screenshotFileName('Movie:Part*1?.mp4', 3661)).toBe(
      'Movie_Part_1__1-01-01.png'
    )
    expect(screenshotFileName('clip.mp4', Number.NaN)).toBe('clip_00-00.png')
  })
})

describe('computeVideoBox', () => {
  it('computes pillarbox and letterbox rectangles accurately', () => {
    // 16:9 video in a wider 2000x900 stage → pillarboxed
    const pillar = computeVideoBox(2000, 900, 1920, 1080)
    expect(pillar.y).toBe(0)
    expect(pillar.height).toBe(900)
    expect(pillar.width).toBeCloseTo(1600)
    expect(pillar.x).toBeCloseTo(200)

    // 16:9 video in a taller 1600x1200 stage → letterboxed
    const letter = computeVideoBox(1600, 1200, 1920, 1080)
    expect(letter.x).toBe(0)
    expect(letter.width).toBe(1600)
    expect(letter.height).toBeCloseTo(900)
    expect(letter.y).toBeCloseTo(150)
  })
})

describe('formatScreenshotOsd', () => {
  it('summarizes the composited layers clearly', () => {
    expect(
      formatScreenshotOsd({
        upscaled: false,
        requestedOriginal: false,
        drewDanmaku: false,
        drewSubtitles: false,
        copied: true,
        saved: false,
      })
    ).toBe('已截图（纯画面）· 已复制到剪贴板')

    expect(
      formatScreenshotOsd({
        upscaled: true,
        requestedOriginal: false,
        drewDanmaku: true,
        drewSubtitles: true,
        copied: true,
        saved: true,
      })
    ).toBe('已截图（超分 + 弹幕 + 字幕）· 已复制并保存')

    expect(
      formatScreenshotOsd({
        upscaled: false,
        requestedOriginal: true,
        drewDanmaku: false,
        drewSubtitles: true,
        copied: true,
        saved: false,
      })
    ).toBe('已截图（原片 + 字幕）· 已复制到剪贴板')
  })
})

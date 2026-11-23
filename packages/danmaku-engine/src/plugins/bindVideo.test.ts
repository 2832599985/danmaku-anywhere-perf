// @vitest-environment jsdom

import type { CommentEntity } from '@danmaku-anywhere/danmaku-converter'
import type { Manager } from '@mr-quin/danmu'
import { describe, expect, it, vi } from 'vitest'
import type { DanmakuOptions } from '../options'
import type { ParsedComment, TimedComment } from '../parser'
import { bindVideo } from './bindVideo'

describe('bindVideo', () => {
  it('skips comments that fail to transform without breaking the timeline loop', () => {
    const video = document.createElement('video') as unknown as HTMLMediaElement
    Object.defineProperty(video, 'currentTime', { value: 1, writable: true })

    const badRaw: CommentEntity = {
      p: '0,999,16777215',
      m: 'bad',
    }
    const goodRaw: CommentEntity = {
      p: '0.01,1,16777215',
      m: 'good',
    }

    const bad: TimedComment = { time: 0, raw: badRaw }
    const good: TimedComment = { time: 0.01, raw: goodRaw }

    const unshift = vi.fn()
    const manager = {
      trackCount: 1,
      container: { width: 1920, height: 1080 },
      unshift,
      pushFlexibleDanmaku: vi.fn(),
      isFreeze: () => false,
      clear: vi.fn(),
      freeze: vi.fn(),
      unfreeze: vi.fn(),
      startPlaying: vi.fn(),
      stopPlaying: vi.fn(),
      getTrack: () => ({ location: { middle: 0 } }),
      each: vi.fn(),
      use: (plugin: { start?: () => void }) => {
        plugin.start?.()
      },
      setStyle: vi.fn(),
      updateOptions: vi.fn(),
      setArea: vi.fn(),
      mount: vi.fn(),
      unmount: vi.fn(),
      hide: vi.fn(),
      show: vi.fn(),
    } as unknown as Manager<ParsedComment>

    const getConfig = (): DanmakuOptions =>
      ({
        offset: 0,
        allowOverlap: false,
        overlap: 0,
        speed: 1,
        interval: 200,
        distribution: 'random',
        trackHeight: 32,
        maxOnScreen: 500,
        trackLimit: 32,
        show: true,
        filters: [],
        style: { opacity: 1, fontSize: 25, fontFamily: 'sans-serif' },
        area: { xStart: 0, xEnd: 100, yStart: 0, yEnd: 100 },
        specialComments: { top: 'normal', bottom: 'scroll' },
      }) as unknown as DanmakuOptions

    bindVideo(video, [bad, good], getConfig)(manager)

    video.dispatchEvent(new Event('timeupdate'))

    expect(bad.parseError).toBe(true)
    expect(unshift).toHaveBeenCalledTimes(1)
    expect(unshift.mock.calls[0][0].text).toBe('good')
  })
})

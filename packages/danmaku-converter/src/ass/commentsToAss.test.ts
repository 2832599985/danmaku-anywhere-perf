import { describe, expect, it } from 'vitest'
import { commentsToAss, formatAssTime } from './commentsToAss'

describe('commentsToAss', () => {
  it('carries centisecond rounding across second and minute boundaries and clamps negatives', () => {
    expect(formatAssTime(59.996)).toBe('0:01:00.00')
    expect(formatAssTime(3599.999)).toBe('1:00:00.00')
    expect(formatAssTime(-2.5)).toBe('0:00:00.00')
  })

  it('stacks concurrent top/bottom danmaku on distinct vertical tracks instead of overlapping', () => {
    const ass = commentsToAss([
      { cid: 1, p: '10,5,16777215', m: '顶部第一条' },
      { cid: 2, p: '11,5,16777215', m: '顶部第二条' },
      { cid: 3, p: '10,4,16777215', m: '底部第一条' },
      { cid: 4, p: '10.5,4,16777215', m: '底部第二条' },
    ])

    expect(ass).toContain('\\pos(960,20)}顶部第一条')
    expect(ass).toContain('\\pos(960,65)}顶部第二条')
    expect(ass).toContain('\\pos(960,1060)}底部第一条')
    expect(ass).toContain('\\pos(960,1015)}底部第二条')
  })

  it('computes off-screen travel bounds proportional to text width and defaults NaN color to white', () => {
    const longText =
      '这是一条非常非常长的滚动弹幕用于验证左侧不会在屏幕内提前消失'
    const ass = commentsToAss([{ cid: 1, p: '59.996,1,NaN', m: longText }])
    expect(ass).toContain('Dialogue: 0,0:01:00.00,0:01:08.00,Scroll')
    // Long text (> 1000px) must travel well past -500, not stop at -200
    const moveMatch = ass.match(/\\move\((\d+),(\d+),(-?\d+),(\d+)\)/)
    expect(moveMatch).not.toBeNull()
    expect(Number(moveMatch?.[3])).toBeLessThan(-400)
    expect(ass).not.toContain('&H000000&')
  })
})

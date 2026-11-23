import { describe, expect, it } from 'vitest'
import { isMostlyBlack } from './resumeThumbs'

const frame = (pixels: [number, number, number][]) =>
  new Uint8ClampedArray(pixels.flatMap(([r, g, b]) => [r, g, b, 255]))

describe('isMostlyBlack', () => {
  it('treats an all-black frame as black', () => {
    expect(isMostlyBlack(frame(Array(100).fill([0, 0, 0])))).toBe(true)
  })

  it('treats near-black noise (fade, letterbox) as black', () => {
    expect(isMostlyBlack(frame(Array(100).fill([12, 14, 10])))).toBe(true)
  })

  it('keeps a dark scene that still has lit detail', () => {
    const pixels: [number, number, number][] = Array(100).fill([5, 5, 5])
    for (let i = 0; i < 10; i += 1) pixels[i] = [200, 180, 160]
    expect(isMostlyBlack(frame(pixels))).toBe(false)
  })

  it('keeps an ordinary picture', () => {
    expect(isMostlyBlack(frame(Array(100).fill([120, 90, 200])))).toBe(false)
  })

  it('treats an empty buffer as black', () => {
    expect(isMostlyBlack(new Uint8ClampedArray())).toBe(true)
  })
})

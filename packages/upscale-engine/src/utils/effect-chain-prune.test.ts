import { describe, expect, it } from 'vitest'
import type { EnhancementEffect } from '../types'
import {
  chainUpscaleFactor,
  pruneRedundantUpscalers,
} from './effect-chain-prune'

const effect = (
  className: string,
  upscaleFactor?: number
): EnhancementEffect => ({
  id: `anime4k/${className}`,
  name: className,
  className,
  ...(upscaleFactor ? { upscaleFactor } : {}),
})

const CHAIN_A_BALANCED = [
  effect('ClampHighlights'),
  effect('CNNVL'),
  effect('CNNx2VL', 2),
  effect('CNNx2M', 2),
]
const CHAIN_C_BALANCED = [
  effect('ClampHighlights'),
  effect('DenoiseCNNx2VL', 2),
  effect('CNNx2M', 2),
]
const CHAIN_AA_ULTRA = [
  effect('ClampHighlights'),
  effect('CNNUL'),
  effect('CNNx2UL', 2),
  effect('CNNUL'),
  effect('CNNx2UL', 2),
  effect('CNNUL'),
  effect('CNNx2VL', 2),
]

const classes = (effects: EnhancementEffect[]) =>
  effects.map((e) => e.className)

describe('pruneRedundantUpscalers', () => {
  it('keeps one 2x step for a 1.33x target instead of running both', () => {
    // The regression this guards: a 1080p file on a 2560x1440 display used to
    // run CNNx2VL, drop to 1280x720, then upscale again with CNNx2M.
    const out = pruneRedundantUpscalers(
      CHAIN_A_BALANCED,
      { width: 1920, height: 1080 },
      { width: 2560, height: 1440 }
    )
    expect(classes(out)).toEqual(['ClampHighlights', 'CNNVL', 'CNNx2VL'])
  })

  it('drops every upscaler when the target is not larger than the source', () => {
    const out = pruneRedundantUpscalers(
      CHAIN_A_BALANCED,
      { width: 1920, height: 1080 },
      { width: 1920, height: 1080 }
    )
    expect(classes(out)).toEqual(['ClampHighlights', 'CNNVL'])
  })

  it('keeps both 2x steps for an exact 4x target', () => {
    const out = pruneRedundantUpscalers(
      CHAIN_A_BALANCED,
      { width: 640, height: 360 },
      { width: 2560, height: 1440 }
    )
    expect(classes(out)).toEqual([
      'ClampHighlights',
      'CNNVL',
      'CNNx2VL',
      'CNNx2M',
    ])
  })

  it('trims a doubled chain from 8 passes to the 3 the target needs', () => {
    const out = pruneRedundantUpscalers(
      CHAIN_AA_ULTRA,
      { width: 1920, height: 1080 },
      { width: 2560, height: 1440 }
    )
    expect(classes(out)).toEqual(['ClampHighlights', 'CNNUL', 'CNNx2UL'])
  })

  it('cuts from the tail, so the first unit keeps its restore pass', () => {
    const out = pruneRedundantUpscalers(
      CHAIN_C_BALANCED,
      { width: 1920, height: 1080 },
      { width: 3840, height: 2160 }
    )
    expect(classes(out)).toEqual(['ClampHighlights', 'DenoiseCNNx2VL'])
  })

  it('leaves a chain with no upscalers untouched', () => {
    const chain = [effect('ClampHighlights'), effect('CNNVL')]
    const out = pruneRedundantUpscalers(
      chain,
      { width: 1920, height: 1080 },
      { width: 3840, height: 2160 }
    )
    expect(out).toBe(chain)
  })

  it('returns an empty chain rather than a headless upscaler', () => {
    const out = pruneRedundantUpscalers(
      [effect('CNNx2M', 2)],
      { width: 1920, height: 1080 },
      { width: 1920, height: 1080 }
    )
    expect(out).toEqual([])
  })

  it('ignores a degenerate source size instead of dividing by zero', () => {
    const chain = CHAIN_A_BALANCED
    expect(
      pruneRedundantUpscalers(
        chain,
        { width: 0, height: 0 },
        { width: 1920, height: 1080 }
      )
    ).toBe(chain)
  })

  it('never exceeds what the chain already offered', () => {
    // A 16x target cannot be reached by a 4x chain; pruning must not invent
    // passes, it can only keep the ones that exist.
    const out = pruneRedundantUpscalers(
      CHAIN_A_BALANCED,
      { width: 320, height: 180 },
      { width: 5120, height: 2880 }
    )
    expect(classes(out)).toEqual(classes(CHAIN_A_BALANCED))
    expect(chainUpscaleFactor(out)).toBe(4)
  })
})

describe('chainUpscaleFactor', () => {
  it('multiplies the factors of the remaining upscalers', () => {
    expect(chainUpscaleFactor(CHAIN_A_BALANCED)).toBe(4)
    expect(chainUpscaleFactor(CHAIN_C_BALANCED)).toBe(4)
    expect(chainUpscaleFactor(CHAIN_AA_ULTRA)).toBe(8)
    expect(chainUpscaleFactor([effect('ClampHighlights')])).toBe(1)
  })
})

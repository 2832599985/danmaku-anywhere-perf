import { describe, expect, it } from 'vitest'
import {
  getEffectChainSummary,
  resolveEffectChain,
} from './effect-chain-templates'

describe('effect chain templates', () => {
  it('resolves a balanced Mode A chain with the expected scale stages', () => {
    const effects = resolveEffectChain('A', 'balanced')
    expect(effects.length).toBeGreaterThan(1)
    expect(effects.at(-1)?.upscaleFactor).toBe(2)
    expect(getEffectChainSummary(effects)).toContain('→')
  })

  it('falls back cleanly when a template references an unavailable effect', () => {
    const effects = resolveEffectChain('B', 'ultra')
    expect(effects.every((effect) => effect.className.length > 0)).toBe(true)
  })
})

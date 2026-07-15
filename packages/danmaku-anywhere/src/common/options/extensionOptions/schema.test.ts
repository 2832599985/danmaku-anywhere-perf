import { describe, expect, it } from 'vitest'
import { defaultExtensionOptions } from './constant'
import { extensionOptionsSchema } from './schema'

describe('extension options upscale schema', () => {
  it('accepts the default disabled Anime4K configuration', () => {
    const options = extensionOptionsSchema.parse(defaultExtensionOptions)
    expect(options.playerOptions.upscale).toEqual({
      enabled: false,
      modeId: 'builtin-mode-a',
      performanceTier: 'balanced',
      targetResolution: 'x2',
      enableCrossOriginFix: false,
    })
  })

  it('accepts every enhancement mode, tier, and resolution from Anime4K', () => {
    const modeIds = [
      'builtin-mode-a',
      'builtin-mode-b',
      'builtin-mode-c',
      'builtin-mode-aa',
      'builtin-mode-bb',
      'builtin-mode-ca',
    ] as const
    const performanceTiers = [
      'performance',
      'balanced',
      'quality',
      'ultra',
    ] as const
    const targetResolutions = [
      'x2',
      'x4',
      'x8',
      '720p',
      '1080p',
      '2k',
      '4k',
      'native',
    ] as const
    for (const modeId of modeIds) {
      for (const performanceTier of performanceTiers) {
        for (const targetResolution of targetResolutions) {
          const options = {
            ...defaultExtensionOptions,
            playerOptions: {
              ...defaultExtensionOptions.playerOptions,
              upscale: {
                enabled: true,
                modeId,
                performanceTier,
                targetResolution,
                enableCrossOriginFix: false,
              },
            },
          }
          expect(extensionOptionsSchema.safeParse(options).success).toBe(true)
        }
      }
    }
  })

  it('rejects unsupported target resolutions', () => {
    const options = {
      ...defaultExtensionOptions,
      playerOptions: {
        ...defaultExtensionOptions.playerOptions,
        upscale: {
          ...defaultExtensionOptions.playerOptions.upscale,
          targetResolution: 'x16',
        },
      },
    }
    expect(extensionOptionsSchema.safeParse(options).success).toBe(false)
  })
})

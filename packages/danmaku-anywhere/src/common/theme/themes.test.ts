import { describe, expect, it } from 'vitest'
import { ColorMode } from '@/common/theme/enums'
import {
  getThemePalette,
  resolveColorScheme,
  themeIds,
  themes,
} from '@/common/theme/themes'
import { getThemeCssVarsString } from '@/common/theme/themeVars'

describe('theme palette resolution', () => {
  it('resolves system mode from the current media preference', () => {
    expect(resolveColorScheme(ColorMode.System, true)).toBe('dark')
    expect(resolveColorScheme(ColorMode.System, false)).toBe('light')
    expect(resolveColorScheme(ColorMode.Light, true)).toBe('light')
    expect(resolveColorScheme(ColorMode.Dark, false)).toBe('dark')
  })

  it.each(
    themeIds
  )('provides distinct light glass tokens for %s', (themeId) => {
    const dark = getThemePalette(themeId, 'dark')
    const light = getThemePalette(themeId, 'light')

    expect(Object.keys(dark.glass)).toHaveLength(12)
    expect(Object.keys(light.glass)).toHaveLength(12)
    expect(light.glass).not.toEqual(dark.glass)
    expect(light.glass.base).toContain('255, 255, 255')
    expect(light.skipButton.text).not.toBe(dark.skipButton.text)
    expect(themes[themeId].glass).toBe(dark.glass)
  })

  it('emits the resolved light palette into player CSS variables', () => {
    const light = getThemePalette('ocean-depth', 'light')
    const css = getThemeCssVarsString(light)

    expect(css).toContain(`--da-glass-base: ${light.glass.base}`)
    expect(css).toContain(`--da-glass-tint: ${light.glass.tint}`)
    expect(css).toContain(`--da-skip-text: ${light.skipButton.text}`)
  })
})

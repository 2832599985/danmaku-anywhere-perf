import { beforeEach, describe, expect, it, vi } from 'vitest'

const { setExtensionAttr, loggerWarn } = vi.hoisted(() => ({
  setExtensionAttr: vi.fn(),
  loggerWarn: vi.fn(),
}))

vi.mock('@danmaku-anywhere/web-scraper', () => ({
  setExtensionAttr,
}))

vi.mock('@/common/constants', () => ({
  EXTENSION_VERSION: 'test-version',
}))

vi.mock('@/common/Logger', () => ({
  Logger: {
    warn: loggerWarn,
  },
}))

import { setupExtensionAttr } from './setupExtensionAttr'

describe('setupExtensionAttr', () => {
  beforeEach(() => {
    setExtensionAttr.mockReset()
    loggerWarn.mockReset()
  })

  it('does not throw when options are undefined', async () => {
    await expect(setupExtensionAttr(async () => undefined)).resolves.toBe(
      undefined
    )

    expect(setExtensionAttr).toHaveBeenCalledWith({
      version: 'test-version',
      id: undefined,
    })
  })

  it('does not throw when options are null', async () => {
    await expect(setupExtensionAttr(async () => null)).resolves.toBe(undefined)

    expect(setExtensionAttr).toHaveBeenCalledWith({
      version: 'test-version',
      id: undefined,
    })
  })

  it('does not throw when options getter fails', async () => {
    await expect(
      setupExtensionAttr(async () => {
        throw new Error('read failed')
      })
    ).resolves.toBe(undefined)

    expect(setExtensionAttr).toHaveBeenCalledWith({
      version: 'test-version',
      id: undefined,
    })
    expect(loggerWarn).toHaveBeenCalled()
  })
})

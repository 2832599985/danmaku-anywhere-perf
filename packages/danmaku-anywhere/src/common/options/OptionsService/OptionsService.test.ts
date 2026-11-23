import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ILogger } from '@/common/Logger'
import { OptionsService } from './OptionsService'

const readMock = vi.fn()
const setMock = vi.fn()
const setupMock = vi.fn()
const subscribeMock = vi.fn()
const unsubscribeMock = vi.fn()
const destroyMock = vi.fn()

vi.mock('@/common/storage/ExtStorageService', () => ({
  ExtStorageService: class {
    read = readMock
    set = setMock
    setup = setupMock
    subscribe = subscribeMock
    unsubscribe = unsubscribeMock
    destroy = destroyMock
  },
}))

const createLogger = () => {
  const logger = {
    warn: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    log: vi.fn(),
  } as unknown as ILogger
  logger.sub = vi.fn(() => logger)
  return logger
}

describe('OptionsService.readUnblocked', () => {
  beforeEach(() => {
    readMock.mockReset()
    setMock.mockReset()
    setupMock.mockReset()
    subscribeMock.mockReset()
    unsubscribeMock.mockReset()
    destroyMock.mockReset()
  })

  it('falls back to default options when stored payload has no data', async () => {
    readMock.mockResolvedValue({
      version: 23,
      data: undefined,
    })

    const defaults = { enabled: true }
    const logger = createLogger()

    const service = new OptionsService(
      {
        waitUntilReady: async () => undefined,
      } as any,
      'extensionOptions',
      defaults,
      logger
    )

    await expect(service.readUnblocked()).resolves.toEqual(defaults)
    expect(logger.warn).toHaveBeenCalled()
  })

  it('returns stored data when payload is valid', async () => {
    readMock.mockResolvedValue({
      version: 23,
      data: { enabled: false },
    })

    const defaults = { enabled: true }
    const logger = createLogger()

    const service = new OptionsService(
      {
        waitUntilReady: async () => undefined,
      } as any,
      'extensionOptions',
      defaults,
      logger
    )

    await expect(service.readUnblocked()).resolves.toEqual({ enabled: false })
    expect(logger.warn).not.toHaveBeenCalled()
  })
})

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ScriptingManager } from './ScriptingManager'

vi.mock('@/content/controller?script', () => ({
  default: 'controller-script.js',
}))

const createLogger = () => {
  const logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    sub: () => logger,
  }
  return logger
}

const createScriptingMock = () => ({
  getRegisteredContentScripts: vi.fn().mockResolvedValue([]),
  registerContentScripts: vi.fn().mockResolvedValue(undefined),
  updateContentScripts: vi.fn().mockResolvedValue(undefined),
  unregisterContentScripts: vi.fn().mockResolvedValue(undefined),
})

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('ScriptingManager', () => {
  let scripting: ReturnType<typeof createScriptingMock>

  beforeEach(() => {
    scripting = createScriptingMock()
    // biome-ignore lint/suspicious/noExplicitAny: partial chrome mock
    ;(globalThis.chrome as any).scripting = scripting
    // biome-ignore lint/suspicious/noExplicitAny: partial chrome mock
    ;(globalThis.chrome as any).runtime.onStartup = {
      addListener: vi.fn(),
    }
  })

  const setupManager = (configs: unknown[]) => {
    const mountConfigService = {
      getAll: vi.fn().mockResolvedValue(configs),
      options: { onChange: vi.fn() },
    }

    const manager = new ScriptingManager(
      // biome-ignore lint/suspicious/noExplicitAny: partial service mock
      mountConfigService as any,
      // biome-ignore lint/suspicious/noExplicitAny: partial logger mock
      createLogger() as any
    )

    manager.setup()

    return mountConfigService
  }

  /**
   * Registration used to happen only as a side effect of the storage write in
   * `options.upgrade()`. Once that write became conditional, a reloaded
   * extension registered nothing: no controller script, so no floating button
   * and no video detection anywhere.
   */
  it('registers the content script on setup without any storage change event', async () => {
    const mountConfigService = setupManager([
      { enabled: true, patterns: ['https://example.com/*'] },
    ])

    await flush()

    // the change listener must not be what drives the initial registration
    expect(mountConfigService.options.onChange).toHaveBeenCalled()
    expect(scripting.registerContentScripts).toHaveBeenCalledTimes(1)
    expect(scripting.registerContentScripts).toHaveBeenCalledWith([
      expect.objectContaining({ matches: ['https://example.com/*'] }),
    ])
  })

  it('only registers patterns from enabled configs', async () => {
    setupManager([
      { enabled: true, patterns: ['https://enabled.com/*'] },
      { enabled: false, patterns: ['https://disabled.com/*'] },
    ])

    await flush()

    expect(scripting.registerContentScripts).toHaveBeenCalledWith([
      expect.objectContaining({ matches: ['https://enabled.com/*'] }),
    ])
  })

  it('updates instead of re-registering when a script is already registered', async () => {
    scripting.getRegisteredContentScripts.mockResolvedValue([
      { id: 'main-content' },
    ])

    setupManager([{ enabled: true, patterns: ['https://example.com/*'] }])

    await flush()

    expect(scripting.registerContentScripts).not.toHaveBeenCalled()
    expect(scripting.updateContentScripts).toHaveBeenCalledWith([
      { id: 'main-content', matches: ['https://example.com/*'] },
    ])
  })

  it('does not throw when reading the stored configs fails', async () => {
    const mountConfigService = {
      getAll: vi.fn().mockRejectedValue(new Error('storage unavailable')),
      options: { onChange: vi.fn() },
    }

    const manager = new ScriptingManager(
      // biome-ignore lint/suspicious/noExplicitAny: partial service mock
      mountConfigService as any,
      // biome-ignore lint/suspicious/noExplicitAny: partial logger mock
      createLogger() as any
    )

    expect(() => manager.setup()).not.toThrow()
    await flush()

    expect(scripting.registerContentScripts).not.toHaveBeenCalled()
  })
})

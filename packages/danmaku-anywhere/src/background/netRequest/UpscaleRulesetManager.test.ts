import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { UpscaleRulesetManager } from './UpscaleRulesetManager'

const RESERVED_BASE = 1_000_000

const createLogger = () => {
  const logger: any = {
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }
  logger.sub = vi.fn().mockReturnValue(logger)
  return logger
}

describe('UpscaleRulesetManager', () => {
  let rules: any[] = []
  let openTabs: { id?: number }[] = []
  let tabRemovedListeners: ((tabId: number) => void)[] = []

  const createManager = () => new UpscaleRulesetManager(createLogger())

  beforeEach(() => {
    rules = []
    openTabs = []
    tabRemovedListeners = []

    const declarativeNetRequest = {
      getSessionRules: vi.fn().mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, Math.random() * 10))
        return [...rules]
      }),
      updateSessionRules: vi.fn().mockImplementation(async (options) => {
        await new Promise((resolve) => setTimeout(resolve, Math.random() * 10))
        if (options.removeRuleIds) {
          rules = rules.filter((r) => !options.removeRuleIds.includes(r.id))
        }
        if (options.addRules) {
          rules.push(...options.addRules)
        }
      }),
    }

    vi.stubGlobal('chrome', {
      declarativeNetRequest,
      tabs: {
        query: vi.fn().mockImplementation(async () => [...openTabs]),
        onRemoved: {
          addListener: vi.fn().mockImplementation((cb) => {
            tabRemovedListeners.push(cb)
          }),
        },
      },
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('creates a tab-scoped media rule', async () => {
    const manager = createManager()
    await manager.applyForTab(42, 'https://cdn.example.com/video.mp4')

    expect(rules).toHaveLength(1)
    expect(rules[0].id).toBe(RESERVED_BASE + 42)
    expect(rules[0].condition).toEqual({
      resourceTypes: ['media'],
      tabIds: [42],
    })
    expect(rules[0].action.type).toBe('modifyHeaders')
    expect(rules[0].action.responseHeaders).toEqual([
      {
        header: 'Access-Control-Allow-Origin',
        operation: 'set',
        value: '*',
      },
      {
        header: 'Access-Control-Allow-Methods',
        operation: 'set',
        value: 'GET, HEAD, OPTIONS',
      },
    ])
  })

  it('is idempotent for the same tab and host', async () => {
    const manager = createManager()
    await manager.applyForTab(1, 'https://cdn.example.com/a.mp4')
    await manager.applyForTab(1, 'https://cdn.example.com/b.mp4')

    expect(rules).toHaveLength(1)
    expect(
      chrome.declarativeNetRequest.updateSessionRules
    ).toHaveBeenCalledTimes(1)
  })

  it('keeps a single rule when the same tab switches host', async () => {
    const manager = createManager()
    await manager.applyForTab(1, 'https://cdn-a.example.com/a.mp4')
    await manager.applyForTab(1, 'https://cdn-b.example.com/b.mp4')

    expect(rules).toHaveLength(1)
    expect(rules[0].id).toBe(RESERVED_BASE + 1)
    expect(
      chrome.declarativeNetRequest.updateSessionRules
    ).toHaveBeenCalledTimes(1)
  })

  it('keeps rules of different tabs independent', async () => {
    const manager = createManager()
    await Promise.all([
      manager.applyForTab(1, 'https://cdn.example.com/a.mp4'),
      manager.applyForTab(2, 'https://cdn.example.com/b.mp4'),
    ])

    expect(rules).toHaveLength(2)
    const ids = rules.map((r) => r.id).toSorted((a: number, b: number) => a - b)
    expect(ids).toEqual([RESERVED_BASE + 1, RESERVED_BASE + 2])
  })

  it('removes the rule for a tab', async () => {
    const manager = createManager()
    await manager.applyForTab(1, 'https://cdn.example.com/a.mp4')
    await manager.removeForTab(1)

    expect(rules).toHaveLength(0)
  })

  it('does not throw when removing an unknown tab', async () => {
    const manager = createManager()
    await expect(manager.removeForTab(999)).resolves.toBeUndefined()
  })

  it('re-applies after removal for the same tab and host', async () => {
    const manager = createManager()
    await manager.applyForTab(1, 'https://cdn.example.com/a.mp4')
    await manager.removeForTab(1)
    await manager.applyForTab(1, 'https://cdn.example.com/a.mp4')

    expect(rules).toHaveLength(1)
  })

  it('ignores invalid and non-http video urls', async () => {
    const manager = createManager()
    await manager.applyForTab(1, 'not a url')
    await manager.applyForTab(1, 'blob:https://example.com/xyz')

    expect(rules).toHaveLength(0)
  })

  it('cleans up when the tab is closed', async () => {
    const manager = createManager()
    manager.setup()
    await manager.applyForTab(7, 'https://cdn.example.com/a.mp4')
    expect(rules).toHaveLength(1)

    tabRemovedListeners.forEach((cb) => cb(7))
    await vi.waitFor(() => expect(rules).toHaveLength(0))
  })

  it('sweeps rules for closed tabs on setup', async () => {
    rules.push(
      { id: 3, condition: {} }, // foreign rule, must survive
      { id: RESERVED_BASE + 5, condition: {} },
      { id: RESERVED_BASE + 9, condition: {} }
    )
    const manager = createManager()
    manager.setup()

    await vi.waitFor(() => expect(rules).toHaveLength(1))
    expect(rules[0].id).toBe(3)
  })

  it('keeps and re-tracks rules for tabs that are still open', async () => {
    openTabs = [{ id: 5 }]
    rules.push(
      { id: RESERVED_BASE + 5, condition: {} },
      { id: RESERVED_BASE + 9, condition: {} }
    )
    const manager = createManager()
    manager.setup()

    await vi.waitFor(() => expect(rules).toHaveLength(1))
    expect(rules[0].id).toBe(RESERVED_BASE + 5)

    // The surviving rule is tracked again, so re-applying is a no-op
    // instead of a redundant remove+add churn.
    vi.mocked(chrome.declarativeNetRequest.updateSessionRules).mockClear()
    await manager.applyForTab(5, 'https://cdn.example.com/a.mp4')
    expect(
      chrome.declarativeNetRequest.updateSessionRules
    ).not.toHaveBeenCalled()
  })
})

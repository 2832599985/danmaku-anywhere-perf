import { Mutex } from 'async-mutex'
import { inject, injectable } from 'inversify'
import { type ILogger, LoggerSymbol } from '@/common/Logger'

// Session rule ids are RESERVED_BASE + tabId so they are stable per tab and
// never collide with setSessionHeader.ts, which allocates maxId + 1 from the
// live rule list and would only reach this range after ~a million rules.
const RESERVED_BASE = 1_000_000

type TabRule = {
  ruleId: number
  host: string
}

/**
 * Manages per-tab DNR session rules that relax CORS on media responses so a
 * cross-origin <video> can be reloaded with crossOrigin='anonymous' and used
 * as a WebGPU texture source.
 *
 * Rules are created on demand via RPC from the player script (gated by the
 * user's enableCrossOriginFix option) and are scoped to a single tab and the
 * video's host — unlike the previous static ruleset, they never affect other
 * tabs or sites.
 */
@injectable('Singleton')
export class UpscaleRulesetManager {
  private readonly logger: ILogger
  private readonly mutex = new Mutex()
  private readonly tabRules = new Map<number, TabRule>()

  constructor(@inject(LoggerSymbol) logger: ILogger) {
    this.logger = logger.sub('[UpscaleRulesetManager]')
  }

  setup() {
    chrome.tabs.onRemoved.addListener((tabId) => {
      void this.removeForTab(tabId).catch((e) =>
        this.logger.warn('Failed to remove CORS rule on tab close', e)
      )
    })
    // Session rules persist across service worker restarts while the
    // in-memory map does not — sweep our reserved id range on startup so
    // stale rules from a previous worker don't linger untracked.
    void this.sweepStaleRules().catch((e) =>
      this.logger.warn('Failed to sweep stale CORS rules', e)
    )
  }

  async applyForTab(tabId: number, videoUrl: string) {
    let host: string
    try {
      const url = new URL(videoUrl)
      if (!url.protocol.startsWith('http')) return
      host = url.hostname
    } catch {
      this.logger.warn('Ignoring invalid video url for CORS rule', videoUrl)
      return
    }
    await this.mutex.runExclusive(async () => {
      const existing = this.tabRules.get(tabId)
      if (existing?.host === host) return
      const ruleId = RESERVED_BASE + tabId
      await chrome.declarativeNetRequest.updateSessionRules({
        removeRuleIds: [ruleId],
        addRules: [
          {
            id: ruleId,
            action: {
              type: 'modifyHeaders',
              responseHeaders: [
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
              ],
            },
            condition: {
              requestDomains: [host],
              resourceTypes: ['media'],
              tabIds: [tabId],
            },
          },
        ],
      })
      this.tabRules.set(tabId, { ruleId, host })
      this.logger.debug('Applied CORS session rule', { tabId, host })
    })
  }

  async removeForTab(tabId: number) {
    await this.mutex.runExclusive(async () => {
      const ruleId = RESERVED_BASE + tabId
      this.tabRules.delete(tabId)
      await chrome.declarativeNetRequest.updateSessionRules({
        removeRuleIds: [ruleId],
      })
    })
  }

  private async sweepStaleRules() {
    await this.mutex.runExclusive(async () => {
      const rules = await chrome.declarativeNetRequest.getSessionRules()
      const staleIds = rules
        .map((rule) => rule.id)
        .filter((id) => id >= RESERVED_BASE)
      if (staleIds.length === 0) return
      await chrome.declarativeNetRequest.updateSessionRules({
        removeRuleIds: staleIds,
      })
      this.logger.debug('Swept stale CORS session rules', staleIds)
    })
  }
}

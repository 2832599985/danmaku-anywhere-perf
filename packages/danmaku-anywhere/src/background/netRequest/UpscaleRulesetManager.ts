import { Mutex } from 'async-mutex'
import { inject, injectable } from 'inversify'
import { type ILogger, LoggerSymbol } from '@/common/Logger'

// Session rule ids are RESERVED_BASE + tabId so they are stable per tab and
// never collide with setSessionHeader.ts, which allocates maxId + 1 from the
// live rule list and would only reach this range after ~a million rules.
const RESERVED_BASE = 1_000_000

/**
 * Manages per-tab DNR session rules that relax CORS on media responses so a
 * cross-origin <video> can be reloaded with crossOrigin='anonymous' and used
 * as a WebGPU texture source.
 *
 * Rules are created on demand via RPC from the player script (gated by the
 * user's enableCrossOriginFix option) and are scoped to a single tab —
 * unlike the previous static ruleset, they never affect other tabs.
 */
@injectable('Singleton')
export class UpscaleRulesetManager {
  private readonly logger: ILogger
  private readonly mutex = new Mutex()
  private readonly ruleTabIds = new Set<number>()

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
    // in-memory set does not — re-track rules whose tab is still open and
    // drop only the ones whose tab is gone. Removing rules for live tabs
    // would break playback mid-stream: their videos keep
    // crossOrigin='anonymous' and rely on the rule for every later
    // seek/segment request.
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
      if (this.ruleTabIds.has(tabId)) return
      const ruleId = RESERVED_BASE + tabId
      await chrome.declarativeNetRequest.updateSessionRules({
        removeRuleIds: [ruleId],
        addRules: [
          {
            id: ruleId,
            action: {
              type: 'modifyHeaders',
              // A CORS-mode reload adds an Origin header that the original
              // no-cors media request never carried — some CDNs' hotlink
              // protection rejects exactly that with a 403 (seen on signed
              // download URLs). Stripping it restores request parity with
              // normal playback; the browser-side CORS check is satisfied
              // by the injected ACAO:* below, which doesn't require the
              // server to have seen an Origin.
              requestHeaders: [{ header: 'Origin', operation: 'remove' }],
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
            // The video host alone can't be matched here: players commonly
            // point <video> at a same-page redirector (e.g. dp.php?url=...)
            // that 302s to a rotating CDN host, and a CORS request needs the
            // header on every hop. Tab + media-only scoping keeps the
            // relaxation narrow without predicting the final host.
            condition: {
              resourceTypes: ['media'],
              tabIds: [tabId],
            },
          },
        ],
      })
      this.ruleTabIds.add(tabId)
      this.logger.debug('Applied CORS session rule', { tabId, host })
    })
  }

  async removeForTab(tabId: number) {
    await this.mutex.runExclusive(async () => {
      const ruleId = RESERVED_BASE + tabId
      this.ruleTabIds.delete(tabId)
      await chrome.declarativeNetRequest.updateSessionRules({
        removeRuleIds: [ruleId],
      })
    })
  }

  private async sweepStaleRules() {
    await this.mutex.runExclusive(async () => {
      const [rules, tabs] = await Promise.all([
        chrome.declarativeNetRequest.getSessionRules(),
        chrome.tabs.query({}),
      ])
      const liveTabIds = new Set(
        tabs.map((tab) => tab.id).filter((id) => id !== undefined)
      )
      const staleIds: number[] = []
      for (const rule of rules) {
        if (rule.id < RESERVED_BASE) continue
        const tabId = rule.id - RESERVED_BASE
        if (liveTabIds.has(tabId)) {
          this.ruleTabIds.add(tabId)
        } else {
          staleIds.push(rule.id)
        }
      }
      if (staleIds.length === 0) return
      await chrome.declarativeNetRequest.updateSessionRules({
        removeRuleIds: staleIds,
      })
      this.logger.debug('Swept stale CORS session rules', staleIds)
    })
  }
}

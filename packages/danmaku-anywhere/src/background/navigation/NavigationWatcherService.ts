import { inject, injectable } from 'inversify'
import { type ILogger, LoggerSymbol } from '@/common/Logger'

const urlBlacklist = ['about:blank', 'google.com']

@injectable('Singleton')
export class NavigationWatcherService {
  private logger: ILogger

  constructor(@inject(LoggerSymbol) logger: ILogger) {
    this.logger = logger.sub('[NavigationWatcherService]')
  }

  setup() {
    // Listen for sub-frame navigations completing (new iframe loads or iframe reloads)
    chrome.webNavigation.onCommitted.addListener((details) => {
      // Only care about sub-frames, not the main frame (frameId 0)
      // Main frame is handled by content script injection via ScriptingManager
      if (details.frameId === 0) return

      if (urlBlacklist.some((url) => details.url.includes(url))) return

      this.notifyController(details.tabId, details.frameId, details.url)
    })

    // Listen for history state updates (SPA navigations in frames)
    chrome.webNavigation.onHistoryStateUpdated.addListener((details) => {
      if (details.frameId === 0) return

      if (urlBlacklist.some((url) => details.url.includes(url))) return

      this.notifyController(details.tabId, details.frameId, details.url)
    })
  }

  private notifyController(tabId: number, frameId: number, url: string) {
    this.logger.debug('Frame navigated, notifying controller', {
      tabId,
      frameId,
      url,
    })

    // Send to the main frame (frameId: 0) where the controller script lives
    chrome.tabs
      .sendMessage(
        tabId,
        {
          method: 'frameNavigated',
          input: { frameId, url },
        },
        { frameId: 0 }
      )
      .catch(() => {
        // Silently ignore — controller may not be injected in this tab
      })
  }
}

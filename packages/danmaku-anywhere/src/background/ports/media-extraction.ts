import { extractMedia } from '@danmaku-anywhere/web-scraper'
import { portNames } from '@/common/ports/portNames'

export const setupExtractMedia = () => {
  // cleanup keyed by tab id
  const portCleanupCallbacks = new Map<number, () => void>()

  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== portNames.extractMedia) return

    let isCompleted = false

    port.onMessage.addListener(async (message) => {
      if (message.action === 'extractMedia' && port.sender?.tab?.id) {
        const tabId = port.sender.tab.id
        const { url } = message.data

        try {
          const cleanup = await extractMedia(url, {
            onMediaFound: (mediaInfo) => {
              if (isCompleted) return
              try {
                port.postMessage({
                  action: 'extractMedia',
                  success: true,
                  data: mediaInfo,
                  isLast: false,
                })
              } catch {
                // Port disconnected, clean up
                isCompleted = true
                cleanup()
              }
            },
            onError: (error) => {
              if (isCompleted) return
              isCompleted = true
              try {
                port.postMessage({
                  action: 'extractMedia',
                  success: false,
                  err: error.message,
                  isLast: true,
                })
              } catch {
                // Port already disconnected
              }
            },
            onComplete: () => {
              isCompleted = true
              port.disconnect()
            },
          })

          // abort after 30 seconds
          const timeoutId = setTimeout(() => {
            cleanup()
          }, 30000)

          portCleanupCallbacks.set(tabId, () => {
            clearTimeout(timeoutId)
            cleanup()
          })
        } catch (err) {
          isCompleted = true
          try {
            port.postMessage({
              action: 'extractMedia',
              success: false,
              err: err instanceof Error ? err.message : 'Unknown error',
              isLast: true,
            })
          } catch {
            // Port already disconnected
          }
          port.disconnect()
        }
      }
    })

    port.onDisconnect.addListener((port) => {
      isCompleted = true
      if (port.sender?.tab?.id) {
        const tabId = port.sender.tab.id
        const cleanup = portCleanupCallbacks.get(tabId)
        if (cleanup) {
          cleanup()
          portCleanupCallbacks.delete(tabId)
        }
      }
    })
  })
}

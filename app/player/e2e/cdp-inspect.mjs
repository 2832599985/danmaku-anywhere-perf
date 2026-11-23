// Diagnostic: attach to a running WebView2 (danmaku-player.exe launched with
// WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222) and dump
// console output, page errors, failed requests and DOM state.
import { chromium } from '@playwright/test'

const ENDPOINT = 'http://127.0.0.1:9222'

const cdp = await chromium.connectOverCDP(ENDPOINT)
const pages = cdp.contexts().flatMap((c) => c.pages())
if (!pages.length) {
  console.log('NO PAGES FOUND')
  process.exit(1)
}
const page = pages[0]
console.log('URL:', page.url())

page.on('console', (m) => console.log(`[console:${m.type()}]`, m.text()))
page.on('pageerror', (e) => console.log('[pageerror]', e.message))
page.on('requestfailed', (r) =>
  console.log('[requestfailed]', r.url(), r.failure()?.errorText)
)
page.on('response', (r) => {
  if (r.status() >= 400) console.log('[http-error]', r.status(), r.url())
})

const snapshot = () =>
  page
    .evaluate(() => ({
      readyState: document.readyState,
      rootChildren: document.getElementById('root')?.childElementCount ?? -1,
      bodySnippet: document.body.innerHTML.slice(0, 400),
      hasTauriInternals: '__TAURI_INTERNALS__' in window,
      hasTauriGlobal: '__TAURI__' in window,
      hasPlayerHook: '__player' in window,
    }))
    .catch((e) => ({ evalError: e.message }))

console.log('state (pre-reload):', JSON.stringify(await snapshot(), null, 2))

// Reload to capture console/errors from the very start of bootstrap.
await page.reload({ waitUntil: 'load' }).catch((e) => {
  console.log('[reload-error]', e.message)
})
await page.waitForTimeout(5000)

console.log('state (post-reload):', JSON.stringify(await snapshot(), null, 2))
await cdp.close()

import type { PickedMedia, PickedText, Platform } from './types'

const basename = (p: string): string => {
  const parts = p.split(/[\\/]/)
  return parts[parts.length - 1] || p
}

/**
 * Build the URL the webview uses to stream a local file through our custom Rust
 * protocol. On Windows, Tauri exposes custom URI schemes at
 * `http://<scheme>.localhost/…`; the Rust handler reads `uri.path()` so the
 * host prefix is irrelevant. The path is percent-encoded and decoded back on
 * the Rust side. The <video> element sets crossOrigin="anonymous" and the
 * handler replies with `Access-Control-Allow-Origin: *`, keeping frames
 * CORS-clean for WebGPU.
 */
const streamUrlForPath = (path: string): string =>
  `http://stream.localhost/${encodeURIComponent(path)}`

/**
 * Tauri adapter. Plugin modules are imported lazily so the browser bundle never
 * evaluates them.
 */
export const tauriPlatform: Platform = {
  isTauri: true,

  async init() {
    // Route DanDanPlay/proxy requests through the http plugin to bypass CORS.
    // Only those hosts — a blanket window.fetch swap breaks Tauri's own IPC
    // custom-protocol probe and same-origin asset fetches (framegen weights),
    // because plugin-http rejects URLs outside the capability scope.
    try {
      const { fetch: tauriFetch } = await import('@tauri-apps/plugin-http')
      const nativeFetch = window.fetch.bind(window)
      const urlOf = (input: RequestInfo | URL): string => {
        if (typeof input === 'string') return input
        if (input instanceof URL) return input.href
        return input.url
      }
      const needsCorsBypass = (input: RequestInfo | URL): boolean => {
        try {
          const { host } = new URL(urlOf(input), window.location.href)
          return (
            host === 'api.danmaku.weeblify.app' ||
            host.endsWith('.dandanplay.net')
          )
        } catch {
          return false
        }
      }
      const bridged = (input: RequestInfo | URL, init?: RequestInit) => {
        if (needsCorsBypass(input)) {
          return (tauriFetch as unknown as typeof window.fetch)(input, init)
        }
        return nativeFetch(input, init)
      }
      window.fetch = bridged as typeof window.fetch
    } catch (error) {
      console.warn('[player] Failed to install Tauri fetch bridge', error)
    }
  },

  async pickVideoFiles(): Promise<PickedMedia[]> {
    const { open } = await import('@tauri-apps/plugin-dialog')
    const selected = await open({
      multiple: true,
      directory: false,
      filters: [
        {
          name: 'Video',
          extensions: [
            'mp4',
            'm4v',
            'webm',
            'mkv',
            'mov',
            'avi',
            'ts',
            'flv',
            'ogv',
          ],
        },
      ],
    })
    // Normalize return value: null → [], string → [string], string[] → string[]
    const paths = Array.isArray(selected)
      ? selected
      : typeof selected === 'string'
        ? [selected]
        : []
    return paths.map((path) => ({
      url: streamUrlForPath(path),
      name: basename(path),
      path,
    }))
  },

  async pickDanmakuFile(): Promise<PickedText | null> {
    const { open } = await import('@tauri-apps/plugin-dialog')
    const selected = await open({
      multiple: false,
      directory: false,
      filters: [{ name: 'Danmaku', extensions: ['xml', 'json', 'ass', 'txt'] }],
    })
    if (typeof selected !== 'string') return null
    const text = await this.readTextFile(selected)
    return { text, name: basename(selected) }
  },

  mediaUrlForPath(path: string): string {
    return streamUrlForPath(path)
  },

  async readTextFile(path: string): Promise<string> {
    const { readTextFile } = await import('@tauri-apps/plugin-fs')
    return readTextFile(path)
  },

  minimizeWindow(): void {
    void import('@tauri-apps/api/window').then(({ getCurrentWindow }) =>
      getCurrentWindow().minimize()
    )
  },

  toggleMaximizeWindow(): void {
    void import('@tauri-apps/api/window').then(({ getCurrentWindow }) =>
      getCurrentWindow().toggleMaximize()
    )
  },

  closeWindow(): void {
    void import('@tauri-apps/api/window').then(({ getCurrentWindow }) =>
      getCurrentWindow().close()
    )
  },

  onFileDrop(cb: (paths: string[]) => void): () => void {
    let unlisten: (() => void) | null = null
    let cancelled = false
    void import('@tauri-apps/api/webview').then(({ getCurrentWebview }) => {
      if (cancelled) return
      void getCurrentWebview()
        .onDragDropEvent((event) => {
          if (event.payload.type === 'drop') {
            cb(event.payload.paths)
          }
        })
        .then((fn) => {
          if (cancelled) fn()
          else unlisten = fn
        })
    })
    return () => {
      cancelled = true
      unlisten?.()
    }
  },
}

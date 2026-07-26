/**
 * Platform adapter contract (FROZEN — see CONTRACT.md §3).
 *
 * The exact same React tree runs in two environments:
 *  - Tauri webview (WebView2): native dialogs, fs, http, custom stream:// protocol
 *  - Plain browser (Vite dev, Playwright): <input type=file> + blob URLs + fetch
 *
 * Every environment-specific capability goes through this interface so nothing
 * else in the app needs to know which host it's running in.
 */

export interface PickedMedia {
  /** A URL the <video> element can load (blob: in browser, stream:// in Tauri). */
  url: string
  /** Display name (file basename). */
  name: string
  /** Absolute filesystem path when known (Tauri only). Enables "recent files". */
  path?: string
}

export interface PickedText {
  /** Full text contents of the picked file. */
  text: string
  /** Display name (file basename). */
  name: string
}

export interface Platform {
  /** True when running inside the Tauri webview. */
  readonly isTauri: boolean

  /** One-time async setup (e.g. swap window.fetch to the Tauri http plugin). */
  init(): Promise<void>

  /**
   * Open a native/browser file picker for multiple video files.
   * Returns an empty array when the user cancels. Each entry is playable via
   * its `url`; `path` is present only on Tauri.
   */
  pickVideoFiles(): Promise<PickedMedia[]>

  /** Open a native/browser file picker for a danmaku file (.xml/.json/.ass). */
  pickDanmakuFile(): Promise<PickedText | null>

  /** Convert an absolute fs path to a playable media URL (Tauri stream:// / convertFileSrc). */
  mediaUrlForPath(path: string): string

  /** Read a text file by absolute path (Tauri drag-drop). */
  readTextFile(path: string): Promise<string>

  /**
   * Subscribe to native OS drag-and-drop of files onto the window (Tauri).
   * Returns an unsubscribe fn. No-op (returns a noop) in the browser, where DnD
   * is handled with the standard DataTransfer API on the drop target instead.
   */
  onFileDrop(cb: (paths: string[]) => void): () => void

  /**
   * Window chrome controls for the undecorated Tauri window (the native title
   * bar is disabled; the top bar renders its own ─ □ ✕). No-ops in the browser,
   * where the buttons are not rendered at all.
   */
  minimizeWindow(): void
  toggleMaximizeWindow(): void
  closeWindow(): void
}

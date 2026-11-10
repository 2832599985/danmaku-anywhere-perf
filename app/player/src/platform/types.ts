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

/**
 * Video container extensions the player accepts, WITHOUT the leading dot.
 * Single source of truth: the two pickers, the drag-drop filter and the
 * sibling-episode scan all derive from it (they used to keep their own copies).
 */
export const VIDEO_EXTENSION_LIST: readonly string[] = [
  'mp4',
  'm4v',
  'webm',
  'mkv',
  'mov',
  'avi',
  'ts',
  'flv',
  'ogv',
]

export const VIDEO_EXTENSIONS: ReadonlySet<string> = new Set(
  VIDEO_EXTENSION_LIST
)

/**
 * Containers the WebView2 media stack cannot demux (measured: it opens MP4,
 * MOV, WebM and MKV, and fails FLV/TS/AVI with `FFmpegDemuxer: open context
 * failed`). Tauri remuxes these losslessly before handing the file to the
 * <video> element; see `src-tauri/src/remux.rs`, whose `NEEDS_REMUX` list is
 * the authority — this copy only decides whether to ask the backend at all.
 */
export const REMUX_EXTENSIONS: ReadonlySet<string> = new Set([
  'flv',
  'ts',
  'avi',
])

/**
 * Subtitle file extensions (no dot): the picker, the drop routing and the
 * sibling-file auto-load (in this order of preference) share this list.
 */
export const SUBTITLE_EXTENSION_LIST: readonly string[] = [
  'srt',
  'ass',
  'ssa',
  'vtt',
]

export const SUBTITLE_EXTENSIONS: ReadonlySet<string> = new Set(
  SUBTITLE_EXTENSION_LIST
)

/** Lower-case extension (no dot) of a file name, or '' when it has none. */
export const extOf = (name: string): string =>
  name.split('.').pop()?.toLowerCase() ?? ''

/**
 * Absolute path of `name` inside `dir` (directory listings report bare names).
 *
 * A named helper, and unit-tested, because the inline version shipped a bug
 * that turned the whole sibling-episode scan into a silent no-op: written as
 * `` `${dir}\${name}` `` the `\$` is an ESCAPE, not a separator plus an
 * interpolation, so every entry in the folder collapsed to the literal string
 * `${dir}${entry.name}` — no digits in it, so `selectBatch` recognised no
 * episode and returned an empty list. Type-checking and the sibling tests both
 * passed, because nothing covered this join.
 */
export const joinPath = (dir: string, name: string): string =>
  `${dir.replace(/[\\/]+$/, '')}\\${name}`

export interface PickedMedia {
  /** A URL the <video> element can load (blob: in browser, stream:// in Tauri). */
  url: string
  /** Display name (file basename). */
  name: string
  /** Absolute filesystem path when known (Tauri only). Enables "recent files". */
  path?: string
}

/** A URL the <video> element can load, plus whether it took a conversion. */
export interface PreparedMediaUrl {
  url: string
  /** True when this call actually remuxed the container (cache hits are false). */
  remuxed: boolean
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

  /** Open a native/browser file picker for a danmaku file (.xml/.json). */
  pickDanmakuFile(): Promise<PickedText | null>

  /** Open a native/browser file picker for a subtitle file (.srt/.ass/.ssa/.vtt). */
  pickSubtitleFile(): Promise<PickedText | null>

  /** Convert an absolute fs path to a playable media URL (Tauri stream:// / convertFileSrc). */
  mediaUrlForPath(path: string): string

  /**
   * Resolve a playlist item to a URL the <video> element can actually load.
   * Containers the host cannot demux (see REMUX_EXTENSIONS) are losslessly
   * remuxed into a cached MP4/MKV first; everything else — and everything in
   * the browser, which has no filesystem — maps straight to `mediaUrlForPath`.
   */
  prepareMediaUrl(item: {
    url: string
    path?: string
  }): Promise<PreparedMediaUrl>

  /**
   * Read a text file by absolute path (Tauri drag-drop, sibling files). The
   * encoding is detected (UTF-8/16, GBK, Big5, Shift_JIS), not assumed.
   */
  readTextFile(path: string): Promise<string>

  /**
   * Absolute paths of the VIDEO files directly inside `dir` (no recursion).
   * Powers the sibling-episode scan (add the rest of the batch to the playlist
   * when one episode is opened). Returns [] in the browser, where a page cannot
   * read a directory — the scan is a Tauri convenience, never a correctness
   * dependency.
   */
  listVideoFiles(dir: string): Promise<string[]>

  /**
   * Absolute paths of the SUBTITLE files directly inside `dir` (no recursion).
   * Finds the fansub-style tagged siblings (`<video>.sc.ass`, …) that a fixed
   * `<video>.srt` probe misses. Returns [] in the browser.
   */
  listSubtitleFiles(dir: string): Promise<string[]>

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

  /**
   * Mini player (小窗): shrink the window to `width` x `height` logical px,
   * pin it to the bottom-right of the monitor's work area and keep it above
   * other windows. The geometry before the call (size, position, maximized) is
   * remembered for `exitMiniWindow`. Returns false where a page cannot move
   * its own window (the browser), so the caller can skip the mode.
   */
  enterMiniWindow(width: number, height: number): Promise<boolean>
  /** Undo `enterMiniWindow`: restore size/position/maximized, drop top-most. */
  exitMiniWindow(): Promise<void>
  /**
   * Start a native window move from the current mouse press (call it from a
   * left-button mousedown). No-op in the browser.
   */
  startWindowDrag(): void

  /**
   * Open the source's login page in a real WebView2 window (Bilibili/Tencent).
   * The cookie jar is shared with the hidden source bridge. No-op in the
   * browser, where the sources are unavailable.
   */
  sourceLogin(provider: 'bilibili' | 'tencent'): Promise<void>
}

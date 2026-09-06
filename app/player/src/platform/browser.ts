import type { PickedMedia, PickedText, Platform } from './types'

const VIDEO_EXTENSIONS = 'video/*,.mp4,.m4v,.webm,.mkv,.mov,.avi,.ts,.flv,.ogv'
const DANMAKU_EXTENSIONS = '.xml,.json,.txt'
const SUBTITLE_EXTENSIONS = '.srt,.ass,.vtt'

const pickFile = (accept: string): Promise<File | null> =>
  new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = accept
    input.style.display = 'none'
    let settled = false
    const settle = (file: File | null) => {
      if (settled) return
      settled = true
      input.remove()
      resolve(file)
    }
    input.addEventListener('change', () => settle(input.files?.[0] ?? null))
    // Some browsers fire `cancel` when the dialog is dismissed.
    input.addEventListener('cancel', () => settle(null))
    document.body.appendChild(input)
    input.click()
  })

const pickFiles = (accept: string): Promise<File[]> =>
  new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = accept
    input.multiple = true
    input.style.display = 'none'
    let settled = false
    const settle = (files: File[]) => {
      if (settled) return
      settled = true
      input.remove()
      resolve(files)
    }
    input.addEventListener('change', () =>
      settle(Array.from(input.files ?? []))
    )
    // Some browsers fire `cancel` when the dialog is dismissed.
    input.addEventListener('cancel', () => settle([]))
    document.body.appendChild(input)
    input.click()
  })

/**
 * Browser adapter used for Vite dev + Playwright verification. Blob URLs are
 * same-origin and therefore CORS-clean, so WebGPU can read the video frames.
 */
export const browserPlatform: Platform = {
  isTauri: false,

  async init() {
    // no-op; native fetch is used as-is
  },

  async pickVideoFiles(): Promise<PickedMedia[]> {
    const files = await pickFiles(VIDEO_EXTENSIONS)
    return files.map((file) => ({
      url: URL.createObjectURL(file),
      name: file.name,
    }))
  },

  async pickDanmakuFile(): Promise<PickedText | null> {
    const file = await pickFile(DANMAKU_EXTENSIONS)
    if (!file) return null
    return { text: await file.text(), name: file.name }
  },

  async pickSubtitleFile(): Promise<PickedText | null> {
    const file = await pickFile(SUBTITLE_EXTENSIONS)
    if (!file) return null
    return { text: await file.text(), name: file.name }
  },

  mediaUrlForPath(path: string): string {
    // No filesystem paths in the browser; treat as an already-usable URL.
    return path
  },

  async readTextFile(): Promise<string> {
    throw new Error('readTextFile is not available in the browser')
  },

  onFileDrop(): () => void {
    // Browser drag-drop is handled with the DataTransfer API on the drop zone.
    return () => undefined
  },

  // The browser tab has its own chrome; the custom window buttons never render.
  minimizeWindow(): void {
    // no-op outside Tauri
  },
  toggleMaximizeWindow(): void {
    // no-op outside Tauri
  },
  closeWindow(): void {
    // no-op outside Tauri
  },
}

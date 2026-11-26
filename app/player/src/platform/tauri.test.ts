import { beforeEach, describe, expect, it, vi } from 'vitest'

const invokeMock = vi.fn()

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}))

import { jpegBlobFromIpcPayload, tauriPlatform } from './tauri'

describe('tauriPlatform resume thumbnails raw binary IPC', () => {
  beforeEach(() => {
    invokeMock.mockReset()
  })

  it('sends raw Uint8Array payload and URL-encoded x-key header in saveResumeThumb', async () => {
    invokeMock.mockResolvedValueOnce(undefined)
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9])
    const videoPath = 'D:\\番剧\\葬送的芙莉莲 - 01 [1080p].mkv'

    await tauriPlatform.saveResumeThumb(videoPath, jpeg)

    expect(invokeMock).toHaveBeenCalledTimes(1)
    const [cmd, body, options] = invokeMock.mock.calls[0]
    expect(cmd).toBe('thumb_save')
    expect(body).toBe(jpeg)
    expect(Array.isArray(body)).toBe(false)
    expect(options).toEqual({
      headers: {
        'x-key': encodeURIComponent(videoPath),
      },
    })
    expect(decodeURIComponent(options.headers['x-key'])).toBe(videoPath)
  })

  it('decodes ArrayBuffer binary IPC responses into JPEG Blobs and treats empty buffers as null', async () => {
    const rawBytes = new Uint8Array([0xff, 0xd8, 0x01, 0x02, 0xff, 0xd9])
    invokeMock.mockResolvedValueOnce(rawBytes.buffer.slice(0))

    const blob = await tauriPlatform.loadResumeThumb('D:\\video.mkv')
    expect(invokeMock).toHaveBeenCalledWith('thumb_load', {
      key: 'D:\\video.mkv',
    })
    expect(blob).not.toBeNull()
    expect(blob?.type).toBe('image/jpeg')
    const roundTripped = new Uint8Array(await (blob as Blob).arrayBuffer())
    expect(Array.from(roundTripped)).toEqual(Array.from(rawBytes))

    // Empty ArrayBuffer (missing thumbnail on disk) returns null
    invokeMock.mockResolvedValueOnce(new ArrayBuffer(0))
    expect(await tauriPlatform.loadResumeThumb('D:\\missing.mkv')).toBeNull()
  })

  it('handles ArrayBuffer, Uint8Array views, and empty/null payloads in jpegBlobFromIpcPayload', async () => {
    expect(jpegBlobFromIpcPayload(null)).toBeNull()
    expect(jpegBlobFromIpcPayload(undefined)).toBeNull()
    expect(jpegBlobFromIpcPayload(new Uint8Array(0))).toBeNull()

    const backing = new Uint8Array([99, 10, 20, 30, 99])
    const subarray = backing.subarray(1, 4)
    const blob = jpegBlobFromIpcPayload(subarray)
    expect(blob).not.toBeNull()
    expect(
      Array.from(new Uint8Array(await (blob as Blob).arrayBuffer()))
    ).toEqual([10, 20, 30])
  })
})

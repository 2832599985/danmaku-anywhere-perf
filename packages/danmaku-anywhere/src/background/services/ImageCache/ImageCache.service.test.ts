import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ImageCacheService } from './ImageCache.service'

const fetchMock = vi.fn<typeof fetch>()
vi.stubGlobal('fetch', fetchMock)

describe('ImageCacheService', () => {
  const service = new ImageCacheService()

  beforeEach(() => {
    fetchMock.mockReset()
  })

  it('fetches an image and converts it to a data URL', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      blob: async () => new Blob(['mock'], { type: 'image/png' }),
    } as Response)

    const result = await service.get('https://example.com/image.png')

    expect(fetchMock).toHaveBeenCalledWith('https://example.com/image.png')
    expect(result).toMatch(/^data:image\/png;base64,/)
  })

  it('returns null for non-success HTTP responses', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 404,
      blob: vi.fn(),
    } as unknown as Response)

    await expect(service.get('https://example.com/missing.png')).resolves.toBe(
      null
    )
  })

  it('returns null when the request fails', async () => {
    fetchMock.mockRejectedValue(new TypeError('Network error'))

    await expect(service.get('https://example.com/image.png')).resolves.toBe(
      null
    )
  })
})

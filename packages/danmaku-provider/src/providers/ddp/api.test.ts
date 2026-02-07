import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ResponseParseException } from '../../exceptions/ResponseParseException'
import { mockFetchResponse } from '../utils/testUtils'
import {
  commentGetComment,
  commentGetCommentManualWithRelated,
  getBangumiAnime,
  searchSearchAnime,
  searchSearchEpisodes,
} from './api'
import { DanDanPlayApiException } from './exceptions'

describe('DanDanPlay API', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  describe('searchSearchEpisodes', () => {
    it('should return error on API error', async () => {
      const mockResponse = {
        errorCode: 1,
        errorMessage: 'Error',
        success: false,
        animes: [],
        hasMore: false,
      }

      mockFetchResponse(mockResponse)

      const result = await searchSearchEpisodes({ anime: 'test' })
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error).toBeInstanceOf(DanDanPlayApiException)
      }
    })

    it('should return error on unexpected data', async () => {
      mockFetchResponse({})

      const result = await searchSearchEpisodes({ anime: 'test' })
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error).toBeInstanceOf(ResponseParseException)
      }
    })
  })

  describe('searchSearchAnime', () => {
    it('should return error on API error', async () => {
      const mockResponse = {
        errorCode: 1,
        errorMessage: 'Error',
        success: false,
      }

      mockFetchResponse(mockResponse)

      const result = await searchSearchAnime('MyGo')
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error).toBeInstanceOf(DanDanPlayApiException)
      }
    })

    it('should return error on unexpected data', async () => {
      mockFetchResponse({})

      const result = await searchSearchAnime('MyGo')
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error).toBeInstanceOf(ResponseParseException)
      }
    })
  })

  describe('commentGetComment', () => {
    it('should return error on unexpected data', async () => {
      mockFetchResponse({})

      const result = await commentGetComment(1)
      expect(result.success).toBe(false)
      if (!result.success) {
        // Since commentGetComment doesn't throw DDP exception (it just returns comments),
        // but if parsing fails, it returns ResponseParseException.
        expect(result.error).toBeInstanceOf(ResponseParseException)
      }
    })
  })

  describe('commentGetCommentManualWithRelated', () => {
    it('should de-dupe overlapping comments across base and related sources', async () => {
      const makeRes = (data: unknown) =>
        ({
          json: vi.fn().mockResolvedValue(data),
          text: vi.fn().mockResolvedValue(data),
          arrayBuffer: vi.fn().mockResolvedValue(data),
          status: 200,
          headers: new Map(),
          clone() {
            return this
          },
        }) as any

      const baseA = { cid: 1, p: '10.00,1,16777215,[BiliBili]u', m: 'a' }
      const baseB = { cid: 2, p: '11.00,1,16777215,[BiliBili]v', m: 'b' }
      const extA = { cid: 1, p: '10.00,1,16777215,[BiliBili]u', m: 'a' }
      const extC = { cid: 3, p: '12.00,1,16777215,[BiliBili]w', m: 'c' }

      vi.spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(
          makeRes({
            count: 3,
            comments: [baseA, baseA, baseB], // include a duplicate in base
          })
        )
        .mockResolvedValueOnce(
          makeRes({
            errorCode: 0,
            errorMessage: '',
            success: true,
            relateds: [{ url: 'https://example.com/ext', shift: 0 }],
          })
        )
        .mockResolvedValueOnce(
          makeRes({
            count: 2,
            comments: [extA, extC], // extA overlaps with baseA
          })
        )

      const result = await commentGetCommentManualWithRelated(1, {
        withRelated: true,
      })

      expect(result.success).toBe(true)
      if (!result.success) return

      const cids = result.data.map((c) => c.cid).sort()
      expect(cids).toEqual([1, 2, 3])
    })
  })

  describe('getBangumiAnime', () => {
    it('should return error on API error', async () => {
      const mockResponse = {
        errorCode: 1,
        errorMessage: 'Error',
        success: false,
      }

      mockFetchResponse(mockResponse)

      const result = await getBangumiAnime('1')
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error).toBeInstanceOf(DanDanPlayApiException)
      }
    })

    it('should return error on unexpected data', async () => {
      mockFetchResponse({})

      const result = await getBangumiAnime('1')
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error).toBeInstanceOf(ResponseParseException)
      }
    })
  })

  it('should call the right url', async () => {
    const mockResponse = {
      errorCode: 0,
      errorMessage: '',
      success: true,
      animes: [],
      hasMore: false,
    }

    const mockFetch = mockFetchResponse(mockResponse)

    await searchSearchEpisodes({ anime: 'test' })

    expect(mockFetch.mock.calls[0][0]).toEqual(
      'https://api.danmaku.weeblify.app/ddp/v1?path=%2Fv2%2Fsearch%2Fepisodes%3Fanime%3Dtest'
    )
  })

  it('should use the configured API root', async () => {
    const mockResponse = {
      errorCode: 0,
      errorMessage: '',
      success: true,
      animes: [],
      hasMore: false,
    }

    const mockFetch = mockFetchResponse(mockResponse)

    const baseUrl = 'https://example.com'

    await searchSearchEpisodes({ anime: 'test' }, { baseUrl, isCustom: true })

    expect(mockFetch.mock.calls[0][0]).toEqual(
      `${baseUrl}/v2/search/episodes?anime=test`
    )
  })
})

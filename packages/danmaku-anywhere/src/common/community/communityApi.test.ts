import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  communityCommentToEntity,
  deleteCommunityComment,
  deriveEpisodeTarget,
  fetchCommunityComments,
  sendCommunityComment,
} from './communityApi'

describe('communityApi', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('derives episode target from mounted episodes or mediaInfo', () => {
    expect(
      deriveEpisodeTarget([
        {
          title: '第05话',
          episodeNumber: 5,
          season: { title: '葬送的芙莉莲' },
        } as never,
      ])
    ).toEqual({
      animeTitle: '葬送的芙莉莲',
      episodeKey: '5',
    })

    expect(
      deriveEpisodeTarget(undefined, {
        title: '迷宫饭',
        episode: 12,
      } as never)
    ).toEqual({
      animeTitle: '迷宫饭',
      episodeKey: '12',
    })
  })

  it('converts CommunityCommentDto to standard CommentEntity modes', () => {
    const entity = communityCommentToEntity({
      id: 'abc-123',
      userId: 'u1',
      animeTitle: 'Show',
      episodeKey: '1',
      time: 42.5,
      mode: 2, // proxy schema: 2 = top -> canonical 5
      color: 16777215,
      content: '前方高能',
      createdAt: '2026-01-01T00:00:00Z',
    })
    expect(entity.p).toBe('42.50,5,16777215,[Community]u1')
    expect(entity.m).toBe('前方高能')
  })

  it('calls GET /community/comments, POST /community/comment, and DELETE /community/comment/:id', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: true,
            data: [
              {
                id: 'c1',
                userId: 'u1',
                animeTitle: 'Frieren',
                episodeKey: '1',
                time: 10,
                mode: 1,
                color: 16777215,
                content: 'hello',
                createdAt: '2026-01-01T00:00:00Z',
              },
            ],
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ success: true, id: 'c2' }), {
          status: 201,
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ success: true }), { status: 200 })
      )

    const list = await fetchCommunityComments(
      { animeTitle: 'Frieren', episodeKey: '1' },
      'https://proxy.example.com'
    )
    expect(list).toHaveLength(1)
    expect(fetchSpy.mock.calls[0][0]).toBe(
      'https://proxy.example.com/community/comments?title=Frieren&episode=1'
    )

    const created = await sendCommunityComment(
      {
        animeTitle: 'Frieren',
        episodeKey: '1',
        time: 12.3,
        content: 'nice!',
      },
      'jwt-token',
      'https://proxy.example.com'
    )
    expect(created.id).toBe('c2')
    expect(fetchSpy.mock.calls[1][1]).toMatchObject({
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer jwt-token',
      },
    })

    await deleteCommunityComment('c2', 'jwt-token', 'https://proxy.example.com')
    expect(fetchSpy.mock.calls[2][0]).toBe(
      'https://proxy.example.com/community/comment/c2'
    )
    expect(fetchSpy.mock.calls[2][1]).toMatchObject({
      method: 'DELETE',
      headers: { Authorization: 'Bearer jwt-token' },
    })
  })
})

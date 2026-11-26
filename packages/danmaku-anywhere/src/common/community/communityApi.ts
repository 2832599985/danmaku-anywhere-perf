import type {
  CommentEntity,
  GenericEpisode,
} from '@danmaku-anywhere/danmaku-converter'
import { uiContainer } from '@/common/ioc/uiIoc'
import { UserAuthStore } from '@/common/options/userAuth/service'
import type { MediaInfo } from '@/content/controller/danmaku/integration/models/MediaInfo'

const DEFAULT_API_ROOT = 'https://api.danmaku.weeblify.app'

export interface CommunityCommentDto {
  id: string
  userId: string
  animeTitle: string
  episodeKey: string
  time: number
  mode: number
  color: number
  content: string
  createdAt: string
}

export interface EpisodeTarget {
  animeTitle: string
  episodeKey: string
}

export function getProxyApiBaseUrl(): string {
  const configured = (import.meta.env as { VITE_PROXY_URL?: string })
    .VITE_PROXY_URL
  return (configured?.trim() || DEFAULT_API_ROOT).replace(/\/+$/, '')
}

export async function getAuthBearerToken(): Promise<string> {
  try {
    const store = uiContainer.get(UserAuthStore)
    await store.ensureReady()
    return (await store.getToken()) ?? store.getTokenSync() ?? ''
  } catch {
    return ''
  }
}

export function deriveEpisodeTarget(
  episodes?: GenericEpisode[],
  mediaInfo?: MediaInfo
): EpisodeTarget | null {
  const primary = episodes?.[0]
  if (primary) {
    const seasonTitle =
      ('season' in primary &&
        primary.season &&
        typeof primary.season === 'object' &&
        'title' in primary.season &&
        typeof primary.season.title === 'string' &&
        primary.season.title.trim()) ||
      primary.title?.trim()
    const epKey =
      ('episodeNumber' in primary &&
      primary.episodeNumber !== undefined &&
      primary.episodeNumber !== null
        ? String(primary.episodeNumber)
        : primary.title?.trim()) || '1'
    if (seasonTitle) {
      return { animeTitle: seasonTitle, episodeKey: epKey }
    }
  }

  if (mediaInfo?.title?.trim()) {
    return {
      animeTitle: mediaInfo.title.trim(),
      episodeKey:
        mediaInfo.episode !== undefined ? String(mediaInfo.episode) : '1',
    }
  }

  return null
}

export function communityCommentToEntity(
  item: CommunityCommentDto
): CommentEntity {
  let hash = 0
  for (const ch of item.id) {
    hash = (hash * 31 + (ch.codePointAt(0) ?? 0)) | 0
  }
  const cid = Math.abs(hash) || 1
  const mode = item.mode === 2 ? 5 : item.mode === 3 ? 4 : 1
  const time = Number.isFinite(item.time) ? Math.max(0, item.time) : 0
  const color = Number.isFinite(item.color) ? item.color : 16777215
  return {
    cid,
    p: `${time.toFixed(2)},${mode},${color},[Community]${item.userId}`,
    m: item.content,
  }
}

export async function fetchCommunityComments(
  target: EpisodeTarget,
  baseUrl = getProxyApiBaseUrl()
): Promise<CommunityCommentDto[]> {
  const params = new URLSearchParams({
    title: target.animeTitle,
    episode: target.episodeKey,
  })
  const res = await fetch(`${baseUrl}/community/comments?${params.toString()}`)
  if (!res.ok) {
    throw new Error(`Failed to fetch community comments (${res.status})`)
  }
  const json = (await res.json()) as {
    success: boolean
    data?: CommunityCommentDto[]
  }
  return Array.isArray(json.data) ? json.data : []
}

export async function sendCommunityComment(
  input: {
    animeTitle: string
    episodeKey: string
    time: number
    mode?: number
    color?: number
    content: string
  },
  token: string,
  baseUrl = getProxyApiBaseUrl()
): Promise<{ id: string }> {
  const res = await fetch(`${baseUrl}/community/comment`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      animeTitle: input.animeTitle,
      episodeKey: input.episodeKey,
      time: Math.max(0, input.time),
      mode: input.mode ?? 1,
      color: input.color ?? 16777215,
      content: input.content.trim(),
    }),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => res.statusText)
    throw new Error(detail || `HTTP ${res.status}`)
  }
  const json = (await res.json()) as { success: boolean; id: string }
  return { id: json.id }
}

export async function deleteCommunityComment(
  id: string,
  token: string,
  baseUrl = getProxyApiBaseUrl()
): Promise<void> {
  const res = await fetch(
    `${baseUrl}/community/comment/${encodeURIComponent(id)}`,
    {
      method: 'DELETE',
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    }
  )
  if (!res.ok) {
    const detail = await res.text().catch(() => res.statusText)
    throw new Error(detail || `HTTP ${res.status}`)
  }
}

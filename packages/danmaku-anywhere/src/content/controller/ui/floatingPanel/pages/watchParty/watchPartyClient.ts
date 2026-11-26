import { useSyncExternalStore } from 'react'
import {
  getAuthBearerToken,
  getProxyApiBaseUrl,
} from '@/common/community/communityApi'
import { playerRpcClient } from '@/common/rpcClient/background/client'
import { useStore } from '@/content/controller/store/store'

export interface WatchPartySnapshot {
  connected: boolean
  connecting: boolean
  roomId: string
  memberCount: number
  animeTitle: string
  episode: string
}

interface WatchRoomWsMessage {
  type: 'danmaku' | 'sync' | 'join' | 'leave' | 'pause' | 'play' | 'seek'
  data?: unknown
  userId?: string
  userName?: string
  memberCount?: number
}

export function parseRoomCode(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return ''
  if (trimmed.toLowerCase().startsWith('watchparty:')) {
    return trimmed.slice('watchparty:'.length).trim()
  }
  try {
    const url = new URL(trimmed)
    const fromParam = url.searchParams.get('room') ?? url.searchParams.get('id')
    if (fromParam) return fromParam.trim()
    const lastSeg = url.pathname.split('/').filter(Boolean).pop()
    if (lastSeg) return lastSeg.trim()
  } catch {
    // Plain room ID
  }
  return trimmed
}

export function buildWatchRoomWsUrl(
  baseUrl: string,
  roomId: string,
  token: string
): string {
  const wsBase = baseUrl.replace(/^http:/i, 'ws:').replace(/^https:/i, 'wss:')
  const url = new URL(
    `${wsBase.replace(/\/+$/, '')}/rooms/${encodeURIComponent(roomId)}/ws`
  )
  if (token) {
    url.searchParams.set('token', token)
  }
  return url.toString()
}

class WatchPartySessionManager {
  private ws: WebSocket | null = null
  private listeners = new Set<() => void>()
  private snapshot: WatchPartySnapshot = {
    connected: false,
    connecting: false,
    roomId: '',
    memberCount: 0,
    animeTitle: '',
    episode: '',
  }

  getSnapshot = (): WatchPartySnapshot => this.snapshot

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private update(patch: Partial<WatchPartySnapshot>) {
    this.snapshot = { ...this.snapshot, ...patch }
    for (const listener of this.listeners) {
      listener()
    }
  }

  async createRoom(animeTitle: string, episode: string): Promise<string> {
    const token = await getAuthBearerToken()
    if (!token) {
      throw new Error('AUTH_REQUIRED')
    }
    const baseUrl = getProxyApiBaseUrl()
    this.update({ connecting: true })
    try {
      const res = await fetch(`${baseUrl}/rooms/create`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ animeTitle, episode }),
      })
      if (res.status === 401) {
        throw new Error('AUTH_REQUIRED')
      }
      if (!res.ok) {
        const text = await res.text().catch(() => res.statusText)
        throw new Error(text || `HTTP ${res.status}`)
      }
      const json = (await res.json()) as { success: boolean; roomId: string }
      await this.connectWebSocket(
        json.roomId,
        token,
        baseUrl,
        animeTitle,
        episode,
        1
      )
      return json.roomId
    } catch (e) {
      this.update({ connecting: false })
      throw e
    }
  }

  async joinRoom(rawInput: string): Promise<string> {
    const roomId = parseRoomCode(rawInput)
    if (!roomId) {
      throw new Error('INVALID_ROOM')
    }
    const token = await getAuthBearerToken()
    if (!token) {
      throw new Error('AUTH_REQUIRED')
    }
    const baseUrl = getProxyApiBaseUrl()
    this.update({ connecting: true })
    try {
      let memberCount = 1
      let animeTitle = ''
      let episode = ''
      const infoRes = await fetch(
        `${baseUrl}/rooms/${encodeURIComponent(roomId)}/info`
      ).catch(() => null)
      if (infoRes?.ok) {
        const infoJson = (await infoRes.json()) as {
          success: boolean
          data?: {
            memberCount?: number
            state?: { animeTitle?: string; episode?: string } | null
          }
        }
        memberCount = (infoJson.data?.memberCount ?? 0) + 1
        animeTitle = infoJson.data?.state?.animeTitle ?? ''
        episode = infoJson.data?.state?.episode ?? ''
      }
      await this.connectWebSocket(
        roomId,
        token,
        baseUrl,
        animeTitle,
        episode,
        memberCount
      )
      return roomId
    } catch (e) {
      this.update({ connecting: false })
      throw e
    }
  }

  private connectWebSocket(
    roomId: string,
    token: string,
    baseUrl: string,
    animeTitle: string,
    episode: string,
    initialMembers: number
  ): Promise<void> {
    this.leave()
    const wsUrl = buildWatchRoomWsUrl(baseUrl, roomId, token)

    return new Promise((resolve, reject) => {
      let settled = false
      const socket = new WebSocket(wsUrl)
      this.ws = socket

      socket.addEventListener('open', () => {
        settled = true
        this.update({
          connected: true,
          connecting: false,
          roomId,
          memberCount: Math.max(1, initialMembers),
          animeTitle,
          episode,
        })
        resolve()
      })

      socket.addEventListener('message', (event) => {
        if (typeof event.data !== 'string') return
        try {
          const msg = JSON.parse(event.data) as WatchRoomWsMessage
          this.handleMessage(msg)
        } catch {
          // Ignore malformed payloads
        }
      })

      socket.addEventListener('error', () => {
        if (!settled) {
          settled = true
          this.ws = null
          this.update({ connected: false, connecting: false })
          reject(new Error('WS_CONNECT_FAILED'))
        }
      })

      socket.addEventListener('close', () => {
        if (this.ws === socket) {
          this.ws = null
          this.update({
            connected: false,
            connecting: false,
            memberCount: 0,
          })
        }
        if (!settled) {
          settled = true
          reject(new Error('WS_CONNECT_CLOSED'))
        }
      })
    })
  }

  private handleMessage(msg: WatchRoomWsMessage) {
    switch (msg.type) {
      case 'join': {
        this.update({
          memberCount:
            typeof msg.memberCount === 'number'
              ? msg.memberCount
              : this.snapshot.memberCount + 1,
        })
        break
      }
      case 'leave': {
        this.update({
          memberCount:
            typeof msg.memberCount === 'number'
              ? msg.memberCount
              : Math.max(1, this.snapshot.memberCount - 1),
        })
        break
      }
      case 'sync': {
        const payload = (msg.data ?? {}) as {
          currentTime?: number
          playing?: boolean
          state?: { animeTitle?: string; episode?: string } | null
        }
        if (typeof msg.memberCount === 'number') {
          this.update({
            memberCount: msg.memberCount,
            animeTitle: payload.state?.animeTitle ?? this.snapshot.animeTitle,
            episode: payload.state?.episode ?? this.snapshot.episode,
          })
        }
        if (
          typeof payload.currentTime === 'number' ||
          typeof payload.playing === 'boolean'
        ) {
          this.applyRemotePlayback({
            currentTime: payload.currentTime,
            playing: payload.playing,
          })
        }
        break
      }
      case 'play': {
        const data = (msg.data ?? {}) as { currentTime?: number }
        this.applyRemotePlayback({
          playing: true,
          currentTime: data.currentTime,
        })
        break
      }
      case 'pause': {
        const data = (msg.data ?? {}) as { currentTime?: number }
        this.applyRemotePlayback({
          playing: false,
          currentTime: data.currentTime,
        })
        break
      }
      case 'seek': {
        const time =
          typeof msg.data === 'number'
            ? msg.data
            : ((msg.data as { currentTime?: number } | undefined)
                ?.currentTime ?? undefined)
        if (typeof time === 'number') {
          this.applyRemotePlayback({ currentTime: time })
        }
        break
      }
      case 'danmaku': {
        const data = (msg.data ?? {}) as {
          text?: string
          color?: string
          mode?: 'rtl' | 'top' | 'bottom'
        }
        if (data.text) {
          this.emitLiveComment(data.text, data.color, data.mode)
        }
        break
      }
    }
  }

  private applyRemotePlayback(state: {
    playing?: boolean
    currentTime?: number
  }) {
    const activeFrame = useStore.getState().frame.getActiveFrame()
    if (!activeFrame) return
    void playerRpcClient.player['relay:command:setPlaybackState']({
      frameId: activeFrame.frameId,
      data: state,
    })
  }

  private emitLiveComment(
    text: string,
    color?: string,
    mode?: 'rtl' | 'top' | 'bottom'
  ) {
    const activeFrame = useStore.getState().frame.getActiveFrame()
    if (!activeFrame) return
    void playerRpcClient.player['relay:command:emitComment']({
      frameId: activeFrame.frameId,
      data: { text, color, mode },
    })
  }

  async broadcastSync(): Promise<boolean> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false
    const activeFrame = useStore.getState().frame.getActiveFrame()
    if (!activeFrame) return false
    const res = await playerRpcClient.player['relay:command:getPlaybackState']({
      frameId: activeFrame.frameId,
    })
    if (!res.data) return false
    this.ws.send(
      JSON.stringify({
        type: 'sync',
        data: {
          currentTime: res.data.currentTime,
          playing: !res.data.paused,
        },
      } satisfies WatchRoomWsMessage)
    )
    return true
  }

  sendRoomDanmaku(text: string): boolean {
    const trimmed = text.trim()
    if (!trimmed || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return false
    }
    this.ws.send(
      JSON.stringify({
        type: 'danmaku',
        data: { text: trimmed, mode: 'rtl', color: '#ffffff' },
      } satisfies WatchRoomWsMessage)
    )
    this.emitLiveComment(trimmed, '#ffffff', 'rtl')
    return true
  }

  leave() {
    if (this.ws) {
      try {
        this.ws.close()
      } catch {
        // ignore
      }
      this.ws = null
    }
    this.update({
      connected: false,
      connecting: false,
      roomId: '',
      memberCount: 0,
      animeTitle: '',
      episode: '',
    })
  }
}

export const watchPartySession = new WatchPartySessionManager()

export function useWatchPartySession(): WatchPartySnapshot {
  return useSyncExternalStore(
    watchPartySession.subscribe,
    watchPartySession.getSnapshot,
    watchPartySession.getSnapshot
  )
}

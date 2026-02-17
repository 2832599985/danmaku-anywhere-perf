import { DanmakuSourceType } from '@danmaku-anywhere/danmaku-converter'
import type { AutomationMode } from '@/common/options/mountConfig/schema'

export interface MountConfigTemplate {
  /** Template identifier -- stable across versions for update tracking */
  templateId: string
  name: string
  description: string
  patterns: string[]
  mediaQuery: string
  mode: AutomationMode
  /** Category for grouping in the picker UI */
  category: 'chinese' | 'international' | 'self-hosted'
  /** Default preferred provider order for this template */
  preferredProviders?: DanmakuSourceType[]
}

export const mountConfigTemplates: MountConfigTemplate[] = [
  // Chinese sites
  {
    templateId: 'bilibili',
    name: 'Bilibili',
    description: 'bilibili.com',
    patterns: ['https://www.bilibili.com/*'],
    mediaQuery: 'video',
    mode: 'ai',
    category: 'chinese',
    preferredProviders: [
      DanmakuSourceType.Bilibili,
      DanmakuSourceType.DanDanPlay,
    ],
  },
  {
    templateId: 'bilibili-bangumi',
    name: 'Bilibili Bangumi',
    description: 'bilibili.com/bangumi',
    patterns: ['https://www.bilibili.com/bangumi/*'],
    mediaQuery: 'video',
    mode: 'ai',
    category: 'chinese',
    preferredProviders: [
      DanmakuSourceType.Bilibili,
      DanmakuSourceType.DanDanPlay,
    ],
  },
  {
    templateId: 'iqiyi',
    name: 'iQIYI',
    description: 'iqiyi.com',
    patterns: ['https://www.iqiyi.com/*'],
    mediaQuery: 'video',
    mode: 'ai',
    category: 'chinese',
  },
  {
    templateId: 'youku',
    name: 'Youku',
    description: 'youku.com',
    patterns: ['https://v.youku.com/*'],
    mediaQuery: 'video',
    mode: 'ai',
    category: 'chinese',
  },
  {
    templateId: 'tencent-video',
    name: 'Tencent Video',
    description: 'v.qq.com',
    patterns: ['https://v.qq.com/*'],
    mediaQuery: 'video',
    mode: 'ai',
    category: 'chinese',
    preferredProviders: [
      DanmakuSourceType.Tencent,
      DanmakuSourceType.DanDanPlay,
    ],
  },
  {
    templateId: 'mango-tv',
    name: 'Mango TV',
    description: 'mgtv.com',
    patterns: ['https://www.mgtv.com/*'],
    mediaQuery: 'video',
    mode: 'ai',
    category: 'chinese',
  },
  // International sites
  {
    templateId: 'youtube',
    name: 'YouTube',
    description: 'youtube.com',
    patterns: ['https://www.youtube.com/*'],
    mediaQuery: 'video',
    mode: 'ai',
    category: 'international',
  },
  {
    templateId: 'netflix',
    name: 'Netflix',
    description: 'netflix.com',
    patterns: ['https://www.netflix.com/*'],
    mediaQuery: 'video',
    mode: 'ai',
    category: 'international',
    preferredProviders: [DanmakuSourceType.DanDanPlay],
  },
  {
    templateId: 'crunchyroll',
    name: 'Crunchyroll',
    description: 'crunchyroll.com',
    patterns: ['https://www.crunchyroll.com/*'],
    mediaQuery: 'video',
    mode: 'ai',
    category: 'international',
    preferredProviders: [DanmakuSourceType.DanDanPlay],
  },
  {
    templateId: 'disney-plus',
    name: 'Disney+',
    description: 'disneyplus.com',
    patterns: ['https://www.disneyplus.com/*'],
    mediaQuery: 'video',
    mode: 'ai',
    category: 'international',
  },
  {
    templateId: 'prime-video',
    name: 'Prime Video',
    description: 'primevideo.com',
    patterns: [
      'https://www.primevideo.com/*',
      'https://www.amazon.com/gp/video/*',
    ],
    mediaQuery: 'video',
    mode: 'ai',
    category: 'international',
  },
  {
    templateId: 'twitch',
    name: 'Twitch',
    description: 'twitch.tv',
    patterns: ['https://www.twitch.tv/*'],
    mediaQuery: 'video',
    mode: 'ai',
    category: 'international',
  },
  // Self-hosted
  {
    templateId: 'plex',
    name: 'Plex',
    description: 'app.plex.tv',
    patterns: ['https://app.plex.tv/*'],
    mediaQuery: 'video',
    mode: 'ai',
    category: 'self-hosted',
  },
  {
    templateId: 'jellyfin',
    name: 'Jellyfin',
    description: 'Jellyfin',
    patterns: [],
    mediaQuery: 'video',
    mode: 'ai',
    category: 'self-hosted',
  },
  {
    templateId: 'emby',
    name: 'Emby',
    description: 'Emby',
    patterns: [],
    mediaQuery: 'video',
    mode: 'ai',
    category: 'self-hosted',
  },
]

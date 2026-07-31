import { extractTitle } from '@danmaku-anywhere/danmaku-provider/genAi'
import { ensureConfigured } from './ddp'

export interface AiTitleInfo {
  /** Parsed show title (season included, episode number stripped). */
  title: string
  /** Parsed episode number (0 when the AI found none). */
  episode: number
}

/**
 * Parse an anime title + episode out of a video filename using the project's
 * free built-in AI (a proxy-hosted Gemini; no API key on the client). The
 * endpoint is the same `api.danmaku.weeblify.app` host the DanDanPlay calls
 * already use, so the Tauri fetch bridge + capability scope cover it as-is.
 *
 * Returns null on ANY failure — network error, non-200, "not a show", empty
 * title, or a too-short filename (the worker rejects inputs under 10 chars).
 * Callers treat null as "no auto-match" and never surface it as an error.
 */
export const aiExtractTitle = async (
  filename: string
): Promise<AiTitleInfo | null> => {
  const input = filename.trim()
  if (input.length < 10) return null
  try {
    ensureConfigured()
    const result = await extractTitle(input)
    if (!result.success) return null
    const { isShow, title, episode } = result.data
    if (!isShow || title.trim().length === 0) return null
    return {
      title: title.trim(),
      episode: Number.isFinite(episode) ? Math.max(0, Math.trunc(episode)) : 0,
    }
  } catch {
    // Offline / unreachable proxy: degrade silently to "no match".
    return null
  }
}

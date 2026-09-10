import { extractTitle } from '@danmaku-anywhere/danmaku-provider/genAi'
import { ensureConfigured } from './ddp'

export interface AiTitleInfo {
  /** Parsed show title (season included, episode number stripped). */
  title: string
  /** Parsed episode number (0 when the AI found none). */
  episode: number
  /** Other titles the model knows for the same show (romaji/English/Chinese). */
  altTitles: string[]
}

/**
 * Parse an anime title + episode out of a video filename using the project's
 * free built-in AI (a proxy-hosted Gemini; no API key on the client). The
 * endpoint is the same `api.danmaku.weeblify.app` host the DanDanPlay calls
 * already use, so the Tauri fetch bridge + capability scope cover it as-is.
 *
 * The request is tagged `filename` so the proxy picks the prompt written for
 * video file names instead of the extension's "HTML from a website" one.
 * `altTitles` matters here: the model often returns the romaji title as the
 * primary and the Chinese one as an alt, and DanDanPlay searches far better on
 * the Chinese title.
 *
 * Returns null on ANY failure — network error, non-200, "not a show", empty
 * title, or a too-short filename (the worker rejects inputs under 10 chars).
 * Callers must surface that to the user (open the picker) rather than assume
 * "no danmaku".
 */
export const aiExtractTitle = async (
  filename: string
): Promise<AiTitleInfo | null> => {
  const input = filename.trim()
  if (input.length < 10) return null
  try {
    ensureConfigured()
    const result = await extractTitle(input, 'filename')
    if (!result.success) return null
    const { isShow, title, episode, altTitles } = result.data
    if (!isShow || title.trim().length === 0) return null
    return {
      title: title.trim(),
      episode: Number.isFinite(episode) ? Math.max(0, Math.trunc(episode)) : 0,
      altTitles: (altTitles ?? [])
        .map((t) => t.trim())
        .filter((t) => t.length > 0 && t !== title.trim()),
    }
  } catch {
    // Offline / unreachable proxy: degrade to "no match" — the caller decides
    // how to tell the user.
    return null
  }
}

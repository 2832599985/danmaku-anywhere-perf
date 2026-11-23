import { extractTitle } from '@danmaku-anywhere/danmaku-provider/genAi'
import { ensureConfigured } from './ddp'
import { aiInputForFilename } from './releaseName'

export interface AiTitleInfo {
  /** Parsed show title (season included, episode number stripped). */
  title: string
  /** Parsed episode number (0 when the AI found none). */
  episode: number
  /** Other titles the model knows for the same show (romaji/English/Chinese). */
  altTitles: string[]
}

/** Beyond this the deterministic pipeline is better than waiting. */
const AI_TIMEOUT_MS = 6000

/**
 * Parse an anime title + episode out of a video filename using the project's
 * free built-in AI (a proxy-hosted Gemini; no API key on the client).
 *
 * The input is the SANITIZED release name (`title - episode`), not the raw
 * file name: fansub group tags are what made the HTML-oriented proxy prompt
 * garble CJK titles, and a leading `[LoliHouse]`/`[Loli]` even made it return
 * HTTP 500 (Gemini safety filter). The prompt has no filename mode yet
 * (`inputType` is ignored by the deployed proxy), so the cleaner the text,
 * the better the answer.
 *
 * Returns null on ANY failure — the caller must CONTINUE with the
 * deterministic filename pipeline; this function is an enhancer, not a gate.
 */
export const aiExtractTitle = async (
  filename: string
): Promise<AiTitleInfo | null> => {
  const input = aiInputForFilename(filename).trim()
  if (input.length < 10) return null
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    ensureConfigured()
    // A dead/slow AI must not hold the deterministic pipeline hostage. The
    // request itself is not cancellable (the provider owns its fetch), so it
    // simply finishes in the background.
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), AI_TIMEOUT_MS)
    })
    const result = await Promise.race([
      extractTitle(input, 'filename'),
      timeout,
    ])
    if (!result || !result.success) return null
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
    // Offline / unreachable proxy: the deterministic filename pipeline runs
    // anyway; the caller only loses the extra title candidates.
    return null
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

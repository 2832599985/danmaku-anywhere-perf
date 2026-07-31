import type { DdpAnime, DdpEpisode } from './ddp'

/**
 * Heuristics that turn an AI-parsed (title, episode) into a concrete
 * DanDanPlay season + episode. DDP search results carry NO numeric episode
 * field (only `episodeTitle`), so the episode number is parsed back out of the
 * title with a 1-based-index fallback — the same shape of logic the
 * extension's `findEpisodeByNumber` uses, minus the heavy regex machinery.
 */

/** Last "small" integer token in a title, read as the episode number. */
const episodeFromTitle = (title: string): number | null => {
  const matches = title.match(/\d+/g)
  if (!matches) return null
  for (let i = matches.length - 1; i >= 0; i--) {
    const n = Number(matches[i])
    if (n > 0 && n < 10000) return n
  }
  return null
}

/** Resolve a target episode number against a season's episode list. */
export const pickEpisode = (
  episodes: DdpEpisode[],
  episodeNumber: number
): DdpEpisode | null => {
  if (episodes.length === 0) return null
  // 1. a title whose parsed number equals the target
  if (episodeNumber > 0) {
    for (const ep of episodes) {
      if (episodeFromTitle(ep.episodeTitle) === episodeNumber) return ep
    }
    // 2. 1-based index (episode 7 -> episodes[6]) — common for season packs
    const idx = episodeNumber - 1
    if (idx >= 0 && idx < episodes.length) return episodes[idx]
  }
  // 3. the bare number appears anywhere in a title
  if (episodeNumber > 0) {
    const needle = String(episodeNumber)
    for (const ep of episodes) {
      if (ep.episodeTitle.includes(needle)) return ep
    }
  }
  // 4. give up on the number, take the first episode
  return episodes[0] ?? null
}

/** Normalize for fuzzy title comparison (drop punctuation + whitespace). */
const normalize = (s: string): string =>
  s.toLowerCase().replace(/[\s_\-·:：.。,，!！?？'’"“”()\[\]【】（）]/g, '')

/** Pick the best season from a DDP search: exact > contains > first. */
export const pickSeason = (
  animes: DdpAnime[],
  title: string
): DdpAnime | null => {
  if (animes.length === 0) return null
  const t = normalize(title)
  if (!t) return animes[0]
  const exact = animes.find((a) => normalize(a.animeTitle) === t)
  if (exact) return exact
  const contains = animes.find((a) => {
    const at = normalize(a.animeTitle)
    return at.includes(t) || t.includes(at)
  })
  return contains ?? animes[0]
}

import { chineseToNumber } from './chineseToNumber.js'
import { mediaRegexMatcher } from './mediaRegexMatcher.js'

/**
 * The minimum shape this module needs: a title plus, when the source provides
 * it, an explicit episode number. Providers' episode objects are structurally
 * compatible, so callers pass their own types through unchanged.
 */
export interface EpisodeLike {
  title: string
  /** Some providers hand back the number as a string ("11") — accept both. */
  episodeNumber?: string | number
}

function getEpisodeNumberFromTitle(title: string): number | null {
  const match = mediaRegexMatcher.findCommonEpisode(title)

  if (match) {
    const numericTitle = chineseToNumber(match.value.toString())
    if (numericTitle !== null) {
      return numericTitle
    }
  }

  return null
}

/**
 * Resolve an episode by its number: prefer the provider's explicit
 * `episodeNumber`, fall back to parsing the episode's title with the shared
 * media regexes (E11 / Episode 11 / 第11话 / S01E11 + Chinese numerals).
 *
 * Returns null when nothing matches — callers must NOT substitute a
 * "first episode" guess; they surface the ambiguity to the user instead.
 */
export function findEpisodeByNumber<T extends EpisodeLike>(
  episodes: T[],
  episodeNumber: number
): T | null {
  const episodeByNumber = episodes.find((ep) => {
    // try to match by the episodeNumber field if it exists
    if (ep.episodeNumber !== undefined) {
      return ep.episodeNumber.toString() === episodeNumber.toString()
    }

    // try to extract a numeric episode number from the title
    const matchedEpisodeNumber = getEpisodeNumberFromTitle(ep.title)

    if (matchedEpisodeNumber !== null) {
      return matchedEpisodeNumber === episodeNumber
    }

    return false
  })

  if (episodeByNumber !== undefined) {
    return episodeByNumber
  }

  return null
}

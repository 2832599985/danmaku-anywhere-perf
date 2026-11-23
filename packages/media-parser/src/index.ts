/**
 * Media title parsing shared by the browser extension and the desktop player.
 *
 * Everything here is pure string/number work — no DOM, no chrome.*, no store —
 * so the extension's content script, its background service worker and the
 * Tauri player all resolve seasons/episodes through ONE implementation. The
 * player used to carry its own heuristics ("last number in the title"),
 * which turned `第11话 [1080p]` into episode 1080 and then silently fell back
 * to episode 1.
 */

export { chineseToNumber } from './chineseToNumber.js'
export { type EpisodeLike, findEpisodeByNumber } from './findEpisodeByNumber.js'
export { MediaParser, type MediaParserInput } from './MediaParser.js'
export { mediaRegexMatcher, sortSelectors } from './mediaRegexMatcher.js'
export { PATTERNS } from './mediaRegexPatterns.js'
export {
  extractSeasonHint,
  findBestMatchingSeason,
  normalizeTitle,
} from './titleMatch.js'
export type { ExtractorMatch, MediaInfoParseResult } from './types.js'

/**
 * Sibling-episode scan: find the rest of the batch sitting next to the file
 * that was just opened, so the playlist can carry on by itself.
 *
 * The identity of a "batch" is the file name's **literal head**: everything
 * before the episode number (`魔法光源股份有限公司 第 `, `[Sakurato] BLEACH … [`).
 * Files are only siblings when that head matches exactly, which is what keeps a
 * folder holding many shows (the normal case for a scraped library) from
 * dragging other series into the queue.
 *
 * A file whose episode number cannot be determined is skipped, never guessed —
 * same discipline as the danmaku matching. The scan is deliberately
 * same-directory only: it is called on every open, and walking a tree would
 * make opening a file depend on the size of the library.
 */

import { basenameWithoutExt } from '@/danmaku/autoMatch'
import { candidateRuns, type DigitRun, dirname } from '@/danmaku/filenameRules'

export interface SiblingEpisode {
  /** Absolute path of the sibling file. */
  path: string
  /** File name WITH its extension — this is what the playlist shows. */
  name: string
  /** Episode number as read from ITS OWN file name. */
  episode: number
}

/**
 * Characters that announce an episode number. Used only to *prefer* one digit
 * run over another when a name holds several (`第 10 集：第10集 …` and
 * `Show 10 1080p` both do).
 */
const EPISODE_MARKERS = ['集', '话', '話', '回', '章', '編', '编', '期']

/** Minimum literal head length for the grouping to mean anything (`1.mkv` → no). */
const MIN_HEAD_CHARS = 3

/** Upper bound on one batch, so a pathological folder cannot flood the list. */
const MAX_SIBLINGS = 200

const normalize = (value: string): string => value.toLowerCase()

/** Everything before `index`, lower-cased: the batch identity. */
const head = (name: string, index: number): string =>
  normalize(name.slice(0, index))

/** The digit run to treat as the episode number, or null when unsure. */
const markedRun = (name: string, runs: DigitRun[]): DigitRun | null => {
  const marked = runs.find((run) => {
    const after = name
      .slice(run.index + run.text.length, run.index + run.text.length + 2)
      .trimStart()
    return EPISODE_MARKERS.some((marker) => after.startsWith(marker))
  })
  if (marked) return marked
  // No marker: trust a single unambiguous number (`Show - 10.mkv`,
  // `[Group] Show [10][AVC AAC].mkv`). Two or more (a date, an id) → no opinion.
  return runs.length === 1 ? runs[0] : null
}

/**
 * Locate the episode number in one file name.
 * `fromRule` (a learned rule's episode) only breaks ties: the rule already told
 * us the value, and this finds where it sits so the head can be derived.
 */
export const locateEpisode = (
  name: string,
  fromRule: number | null = null
): { episode: number; index: number } | null => {
  const runs = candidateRuns(name)
  const run = markedRun(name, runs)
  if (run) {
    const episode = Number(run.text)
    if (Number.isInteger(episode) && episode > 0) {
      return { episode, index: run.index }
    }
  }
  if (fromRule !== null && fromRule > 0) {
    const hit = runs.find((candidate) => Number(candidate.text) === fromRule)
    if (hit) return { episode: fromRule, index: hit.index }
  }
  return null
}

/**
 * The episodes of the same batch as `currentPath`, ordered, excluding itself.
 *
 * `paths` is whatever the platform listed for the folder (order irrelevant);
 * `episodeFromRule` lets a learned rule supply the episode number for shapes
 * the heuristic cannot read — the user already decided what the number means
 * there, so it outranks guessing.
 */
export function selectSiblings(
  currentPath: string,
  paths: string[],
  episodeFromRule: (path: string) => number | null = () => null
): SiblingEpisode[] {
  const currentName = basenameWithoutExt(currentPath)
  // The heuristic first; a learned rule covers the shapes it cannot read. If
  // neither knows, there is nothing to anchor the batch on.
  const current = locateEpisode(currentName, episodeFromRule(currentPath))
  if (!current) return []
  const prefix = head(currentName, current.index)
  if (prefix.trim().length < MIN_HEAD_CHARS) return []

  const dir = dirname(currentPath)
  const found: SiblingEpisode[] = []
  const seen = new Set<string>([normalize(currentPath)])
  for (const path of paths) {
    if (seen.has(normalize(path))) continue
    if (dirname(path) !== dir) continue
    const base = basenameWithoutExt(path)
    const located = locateEpisode(base, episodeFromRule(path))
    if (!located) continue
    // Same batch only: the literal head must match, which is what a rule match
    // on a *different* show (same folder) would otherwise slip past.
    if (head(base, located.index) !== prefix) continue
    seen.add(normalize(path))
    found.push({
      path,
      name: path.split(/[\\/]/).pop() ?? base,
      episode: located.episode,
    })
  }
  found.sort((a, b) => a.episode - b.episode || a.name.localeCompare(b.name))
  return found.slice(0, MAX_SIBLINGS)
}

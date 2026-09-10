import { basenameWithoutExt } from './autoMatch'

/**
 * "Learned" file-naming rules: the persistent half of the AI auto-match.
 *
 * A release batch repeats one naming shape and changes only the episode
 * number. The shared parser (`@danmaku-anywhere/media-parser`) only recognises
 * explicit markers (`E11` / `第11话` / `S01E11`), so a shape like
 * `[Sakurato] BLEACH 千年血战篇-诀别谭- [10][AVC AAC][1080p].mkv` is invisible to
 * it and the picker opens. Once the user picks the episode by hand, the shape
 * is no longer ambiguous: we know which digit run is the episode AND which
 * season the whole batch belongs to. That is what this module records and
 * replays — it never guesses, it only repeats a decision the user made.
 *
 * A rule is a regex built from the *prefix* of the sample file name (anchored
 * at the start), with the episode digit run as the only capture group and every
 * other digit run as `\d+` so that per-file differences (resolution, CRC hash)
 * do not break the match. Text after the episode is only used as a short
 * literal tail, so trailing per-file junk is ignored.
 */

/** The season a learned rule points at (the parts needed to re-fetch it). */
export interface RuleSeason {
  /** Season id for DanDanPlay's bangumi detail endpoint. */
  bangumiId: string
  /** Season title, shown in the picker prefill and in the settings list. */
  title: string
  /** Total episode count (informational only — never used to reject a match). */
  episodeCount: number
}

export interface FilenameRule {
  id: string
  /** Regex source: `^` + literal prefix + `(\d{1,4})` + literal tail. */
  pattern: string
  /** The basename the rule was learned from (settings display). */
  sample: string
  /** Directory of the sample; used to rank matches, never to filter them. */
  folder: string
  season: RuleSeason
  /** The episode the user picked for the sample file (settings display). */
  episode: number
  /** How often the rule has auto-mounted something (settings display + ranking). */
  hits: number
  updatedAt: number
}

export interface RuleMatch {
  rule: FilenameRule
  episode: number
}

/** Picker note shown when a rule matched but the season lacks that episode. */
export const REASON_RULE_EPISODE_MISSING = '命名规则命中的集数不在这一季'

/** Digit runs longer than this can never be an episode number. */
const MAX_EPISODE_DIGITS = 4
/** Literal characters the pattern must keep, or it matches far too much. */
const MIN_LITERAL_CHARS = 3
/** How much of the text after the episode stays literal (up to the next number). */
const TAIL_CHARS = 6

const escapeRegExp = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Directory part of an absolute path ('' when there is none). */
export const dirname = (path: string): string => {
  const dir = path.replace(/[\\/][^\\/]*$/, '')
  return dir === path ? '' : dir
}

interface DigitRun {
  index: number
  text: string
}

/** Every digit run in `base`, in order. */
const digitRuns = (base: string): DigitRun[] => {
  const out: DigitRun[] = []
  for (const match of base.matchAll(/\d+/g)) {
    if (match.index === undefined) continue
    out.push({ index: match.index, text: match[0] })
  }
  return out
}

/**
 * Digit runs that could be the episode marker: short enough, and NOT glued to
 * a letter on either side. `1080p`, `x264` and `10bit` are release metadata;
 * `E10` / `S01E10` are markers the shared parser already handles, so there is
 * nothing to learn for them either.
 */
const candidateRuns = (base: string): DigitRun[] =>
  digitRuns(base).filter((run) => {
    if (run.text.length > MAX_EPISODE_DIGITS) return false
    const before = run.index > 0 ? base[run.index - 1] : ''
    const after = base[run.index + run.text.length] ?? ''
    return !/[A-Za-z]/.test(before) && !/[A-Za-z]/.test(after)
  })

export interface LearnRuleInput {
  /** Absolute path of the file the user just matched by hand. */
  filePath: string
  /** The episode number the user picked (non-integers, e.g. "SP1", are skipped). */
  episode: number
  season: RuleSeason
}

/**
 * Derive a rule from one manual season/episode choice, or null when the file
 * name is too ambiguous to learn from. Null is the safe answer: the picker
 * simply opens again next time.
 */
export function learnRule(input: LearnRuleInput): FilenameRule | null {
  const { episode } = input
  if (!Number.isInteger(episode) || episode <= 0) return null

  const base = basenameWithoutExt(input.filePath)
  // Ambiguous (the number appears twice, e.g. "Bleach - 10 - 10") or absent
  // (the user typed a number that is not in the name at all) — do not learn.
  const candidates = candidateRuns(base).filter(
    (run) => Number(run.text) === episode
  )
  if (candidates.length !== 1) return null
  const slot = candidates[0]

  const runs = digitRuns(base)
  const prefix: string[] = ['^']
  let literalChars = 0
  let cursor = 0
  for (const run of runs) {
    if (run.index >= slot.index) break
    const literal = base.slice(cursor, run.index)
    prefix.push(escapeRegExp(literal), '\\d+')
    literalChars += literal.length
    cursor = run.index + run.text.length
  }
  const headLiteral = base.slice(cursor, slot.index)
  prefix.push(escapeRegExp(headLiteral), '(\\d{1,4})')
  literalChars += headLiteral.length

  // Short literal tail: up to the next digit run (so a trailing CRC or
  // resolution is left unconstrained) and at most TAIL_CHARS long.
  const slotEnd = slot.index + slot.text.length
  const nextRun = runs.find((run) => run.index >= slotEnd)
  const tailEnd = Math.min(
    nextRun ? nextRun.index : base.length,
    slotEnd + TAIL_CHARS
  )
  const tail = base.slice(slotEnd, tailEnd)
  literalChars += tail.length

  // "10" alone would become `^(\d{1,4})$` and match any bare-numbered file
  // anywhere on disk — refuse to learn from names with no other content.
  if (literalChars < MIN_LITERAL_CHARS) return null

  return {
    id: crypto.randomUUID(),
    pattern: `${prefix.join('')}${escapeRegExp(tail)}`,
    sample: base,
    folder: dirname(input.filePath),
    season: input.season,
    episode,
    hits: 0,
    updatedAt: Date.now(),
  }
}

/**
 * Ranking used when several rules match: the sample's own folder first (the
 * download batch the rule came from), then the most-used, then the newest.
 */
export const orderRules = (
  rules: FilenameRule[],
  folder: string
): FilenameRule[] =>
  [...rules].sort(
    (a, b) =>
      (a.folder === folder ? 0 : 1) - (b.folder === folder ? 0 : 1) ||
      b.hits - a.hits ||
      b.updatedAt - a.updatedAt
  )

/**
 * First learned rule whose pattern matches `filePath`, with the episode number
 * it read out of the name. Corrupt persisted patterns are skipped rather than
 * thrown — this runs on every video open.
 */
export function matchRule(
  rules: FilenameRule[],
  filePath: string,
  folder?: string
): RuleMatch | null {
  if (rules.length === 0) return null
  const base = basenameWithoutExt(filePath)
  const dir = folder ?? dirname(filePath)
  for (const rule of orderRules(rules, dir)) {
    let matched: RegExpExecArray | null = null
    try {
      matched = new RegExp(rule.pattern, 'i').exec(base)
    } catch {
      continue // corrupt rule from an older/edited store
    }
    if (!matched) continue
    const episode = Number(matched[1])
    if (!Number.isInteger(episode) || episode <= 0) continue
    // The episode list is the authority on whether this number exists; the
    // season's `episodeCount` is often wrong for split cours, so it is not
    // consulted here.
    return { rule, episode }
  }
  return null
}

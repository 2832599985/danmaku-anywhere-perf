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
  /**
   * True when the rule's full pattern matched (markers included). False means
   * the match came from the loose tier — the pattern with its literal tail
   * dropped, anchored only on the show name plus the `第 N` position. Both
   * tiers carry the same confidence about the SEASON (the user chose it) and
   * the EPISODE (read out of this file name); the difference is only how much
   * of the surrounding text was verified, so the UI says "宽松" instead of
   * pretending it was an exact hit.
   */
  exact: boolean
}

/** Picker note shown when a rule matched but the season lacks that episode. */
export const REASON_RULE_EPISODE_MISSING = '命名规则命中的集数不在这一季'

/** Digit runs longer than this can never be an episode number. */
const MAX_EPISODE_DIGITS = 4
/** Literal characters the pattern must keep, or it matches far too much. */
const MIN_LITERAL_CHARS = 3
/** How much of the text after the episode stays literal. */
const TAIL_CHARS = 6

/**
 * Characters that may follow the episode number as a STABLE marker: the
 * counter suffix of the naming convention (`第10集` / `第10话`) — Japanese
 * spellings included, since the audio may be Japanese while the file name is
 * not.
 */
const TAIL_MARKERS = new Set([
  '集',
  '话',
  '話',
  '回',
  '章',
  '編',
  '编',
  '期',
  '部',
  '巻',
  '卷',
])

/** CJK ideographs + kana (a run of these is almost always free text). */
const CJK = /[㐀-鿿぀-ヿ]/

/**
 * The literal tail that follows the episode number, or "" when the number is
 * immediately followed by free text.
 *
 * Every character must be a marker or a separator (whitespace, punctuation,
 * brackets). A digit restarts the `\d+` wildcard; a letter or a CJK character
 * that is not a marker ENDS the tail. That stop condition is the fix for the
 * "a rule only ever matches the file it was learned from" bug: taking a fixed
 * number of characters ate the EPISODE TITLE (`第 1 集：欢迎加入…` → tail
 * ` 集：欢迎加`), which changes from episode to episode, so the learned regex
 * could never fire again — and the AI silently answered instead.
 */
const markerTail = (base: string, slotEnd: number): string => {
  let tail = ''
  for (const char of base.slice(slotEnd, slotEnd + TAIL_CHARS)) {
    if (/[0-9A-Za-z]/.test(char)) break
    if (CJK.test(char) && !TAIL_MARKERS.has(char)) break
    tail += char
  }
  return tail
}

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

/**
 * True when the run is really a SEASON number (`第2季`, `Season 2`, `Part 2`),
 * which must never be mistaken for the episode even when the two values
 * coincide — that is the one duplicate that does NOT move with the episode
 * (`第2季 第2集` → next file is `第2季 第3集`).
 */
const isSeasonSlot = (base: string, run: DigitRun): boolean => {
  const after = base.slice(
    run.index + run.text.length,
    run.index + run.text.length + 4
  )
  if (/^\s*(季|部|期|st|nd|rd|th)/i.test(after)) return true
  const before = base.slice(Math.max(0, run.index - 8), run.index)
  return /(season|part)\s*$/i.test(before)
}

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
  // A number can legitimately appear more than once: scraped episode titles
  // repeat it ("第 10 集：第10集 · 稀饭动漫 Next"), and both copies always move
  // together, so either one identifies the episode. The exception is a run that
  // is really a season number (`第2季 第2集`) — that one does NOT move with the
  // episode, so it is dropped from the candidates instead of being captured.
  const candidates = candidateRuns(base).filter(
    (run) => Number(run.text) === episode && !isSeasonSlot(base, run)
  )
  if (candidates.length === 0) return null
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

  // Literal tail: only the naming convention's own markers and separators, so
  // a per-episode title never becomes part of the pattern (see `markerTail`).
  const slotEnd = slot.index + slot.text.length
  const tail = markerTail(base, slotEnd)
  literalChars += tail.length

  // "10" alone would become `^(\d{1,4})$` and match any bare-numbered file
  // anywhere on disk — refuse to learn from names with no other content.
  if (literalChars < MIN_LITERAL_CHARS) return null

  const pattern = `${prefix.join('')}${escapeRegExp(tail)}`
  // Self-check: the pattern must read the picked episode back out of the very
  // file it was built from (numeric compare — the name may zero-pad, "第09集").
  if (Number(new RegExp(pattern, 'i').exec(base)?.[1]) !== episode) return null

  return {
    id: crypto.randomUUID(),
    pattern,
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

/** The single capture group every learned pattern contains. */
const EPISODE_GROUP = '(\\d{1,4})'

/**
 * The same pattern with its literal tail dropped: anchored only on the show
 * name and the `第 N` position. Null when the source is not a learned pattern
 * (no capture group).
 *
 * Needed because a tail can only ever be as stable as the text it was taken
 * from: rules stored by an earlier version may carry part of an EPISODE TITLE
 * (`… 第 (\d{1,4}) 集：欢迎加`), and even a correct tail makes the pattern
 * stricter than it needs to be. The prefix is pure literal text, so dropping
 * the tail cannot make a rule match a different show — `第二季 第 N 集` still
 * fails, because the literal "第二季" is not in the prefix.
 */
export const prefixOnly = (pattern: string): string | null => {
  const index = pattern.indexOf(EPISODE_GROUP)
  if (index < 0) return null
  return pattern.slice(0, index + EPISODE_GROUP.length)
}

/**
 * What makes two rules "the same shape": everything up to and including the
 * episode capture. Two rules of one batch may carry different tails — a rule
 * stored before the marker-tail fix (` 集：欢迎加`) and a freshly learned one
 * (` 集：`) — and they must still count as ONE shape, or the correction path
 * ("pick again and the newest choice wins") breaks: the stale rule would
 * survive as a second entry and outrank the correction on `hits`.
 */
export const ruleShape = (pattern: string): string =>
  prefixOnly(pattern) ?? pattern

/**
 * First learned rule whose pattern matches `filePath`, with the episode number
 * it read out of the name. Corrupt persisted patterns are skipped rather than
 * thrown — this runs on every video open.
 *
 * Two tiers, strict first over ALL rules before the loose tier runs, so a
 * precise match from a lower-ranked rule still wins over a loose one.
 */
export function matchRule(
  rules: FilenameRule[],
  filePath: string,
  folder?: string
): RuleMatch | null {
  if (rules.length === 0) return null
  const base = basenameWithoutExt(filePath)
  const dir = folder ?? dirname(filePath)
  const ordered = orderRules(rules, dir)
  for (const exact of [true, false]) {
    for (const rule of ordered) {
      const source = exact ? rule.pattern : prefixOnly(rule.pattern)
      if (!source) continue
      let matched: RegExpExecArray | null = null
      try {
        matched = new RegExp(source, 'i').exec(base)
      } catch {
        continue // corrupt rule from an older/edited store
      }
      if (!matched) continue
      const episode = Number(matched[1])
      if (!Number.isInteger(episode) || episode <= 0) continue
      // The episode list is the authority on whether this number exists; the
      // season's `episodeCount` is often wrong for split cours, so it is not
      // consulted here.
      return { rule, episode, exact }
    }
  }
  return null
}

/**
 * One-line hint for the picker when this folder HAS learned rules but none of
 * them matched the file that just failed to auto-match. Without it the only
 * conclusion a user can reach is "it never learned anything" — which is
 * exactly what a too-strict pattern looks like from the outside.
 */
export function unmatchedRuleHint(
  rules: FilenameRule[],
  filePath: string
): string | null {
  const dir = dirname(filePath)
  const same = rules.filter((rule) => rule.folder === dir)
  if (same.length === 0) return null
  const newest = same.reduce((a, b) => (b.updatedAt > a.updatedAt ? b : a))
  return `本目录学过命名格式但没匹配上这个文件（规则：${newest.pattern}）`
}

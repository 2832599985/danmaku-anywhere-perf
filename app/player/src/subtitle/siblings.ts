import { extOf, SUBTITLE_EXTENSION_LIST } from '@/platform/types'

/**
 * Subtitle files next to a video, best first.
 *
 * Players pick up more than `<video>.srt`: fansub releases ship their external
 * subtitles as `<video>.sc.ass` / `<video>.tc.ass`, `<video>.chs&jpn.ass`,
 * `<video>.zh-Hans.srt` … A file belongs to the video when its name starts
 * with the video's name and continues with a separator — `ep1.chs.ass` goes
 * with `ep1.mkv`, `ep10.srt` does not.
 *
 * Order: an untagged `<video>.srt` first (the name was made to match — usually
 * by hand), then Simplified Chinese, Simplified bilingual, other Chinese,
 * Traditional, Traditional bilingual, Japanese, anything else. Within one rank
 * the extension order of `SUBTITLE_EXTENSION_LIST` decides.
 */

/** Separators that may follow the video's name in a subtitle file's name. */
const CONTINUES = /[.\s_\-[(（【]/

const token = (words: string) =>
  new RegExp(`(?:^|[^a-z])(?:${words})(?:[^a-z]|$)`)

const SIMPLIFIED = token('chs|sc|gb|gbk|hans|zh-?hans|zh-?cn|zho-?hans|sim')
const TRADITIONAL = token('cht|tc|big5|hant|zh-?hant|zh-?tw|zh-?hk|tra')
const CHINESE = token('zh|chi|zho|chinese|cn')
const JAPANESE = token('jpn|jp|ja|japanese')

/** Rank of the language a tag (the part between name and extension) names. */
export const languageRank = (tag: string): number => {
  if (tag === '') return 0
  const t = tag.toLowerCase()
  const simplified = SIMPLIFIED.test(t) || /简|簡/.test(t)
  const traditional = TRADITIONAL.test(t) || /繁/.test(t)
  const chinese = CHINESE.test(t) || /中/.test(t)
  const japanese = JAPANESE.test(t) || /日/.test(t)
  const bilingual = japanese || /双语|雙語|bilingual/.test(t)
  if (simplified && !traditional) return bilingual ? 2 : 1
  if (simplified && traditional) return 3
  if (traditional) return bilingual ? 5 : 4
  if (chinese) return bilingual ? 2 : 3
  if (japanese) return 6
  return 7
}

const basenameOf = (path: string): string => path.split(/[\\/]/).pop() ?? path

/** The subtitle files among `files` that belong to `videoPath`, best first. */
export const rankSiblingSubtitles = (
  videoPath: string,
  files: readonly string[]
): string[] => {
  const base = basenameOf(videoPath)
    .replace(/\.[^.]+$/, '')
    .toLowerCase()
  if (!base) return []
  const scored: Array<{ file: string; rank: number; ext: number }> = []
  for (const file of files) {
    const name = basenameOf(file)
    const ext = extOf(name)
    const extRank = SUBTITLE_EXTENSION_LIST.indexOf(ext)
    if (extRank < 0) continue
    const stem = name.slice(0, name.length - ext.length - 1).toLowerCase()
    let tag: string
    if (stem === base) {
      tag = ''
    } else if (
      stem.startsWith(base) &&
      CONTINUES.test(stem.charAt(base.length))
    ) {
      tag = stem.slice(base.length)
    } else {
      continue
    }
    scored.push({ file, rank: languageRank(tag), ext: extRank })
  }
  scored.sort(
    (a, b) => a.rank - b.rank || a.ext - b.ext || a.file.localeCompare(b.file)
  )
  return scored.map((entry) => entry.file)
}

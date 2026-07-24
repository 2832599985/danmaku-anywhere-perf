import {
  type CommentEntity,
  zCommentEntity,
  zGenericXml,
} from '@danmaku-anywhere/danmaku-converter'

export type DanmakuFormat = 'bilibili-xml' | 'json'

export interface ParsedDanmaku {
  comments: CommentEntity[]
  format: DanmakuFormat
}

// Reuse the converter's own zod (avoids depending on / duplicating zod here).
const zCommentArray = zCommentEntity.array()

/**
 * Parse a local danmaku file's text into CommentEntity[].
 *
 * Supported (offline, primary source per CONTRACT.md §8):
 *  - Bilibili XML  (`<i><d p="time,mode,color,…">text</d>…</i>`)  → zGenericXml
 *  - JSON: a raw CommentEntity[] (`[{p,m}, …]`), or a wrapper object with a
 *    `comments`/`data` array (e.g. a DanDanPlay comment dump).
 */
export const parseDanmakuText = async (
  text: string,
  _name?: string
): Promise<ParsedDanmaku> => {
  const trimmed = text.trimStart()

  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    let json: unknown
    try {
      json = JSON.parse(text)
    } catch (error) {
      throw new Error(`Invalid JSON danmaku file: ${(error as Error).message}`)
    }
    const arr = extractCommentArray(json)
    if (!arr) {
      throw new Error(
        'Unrecognized JSON danmaku format (expected an array of {p,m} or a {comments:[…]} object).'
      )
    }
    const comments = zCommentArray.parse(arr)
    if (comments.length === 0) {
      throw new Error('The JSON danmaku file contains no comments.')
    }
    return { comments, format: 'json' }
  }

  // Fall back to bilibili XML.
  const comments = await zGenericXml.parseAsync(text)
  if (comments.length === 0) {
    throw new Error('The XML danmaku file contains no comments.')
  }
  return { comments, format: 'bilibili-xml' }
}

const extractCommentArray = (json: unknown): unknown[] | null => {
  if (Array.isArray(json)) return json
  if (json && typeof json === 'object') {
    const record = json as Record<string, unknown>
    if (Array.isArray(record.comments)) return record.comments
    if (Array.isArray(record.data)) return record.data
  }
  return null
}

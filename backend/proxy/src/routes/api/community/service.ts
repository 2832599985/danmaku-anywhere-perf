import { and, eq } from 'drizzle-orm'
import type { Database } from '@/db'
import { communityComment } from '@/db/schema/community'

export interface AddCommentData {
  userId: string
  animeTitle: string
  episodeKey: string
  time: number
  mode: number
  color: number
  content: string
}

export async function getComments(
  db: Database,
  animeTitle: string,
  episodeKey: string
) {
  return db.query.communityComment.findMany({
    where: and(
      eq(communityComment.animeTitle, animeTitle),
      eq(communityComment.episodeKey, episodeKey)
    ),
  })
}

export async function addComment(db: Database, data: AddCommentData) {
  const id = crypto.randomUUID()
  const createdAt = new Date().toISOString()

  await db.insert(communityComment).values({
    id,
    userId: data.userId,
    animeTitle: data.animeTitle,
    episodeKey: data.episodeKey,
    time: data.time,
    mode: data.mode,
    color: data.color,
    content: data.content,
    createdAt,
  })

  return { id }
}

export async function deleteComment(
  db: Database,
  commentId: string,
  userId: string
) {
  const comment = await db.query.communityComment.findFirst({
    where: eq(communityComment.id, commentId),
  })

  if (!comment) {
    return { found: false, deleted: false }
  }

  if (comment.userId !== userId) {
    return { found: true, deleted: false }
  }

  await db.delete(communityComment).where(eq(communityComment.id, commentId))

  return { found: true, deleted: true }
}

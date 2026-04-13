import { relations } from 'drizzle-orm'
import {
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core'
import { user } from './auth'

export const communityComment = sqliteTable(
  'community_comment',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text('user_id')
      .notNull()
      .references(() => user.id),
    animeTitle: text('anime_title').notNull(),
    episodeKey: text('episode_key').notNull(),
    time: real('time').notNull(),
    mode: integer('mode').notNull().default(1),
    color: integer('color').notNull().default(16777215),
    content: text('content').notNull(),
    createdAt: text('created_at')
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  (table) => [
    uniqueIndex('idx_community_dedup').on(
      table.userId,
      table.animeTitle,
      table.episodeKey,
      table.time,
      table.content
    ),
    index('idx_community_lookup').on(table.animeTitle, table.episodeKey),
  ]
)

export const communityCommentRelations = relations(
  communityComment,
  ({ one }) => ({
    user: one(user, {
      fields: [communityComment.userId],
      references: [user.id],
    }),
  })
)

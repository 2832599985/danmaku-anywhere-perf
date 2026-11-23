import { z } from 'zod'

export const getCommentsQuerySchema = z.object({
  title: z.string().min(1).trim(),
  episode: z.string().min(1).trim(),
})

export const addCommentBodySchema = z.object({
  animeTitle: z.string().min(1).trim(),
  episodeKey: z.string().min(1).trim(),
  time: z.number().min(0),
  mode: z.number().int().min(1).max(3).default(1),
  color: z.number().int().min(0).max(16777215).default(16777215),
  content: z.string().min(1).max(500).trim(),
})

export const commentResponseSchema = z.object({
  id: z.string(),
  userId: z.string(),
  animeTitle: z.string(),
  episodeKey: z.string(),
  time: z.number(),
  mode: z.number(),
  color: z.number(),
  content: z.string(),
  createdAt: z.string(),
})

export const getCommentsResponseSchema = z.object({
  success: z.boolean(),
  data: z.array(commentResponseSchema),
})

export const addCommentResponseSchema = z.object({
  success: z.boolean(),
  id: z.string(),
})

export const deleteCommentResponseSchema = z.object({
  success: z.boolean(),
})

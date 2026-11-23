/** Extract a human-readable message from an unknown thrown value. */
export const errorMessage = (e: unknown): string => {
  if (e instanceof Error) return e.message
  if (typeof e === 'string') return e
  try {
    return String(e)
  } catch {
    return '未知错误 / Unknown error'
  }
}

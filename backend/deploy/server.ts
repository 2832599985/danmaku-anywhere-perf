import { timingSafeEqual } from 'node:crypto'
import { createServer } from 'node:http'
import { GoogleGenerativeAI } from '@google/generative-ai'
import Database from 'better-sqlite3'
import { type Context, Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { WebSocketServer } from 'ws'

// ===== Database Setup =====
const DB_PATH = process.env.DB_PATH ?? '/data/danmaku.db'
const db = new Database(DB_PATH)
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

db.exec(`
  CREATE TABLE IF NOT EXISTS community_comment (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL DEFAULT 'anonymous',
    anime_title TEXT NOT NULL,
    episode_key TEXT NOT NULL,
    time REAL NOT NULL,
    mode INTEGER NOT NULL DEFAULT 1,
    color INTEGER NOT NULL DEFAULT 16777215,
    content TEXT NOT NULL,
    delete_token TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(user_id, anime_title, episode_key, time, content)
  );
  CREATE INDEX IF NOT EXISTS idx_community_lookup ON community_comment(anime_title, episode_key);

  CREATE TABLE IF NOT EXISTS translation_cache (
    content_hash TEXT PRIMARY KEY,
    target_lang TEXT NOT NULL,
    translation TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`)

// Backward-compatible migration for pre-existing databases created before delete_token existed.
try {
  db.exec('ALTER TABLE community_comment ADD COLUMN delete_token TEXT')
} catch {
  // Column already exists
}

const safeTokenEquals = (a: string, b: string): boolean => {
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  if (bufA.length !== bufB.length) return false
  return timingSafeEqual(bufA, bufB)
}

const extractRequestToken = (c: Context): string | null => {
  const headerToken = c.req.header('X-Delete-Token')?.trim()
  if (headerToken) return headerToken
  const auth = c.req.header('Authorization')?.trim()
  if (auth?.toLowerCase().startsWith('bearer ')) {
    return auth.slice(7).trim() || null
  }
  return null
}

// ===== Hono App =====
const app = new Hono()

app.use(
  '*',
  cors({
    origin: '*',
    allowMethods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization', 'X-Delete-Token'],
  })
)
app.use('*', logger())

// Health check
app.get('/health', (c) =>
  c.json({ status: 'ok', time: new Date().toISOString() })
)

// ===== Community Danmaku API =====
app.get('/api/community/comments', (c) => {
  const title = c.req.query('title')
  const episode = c.req.query('episode')
  if (!title || !episode) {
    return c.json({ success: false, message: 'Missing title or episode' }, 400)
  }
  const rows = db
    .prepare(
      `SELECT id, user_id, anime_title, episode_key, time, mode, color, content, created_at
       FROM community_comment
       WHERE anime_title = ? AND episode_key = ?
       ORDER BY time ASC`
    )
    .all(title, episode)
  return c.json({ success: true, data: rows })
})

app.post('/api/community/comment', async (c) => {
  let body: Record<string, unknown>
  try {
    body = (await c.req.json()) as Record<string, unknown>
  } catch {
    return c.json({ success: false, message: 'Invalid JSON body' }, 400)
  }
  const { animeTitle, episodeKey, time, mode, color, content, userId } = body
  if (
    typeof animeTitle !== 'string' ||
    !animeTitle ||
    typeof episodeKey !== 'string' ||
    !episodeKey ||
    typeof time !== 'number' ||
    !Number.isFinite(time) ||
    typeof content !== 'string' ||
    !content
  ) {
    return c.json({ success: false, message: 'Missing required fields' }, 400)
  }
  const id = crypto.randomUUID()
  const deleteToken = crypto.randomUUID()
  try {
    db.prepare(`
      INSERT INTO community_comment (id, user_id, anime_title, episode_key, time, mode, color, content, delete_token)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      typeof userId === 'string' && userId ? userId : 'anonymous',
      animeTitle,
      episodeKey,
      time,
      typeof mode === 'number' ? mode : 1,
      typeof color === 'number' ? color : 16777215,
      content,
      deleteToken
    )
    return c.json({ success: true, id, deleteToken }, 201)
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error'
    if (msg.includes('UNIQUE constraint')) {
      return c.json({ success: false, message: 'Duplicate comment' }, 409)
    }
    return c.json({ success: false, message: msg }, 500)
  }
})

const ADMIN_API_KEY = process.env.ADMIN_API_KEY ?? ''

app.delete('/api/community/comment/:id', (c) => {
  const id = c.req.param('id')
  const token = extractRequestToken(c)
  if (!token) {
    return c.json({ success: false, message: 'Missing delete token' }, 401)
  }

  const row = db
    .prepare('SELECT delete_token FROM community_comment WHERE id = ?')
    .get(id) as { delete_token: string | null } | undefined
  if (!row) {
    return c.json({ success: false, message: 'Not found' }, 404)
  }

  const isAdmin =
    Boolean(ADMIN_API_KEY) && safeTokenEquals(token, ADMIN_API_KEY)
  const isAuthor =
    Boolean(row.delete_token) &&
    safeTokenEquals(token, row.delete_token as string)
  if (!isAdmin && !isAuthor) {
    return c.json({ success: false, message: 'Forbidden' }, 403)
  }

  db.prepare('DELETE FROM community_comment WHERE id = ?').run(id)
  return c.json({ success: true })
})

// ===== Translation API =====
const GEMINI_API_KEY = process.env.GEMINI_API_KEY ?? ''

app.post('/api/translate/v1/batch', async (c) => {
  if (!GEMINI_API_KEY) {
    return c.json(
      { success: false, message: 'GEMINI_API_KEY not configured' },
      503
    )
  }
  let body: Record<string, unknown>
  try {
    body = (await c.req.json()) as Record<string, unknown>
  } catch {
    return c.json({ success: false, message: 'Invalid JSON body' }, 400)
  }
  const { texts, targetLang } = body
  if (
    !Array.isArray(texts) ||
    !texts.every((item): item is string => typeof item === 'string') ||
    typeof targetLang !== 'string' ||
    !targetLang
  ) {
    return c.json({ success: false, message: 'Invalid request' }, 400)
  }
  if (texts.length > 100) {
    return c.json({ success: false, message: 'Max 100 texts per batch' }, 400)
  }

  // Check cache
  const cached: (string | null)[] = texts.map((text: string) => {
    const hash = `${targetLang}:${text}`
    const row = db
      .prepare(
        'SELECT translation FROM translation_cache WHERE content_hash = ? AND target_lang = ?'
      )
      .get(hash, targetLang) as { translation: string } | undefined
    return row?.translation ?? null
  })

  const missIndices: number[] = []
  const missTexts: string[] = []
  for (let i = 0; i < cached.length; i++) {
    if (cached[i] === null) {
      missIndices.push(i)
      missTexts.push(texts[i])
    }
  }

  if (missTexts.length > 0) {
    try {
      const langMap: Record<string, string> = {
        en: 'English',
        ja: 'Japanese',
        zh: 'Chinese (Simplified)',
        ko: 'Korean',
      }
      const genAI = new GoogleGenerativeAI(GEMINI_API_KEY)
      const model = genAI.getGenerativeModel({
        model: process.env.GEMINI_MODEL ?? 'gemini-2.0-flash-lite',
      })
      const prompt = `Translate the following ${missTexts.length} danmaku comments to ${langMap[targetLang] ?? targetLang}. Return ONLY a JSON array of translated strings, same order as input. Keep tone, emojis, slang.\n${JSON.stringify(missTexts)}`
      const result = await model.generateContent(prompt)
      const responseText = result.response.text()
      const jsonMatch = responseText.match(/\[[\s\S]*\]/)
      if (jsonMatch) {
        const parsed: unknown = JSON.parse(jsonMatch[0])
        // Only persist to SQLite cache when the array matches 1-to-1 with input
        // length so merged/truncated model outputs never poison cached entries.
        if (
          Array.isArray(parsed) &&
          parsed.length === missTexts.length &&
          parsed.every((item): item is string => typeof item === 'string')
        ) {
          const insertStmt = db.prepare(
            'INSERT OR REPLACE INTO translation_cache (content_hash, target_lang, translation) VALUES (?, ?, ?)'
          )
          for (let i = 0; i < missIndices.length; i++) {
            cached[missIndices[i]] = parsed[i]
            const hash = `${targetLang}:${missTexts[i]}`
            insertStmt.run(hash, targetLang, parsed[i])
          }
        }
      }
    } catch (e: unknown) {
      console.error('Translation error:', e)
    }
  }

  // Guarantee a dense `string[]` (never leaking `null` elements on partial or
  // malformed model outputs).
  const finalTranslations: string[] = cached.map(
    (value, idx) => value ?? texts[idx]
  )

  return c.json({ success: true, translations: finalTranslations })
})

// ===== WebSocket Watch Party =====
interface Room {
  id: string
  host: string
  animeTitle: string
  episode: string
  clients: Map<WebSocket, { userId: string; userName: string }>
}

const rooms = new Map<string, Room>()

app.post('/api/rooms/create', async (c) => {
  let body: Record<string, unknown>
  try {
    body = (await c.req.json()) as Record<string, unknown>
  } catch {
    return c.json({ success: false, message: 'Invalid JSON body' }, 400)
  }
  const roomId = crypto.randomUUID().slice(0, 8)
  rooms.set(roomId, {
    id: roomId,
    host: typeof body.userId === 'string' ? body.userId : 'host',
    animeTitle: typeof body.animeTitle === 'string' ? body.animeTitle : '',
    episode: typeof body.episode === 'string' ? body.episode : '',
    clients: new Map(),
  })
  return c.json({ success: true, roomId })
})

app.get('/api/rooms/:id', (c) => {
  const room = rooms.get(c.req.param('id'))
  if (!room) return c.json({ success: false, message: 'Room not found' }, 404)
  return c.json({
    success: true,
    roomId: room.id,
    host: room.host,
    animeTitle: room.animeTitle,
    episode: room.episode,
    memberCount: room.clients.size,
  })
})

// ===== Start Server =====
const PORT = Number(process.env.PORT ?? 3001)

const nodeServer = createServer((req, res) => {
  const request = new Request(`http://localhost:${PORT}${req.url}`, {
    method: req.method,
    headers: Object.fromEntries(
      Object.entries(req.headers)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => [k, Array.isArray(v) ? v.join(', ') : (v as string)])
    ),
    body: req.method !== 'GET' && req.method !== 'HEAD' ? req : undefined,
    duplex: 'half',
  } as RequestInit)

  void app
    .fetch(request)
    .then((response) => {
      res.writeHead(
        response.status,
        Object.fromEntries(response.headers.entries())
      )
      if (response.body) {
        const reader = response.body.getReader()
        const pump = (): void => {
          reader
            .read()
            .then(({ done, value }) => {
              if (done) {
                res.end()
                return
              }
              res.write(value)
              pump()
            })
            .catch(() => {
              res.destroy()
            })
        }
        pump()
      } else {
        res.end()
      }
    })
    .catch((err: unknown) => {
      console.error('Unhandled request error:', err)
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' })
      }
      res.end(JSON.stringify({ success: false, message: 'Internal error' }))
    })
})

// WebSocket server on the same HTTP server
const wss = new WebSocketServer({ server: nodeServer })

wss.on('connection', (ws, req) => {
  const url = new URL(req.url ?? '', `http://localhost:${PORT}`)
  const roomId = url.pathname.match(/\/api\/rooms\/([^/]+)\/ws/)?.[1]
  const userId = url.searchParams.get('userId') ?? 'anonymous'
  const userName = url.searchParams.get('userName') ?? 'Anonymous'

  const room = roomId ? rooms.get(roomId) : undefined
  if (!roomId || !room) {
    ws.close(4004, 'Room not found')
    return
  }
  room.clients.set(ws as never, { userId, userName })

  // Broadcast join
  broadcast(room, { type: 'join', userId, userName }, ws as never)
  console.log(
    `[Room ${roomId}] ${userName} joined (${room.clients.size} members)`
  )

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString())
      broadcast(room, msg, ws as never)
    } catch {
      /* ignore malformed */
    }
  })

  ws.on('close', () => {
    room.clients.delete(ws as never)
    broadcast(room, { type: 'leave', userId, userName }, ws as never)
    console.log(
      `[Room ${roomId}] ${userName} left (${room.clients.size} members)`
    )
    // Clean up empty rooms after 5 minutes
    if (room.clients.size === 0) {
      setTimeout(
        () => {
          if (rooms.get(roomId)?.clients.size === 0) {
            rooms.delete(roomId)
            console.log(`[Room ${roomId}] cleaned up`)
          }
        },
        5 * 60 * 1000
      )
    }
  })
})

function broadcast(room: Room, msg: unknown, exclude?: WebSocket) {
  const payload = JSON.stringify(msg)
  for (const [client] of room.clients) {
    if (
      client !== exclude &&
      (client as { readyState: number }).readyState === 1
    ) {
      ;(client as { send: (d: string) => void }).send(payload)
    }
  }
}

nodeServer.listen(PORT, '0.0.0.0', () => {
  console.log(`Danmaku Community Server running on http://0.0.0.0:${PORT}`)
})

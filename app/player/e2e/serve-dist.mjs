// Minimal correct static server for the built dist/ (Playwright e2e).
// Vite's `preview` returns HTTP 204 for .bin files, which starves the Framegen
// weights fetch; the real Tauri app serves frontendDist via its own asset
// server, so this mirrors that (full bytes, correct mime, range support).
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../dist/', import.meta.url))
const PORT = 3060
const MIME = {
  '.html': 'text/html;charset=utf-8',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.bin': 'application/octet-stream',
  '.wasm': 'application/wasm',
  '.mp4': 'video/mp4',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.map': 'application/json',
  '.ico': 'image/x-icon',
}

const server = createServer(async (req, res) => {
  try {
    let path = decodeURIComponent(new URL(req.url, 'http://x').pathname)
    if (path === '/') path = '/index.html'
    let file = normalize(join(root, path))
    if (!file.startsWith(root)) {
      res.writeHead(403).end()
      return
    }
    let st
    try {
      st = await stat(file)
      if (st.isDirectory()) {
        file = join(file, 'index.html')
        st = await stat(file)
      }
    } catch {
      // SPA fallback
      file = join(root, 'index.html')
      st = await stat(file)
    }
    const type = MIME[extname(file).toLowerCase()] || 'application/octet-stream'
    const range = req.headers.range
    if (range) {
      const m = /bytes=(\d*)-(\d*)/.exec(range) ?? []
      let start = m[1] ? Number.parseInt(m[1], 10) : 0
      let end = m[2] ? Number.parseInt(m[2], 10) : st.size - 1
      if (Number.isNaN(start)) start = 0
      if (Number.isNaN(end) || end >= st.size) end = st.size - 1
      res.writeHead(206, {
        'Content-Type': type,
        'Content-Range': `bytes ${start}-${end}/${st.size}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': end - start + 1,
        'Access-Control-Allow-Origin': '*',
        'X-Served-By': 'serve-dist',
      })
      createReadStream(file, { start, end }).pipe(res)
    } else {
      res.writeHead(200, {
        'Content-Type': type,
        'Content-Length': st.size,
        'Accept-Ranges': 'bytes',
        'Access-Control-Allow-Origin': '*',
        'X-Served-By': 'serve-dist',
      })
      createReadStream(file).pipe(res)
    }
  } catch (error) {
    res.writeHead(500).end(String(error))
  }
})

server.listen(PORT, () => {
  console.log(`[serve-dist] http://localhost:${PORT} → ${root}`)
})

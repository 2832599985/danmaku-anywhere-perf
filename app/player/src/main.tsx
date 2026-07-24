import { CssBaseline, ThemeProvider } from '@mui/material'
import { createRoot } from 'react-dom/client'
import { initPlatform } from '@/platform'
import { theme } from '@/theme/theme'
import { App } from './App'

const container = document.getElementById('root')
if (!container) throw new Error('#root not found')

// Resolve the platform adapter (Tauri vs browser) and run its async init
// (the Tauri build bridges fetch for CORS-blocked hosts) before first render.
// Note: no <StrictMode> — the imperative WebGPU/danmaku controllers must not be
// double-mounted in development.
// A bootstrap failure must never be a silent black screen — paint the error.
const showFatal = (error: unknown) => {
  const pre = document.createElement('pre')
  pre.style.cssText =
    'color:#f87171;padding:16px;white-space:pre-wrap;font:12px/1.6 monospace'
  const detail =
    error instanceof Error ? (error.stack ?? error.message) : String(error)
  pre.textContent = `启动失败 / Failed to start\n${detail}`
  container.appendChild(pre)
}

initPlatform()
  .then((platform) => {
    createRoot(container).render(
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <App platform={platform} />
      </ThemeProvider>
    )
  })
  .catch(showFatal)

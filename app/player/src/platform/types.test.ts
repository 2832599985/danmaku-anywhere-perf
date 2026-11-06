import { describe, expect, it } from 'vitest'
import { extOf, joinPath, REMUX_EXTENSIONS } from './types'

describe('joinPath', () => {
  it('appends a listed entry to its directory', () => {
    expect(joinPath('C:\\Users\\x\\Videos', 'a.mp4')).toBe(
      'C:\\Users\\x\\Videos\\a.mp4'
    )
  })

  it('does not double a trailing separator', () => {
    expect(joinPath('C:\\Users\\x\\Videos\\', 'a.mp4')).toBe(
      'C:\\Users\\x\\Videos\\a.mp4'
    )
  })

  it('keeps the file name intact', () => {
    // Regression guard: written inline as `` `${dir}\${name}` `` the `\$` is an
    // escape, so the result was the same literal `${...}` text for EVERY entry
    // — which made the sibling-episode scan find nothing, ever.
    const path = joinPath('D:\\片子', '第 7 集：第07集.mp4')
    expect(path.endsWith('\\第 7 集：第07集.mp4')).toBe(true)
    expect(path).not.toContain('${')
  })
})

describe('extOf', () => {
  it('lower-cases the extension and tolerates its absence', () => {
    expect(extOf('A.MP4')).toBe('mp4')
    expect(extOf('no-extension')).toBe('no-extension')
  })
})

describe('REMUX_EXTENSIONS', () => {
  it('covers exactly the containers WebView2 cannot demux', () => {
    // Measured against a real <video> element: MP4/MOV/WebM/MKV open, these
    // three fail with `FFmpegDemuxer: open context failed`. Adding an entry
    // here means "run ffmpeg -c copy first" — see src-tauri/src/remux.rs.
    expect([...REMUX_EXTENSIONS].sort()).toEqual(['avi', 'flv', 'ts'])
    for (const ext of ['mp4', 'mkv', 'webm', 'mov', 'ogv']) {
      expect(REMUX_EXTENSIONS.has(ext)).toBe(false)
    }
  })
})

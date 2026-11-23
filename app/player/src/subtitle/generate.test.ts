import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { usePlayerStore } from '@/store/playerStore'
import {
  __test,
  type Backend,
  bindGenerationPlayer,
  onUserSeek,
  resetGeneration,
  skipBurst,
  startGeneration,
} from './generate'
import type { RecognizedCue, TranscribeEvent } from './native'

const store = () => usePlayerStore.getState()

interface AsrCall {
  from: number
  to: number
  gpu: boolean
  emit: (event: TranscribeEvent) => void
}

/** A scriptable backend: recognition is driven by the test, translation answers by itself. */
const fakeBackend = (opts: { freeMb?: number | null; cuda?: boolean } = {}) => {
  const asr: AsrCall[] = []
  const mt: Array<{ lines: string[]; gpu: boolean }> = []
  const releases: boolean[] = []
  let cancels = 0
  const backend: Backend = {
    transcribe: async (_path, from, to, options, onEvent) => {
      asr.push({ from, to, gpu: options.gpu, emit: onEvent })
      onEvent({ type: 'started', gpu: options.gpu })
    },
    cancelTranscribe: async () => {
      cancels += 1
      const run = asr[asr.length - 1]
      run?.emit({ type: 'cancelled' })
    },
    translateBatch: async (lines, gpu) => {
      mt.push({ lines, gpu })
      return { lines: lines.map((l) => `中:${l}`), gpu }
    },
    releaseEngines: async (gpuOnly) => {
      releases.push(gpuOnly)
    },
    gpuInfo: async () => ({
      freeMb: opts.freeMb === undefined ? 3100 : opts.freeMb,
      asrGpu: null,
      mtGpu: null,
    }),
    assets: async () => ({
      dataDir: 'D:\\DanmakuPlayerData',
      defaultDir: 'D:\\DanmakuPlayerData',
      freeBytes: 1e12,
      assets: [
        'whisper-turbo-q5',
        'murasaki-4b',
        'whisper-cpu',
        'llama',
        'whisper-cuda',
      ].map((id) => ({
        id,
        label: id,
        installed: id !== 'whisper-cuda' || opts.cuda !== false,
        optional: id === 'whisper-cuda',
        bytes: 1,
        partialBytes: 0,
      })),
    }),
    loadCache: async () => null,
    saveCache: async () => undefined,
    log: () => undefined,
  }
  return { backend, asr, mt, releases, cancels: () => cancels }
}

/** Japanese lines every 4 s over [from, to). */
const speech = (from: number, to: number): RecognizedCue[] => {
  const out: RecognizedCue[] = []
  for (let t = from + 1; t < to; t += 4) {
    out.push({ start: t, end: t + 3, text: `台詞${Math.round(t)}` })
  }
  return out
}

const player = {
  play: vi.fn(() =>
    usePlayerStore.setState((s) => void (s.playback.playing = true))
  ),
  pause: vi.fn(() =>
    usePlayerStore.setState((s) => void (s.playback.playing = false))
  ),
}

const openVideo = (path: string, at: number, playing: boolean) => {
  store().setMedia({ url: `stream://${path}`, name: path, path })
  usePlayerStore.setState((s) => {
    s.playback.currentTime = at
    s.playback.duration = 1400
    s.playback.playing = playing
  })
}

/** Let promises and the throttled timers settle. */
const settle = async () => {
  for (let i = 0; i < 20; i += 1) await vi.advanceTimersByTimeAsync(300)
}

beforeEach(() => {
  vi.useFakeTimers()
  __test.reset()
  player.play.mockClear()
  player.pause.mockClear()
  bindGenerationPlayer(player)
  store().updateSubtitleSettings({
    aiGpu: true,
    aiDisplay: 'dual',
    visible: true,
  })
})

afterEach(() => {
  __test.setBackend(null)
  __test.reset()
  vi.useRealTimers()
})

describe('burst: auto-pause → GPU → auto-resume', () => {
  it('pauses, recognizes 5 min on the GPU, hands the GPU over, translates, resumes', async () => {
    const fake = fakeBackend()
    __test.setBackend(fake.backend)
    openVideo('D:\\v\\ep1.mkv', 100, true)

    await startGeneration()
    expect(player.pause).toHaveBeenCalledTimes(1)
    expect(fake.asr).toHaveLength(1)
    expect(fake.asr[0]).toMatchObject({ from: 100, to: 400, gpu: true })
    expect(store().aiGen).toMatchObject({
      phase: 'burst',
      stage: 'recognizing',
    })

    // translation must wait for the GPU recognizer to finish
    fake.asr[0].emit({ type: 'clip', cues: speech(100, 218), coveredTo: 218 })
    await settle()
    expect(fake.mt).toHaveLength(0)

    fake.asr[0].emit({ type: 'clip', cues: speech(218, 400), coveredTo: 400 })
    fake.asr[0].emit({ type: 'done', coveredTo: 400, language: 'japanese' })
    await settle()

    // the recognizer's VRAM was released before the translator started
    expect(fake.releases[0]).toBe(true)
    expect(fake.mt.length).toBeGreaterThan(0)
    // the burst translates on the GPU; follow (after it) only on the CPU
    const firstCpu = fake.mt.findIndex((call) => !call.gpu)
    expect(fake.mt[0].gpu).toBe(true)
    expect(
      fake.mt
        .slice(firstCpu < 0 ? fake.mt.length : firstCpu)
        .every((c) => !c.gpu)
    ).toBe(true)
    // burst over: resumed, follow phase, Chinese on screen
    expect(player.play).toHaveBeenCalledTimes(1)
    expect(store().aiGen?.phase).toBe('follow')
    const cues = store().subtitleCues
    expect(cues.some((c) => c.text === '中:台詞101')).toBe(true)
    expect(cues.some((c) => c.text === '台詞101' && (c.scale ?? 1) < 1)).toBe(
      true
    )
    // follow continues on the CPU only
    const afterBurst = fake.mt.length
    usePlayerStore.setState((s) => void (s.playback.currentTime = 150))
    await settle()
    expect(fake.mt.slice(afterBurst).every((call) => !call.gpu)).toBe(true)
  })

  it('does not resume a video that was paused to begin with', async () => {
    const fake = fakeBackend()
    __test.setBackend(fake.backend)
    openVideo('D:\\v\\ep1.mkv', 0, false)
    await startGeneration()
    expect(player.pause).not.toHaveBeenCalled()
    fake.asr[0].emit({ type: 'clip', cues: speech(0, 300), coveredTo: 300 })
    fake.asr[0].emit({ type: 'done', coveredTo: 300, language: null })
    await settle()
    expect(store().aiGen?.phase).toBe('follow')
    expect(player.play).not.toHaveBeenCalled()
  })

  it('pressing play during the burst ends it and frees the GPU at once', async () => {
    const fake = fakeBackend()
    __test.setBackend(fake.backend)
    openVideo('D:\\v\\ep1.mkv', 100, true)
    await startGeneration()
    await settle()
    expect(store().aiGen?.phase).toBe('burst')
    const releasesBefore = fake.releases.length

    usePlayerStore.setState((s) => void (s.playback.playing = true)) // the user
    await settle()
    expect(store().aiGen?.phase).toBe('follow')
    expect(fake.cancels()).toBeGreaterThan(0) // GPU recognizer stopped
    expect(fake.releases.length).toBeGreaterThan(releasesBefore)
    expect(player.play).not.toHaveBeenCalled() // we do not play on top of the user
  })

  it('直接播放 skips the rest of the burst and resumes', async () => {
    const fake = fakeBackend()
    __test.setBackend(fake.backend)
    openVideo('D:\\v\\ep1.mkv', 100, true)
    await startGeneration()
    skipBurst()
    await settle()
    expect(store().aiGen?.phase).toBe('follow')
    expect(player.play).toHaveBeenCalledTimes(1)
  })

  it('low VRAM keeps both engines on the CPU (shorter burst)', async () => {
    const fake = fakeBackend({ freeMb: 900 })
    __test.setBackend(fake.backend)
    openVideo('D:\\v\\ep1.mkv', 100, true)
    await startGeneration()
    expect(fake.asr[0]).toMatchObject({ from: 100, to: 160, gpu: false })
    fake.asr[0].emit({ type: 'clip', cues: speech(100, 160), coveredTo: 160 })
    fake.asr[0].emit({ type: 'done', coveredTo: 160, language: null })
    await settle()
    expect(fake.mt.length).toBeGreaterThan(0)
    expect(fake.mt.every((call) => !call.gpu)).toBe(true)
  })

  it('without the CUDA package recognition runs on the CPU, translation still on the GPU', async () => {
    const fake = fakeBackend({ cuda: false })
    __test.setBackend(fake.backend)
    openVideo('D:\\v\\ep1.mkv', 100, true)
    await startGeneration()
    expect(fake.asr[0].gpu).toBe(false)
    fake.asr[0].emit({ type: 'clip', cues: speech(100, 160), coveredTo: 160 })
    fake.asr[0].emit({ type: 'done', coveredTo: 160, language: null })
    await settle()
    expect(fake.mt[0].gpu).toBe(true)
  })

  it('GPU off in settings: everything on the CPU', async () => {
    const fake = fakeBackend()
    __test.setBackend(fake.backend)
    store().updateSubtitleSettings({ aiGpu: false })
    openVideo('D:\\v\\ep1.mkv', 100, true)
    await startGeneration()
    expect(fake.asr[0].gpu).toBe(false)
  })
})

describe('follow and seeks', () => {
  const startAndFinishBurst = async (fake: ReturnType<typeof fakeBackend>) => {
    openVideo('D:\\v\\ep1.mkv', 100, true)
    await startGeneration()
    fake.asr[0].emit({ type: 'clip', cues: speech(100, 400), coveredTo: 400 })
    fake.asr[0].emit({ type: 'done', coveredTo: 400, language: null })
    await settle()
  }

  it('a seek into unrecognized audio starts another burst there', async () => {
    const fake = fakeBackend()
    __test.setBackend(fake.backend)
    await startAndFinishBurst(fake)
    player.pause.mockClear()

    usePlayerStore.setState((s) => void (s.playback.currentTime = 900))
    onUserSeek(900)
    await settle()
    expect(store().aiGen?.phase).toBe('burst')
    expect(player.pause).toHaveBeenCalledTimes(1)
    const run = fake.asr[fake.asr.length - 1]
    expect(run).toMatchObject({ from: 900, gpu: true })
  })

  it('a seek inside recognized audio does not pause', async () => {
    const fake = fakeBackend()
    __test.setBackend(fake.backend)
    await startAndFinishBurst(fake)
    player.pause.mockClear()
    usePlayerStore.setState((s) => void (s.playback.currentTime = 300))
    onUserSeek(300)
    await settle()
    expect(store().aiGen?.phase).toBe('follow')
    expect(player.pause).not.toHaveBeenCalled()
  })

  it('follow recognizes ahead on the CPU when the lead runs low', async () => {
    const fake = fakeBackend()
    __test.setBackend(fake.backend)
    await startAndFinishBurst(fake)
    usePlayerStore.setState((s) => void (s.playback.currentTime = 300))
    await settle()
    const run = fake.asr[fake.asr.length - 1]
    expect(run).toMatchObject({ from: 400, to: 640, gpu: false })
  })
})

describe('media switch', () => {
  it('results for the old video never reach the new one', async () => {
    const fake = fakeBackend()
    __test.setBackend(fake.backend)
    openVideo('D:\\v\\ep1.mkv', 100, true)
    await startGeneration()
    const oldRun = fake.asr[0]

    resetGeneration()
    openVideo('D:\\v\\ep2.mkv', 0, true)
    await settle()
    oldRun.emit({ type: 'clip', cues: speech(100, 200), coveredTo: 200 })
    await settle()
    expect(store().subtitleCues).toHaveLength(0)
    expect(store().aiGen).toBeNull()
    // and every engine was released (not just the GPU ones)
    expect(fake.releases).toContain(false)
  })
})

import { bench, describe } from 'vitest'
import type { CommentEntity } from './types.js'
import * as utils from './utils.js'

// Import from source to benchmark the current implementation without requiring a build.
import {
  transformComment,
  type ParsedComment,
} from '../../../../danmaku-engine/src/parser'

const SIZES = [1_000, 10_000, 100_000] as const

const TIME_CLUSTER_BINS = 100
const NEAR_SORTED_SWAP_RATE = 0.01
const INVALID_P_RATE = 0.01

type TimeScenarioName =
  | 'random'
  | 'random_invalid1%'
  | 'sorted'
  | 'nearSorted1%'
  | 'reverse'
  | 'clustered100'

type PayloadScenarioName =
  | 'base'
  | 'uidCommaHeavy64'
  | 'uidCommaHeavy256'
  | 'textShort8'
  | 'textLong256'
  | 'textVeryLong1024'
  | 'gradient50%'
  | 'gradient100%'
  | 'worstCase'

type EpisodeCount = 1 | 10 | 100

type TimeDataset = {
  name: TimeScenarioName
  comments: CommentEntity[]
}

type PayloadDataset = {
  name: PayloadScenarioName
  comments: CommentEntity[]
}

type SizeDatasets = {
  size: number
  time: Record<TimeScenarioName, CommentEntity[]>
  payload: Record<PayloadScenarioName, CommentEntity[]>
  episodes: Record<EpisodeCount, CommentEntity[][]>
}

const mulberry32 = (seed: number) => {
  let t = seed >>> 0
  return () => {
    t += 0x6d2b79f5
    let x = Math.imul(t ^ (t >>> 15), 1 | t)
    x ^= x + Math.imul(x ^ (x >>> 7), 61 | x)
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296
  }
}

const repeat = (c: string, len: number) => {
  if (len <= 0) return ''
  return c.repeat(len)
}

const gradientS = '16711680~65280,0'

const legacyParseTime = (p: string): number => {
  const parts = p.split(',')
  return Number.parseFloat(parts[0])
}

// Baseline commit (f3aceaf5) does not export parseCommentEntityTime.
const parseTime: (p: string) => number =
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (utils as any).parseCommentEntityTime ?? legacyParseTime

const makeP = (time: number, uid: string) => {
  // p format: time,mode,color,uid
  // mode=1 (rtl), color=16777215 (white)
  return `${time.toFixed(2)},1,16777215,${uid}`
}

const makeInvalidP = (i: number) => {
  // Missing comma => parseTime returns NaN (new) / parseFloat('invalid...') => NaN (legacy)
  return `invalid${i}`
}

const makeCommentsFromTimes = (times: Float64Array, opts: {
  uid: string
  text: string
  gradientRate: number // 0..1
  invalidRate: number // 0..1
}) => {
  const { uid, text, gradientRate, invalidRate } = opts
  const n = times.length
  const comments: CommentEntity[] = new Array(n)

  const gradientEvery =
    gradientRate <= 0 ? Number.POSITIVE_INFINITY : Math.floor(1 / gradientRate)
  const invalidEvery =
    invalidRate <= 0 ? Number.POSITIVE_INFINITY : Math.floor(1 / invalidRate)

  for (let i = 0; i < n; i += 1) {
    const invalid = invalidEvery !== Number.POSITIVE_INFINITY && i % invalidEvery === 0
    const p = invalid ? makeInvalidP(i) : makeP(times[i], uid)

    const useGradient =
      gradientEvery !== Number.POSITIVE_INFINITY && i % gradientEvery === 0
    if (useGradient) {
      comments[i] = { p, m: text, s: gradientS }
    } else {
      comments[i] = { p, m: text }
    }
  }

  return comments
}

const sortByTime = (comments: CommentEntity[]) => {
  // Use legacy parse here so sorting itself doesn't depend on new parseTime.
  const entries = comments.map((c, idx) => ({ idx, t: legacyParseTime(c.p) }))
  entries.sort((a, b) => a.t - b.t)
  return entries.map((e) => comments[e.idx])
}

const nearSortedSwap = (arr: CommentEntity[], rate: number, seed: number) => {
  if (rate <= 0) return arr.slice()
  const rand = mulberry32(seed)
  const out = arr.slice()
  const swaps = Math.max(1, Math.floor(out.length * rate))
  for (let i = 0; i < swaps; i += 1) {
    const a = Math.floor(rand() * out.length)
    const b = Math.floor(rand() * out.length)
    const tmp = out[a]
    out[a] = out[b]
    out[b] = tmp
  }
  return out
}

const makeTimesRandom = (n: number, seed: number) => {
  const rand = mulberry32(seed)
  const times = new Float64Array(n)
  for (let i = 0; i < n; i += 1) {
    times[i] = rand() * (n / 10)
  }
  return times
}

const makeTimesClustered = (n: number, seed: number, bins: number) => {
  const rand = mulberry32(seed)
  const times = new Float64Array(n)
  const safeBins = Math.max(1, bins)
  for (let i = 0; i < n; i += 1) {
    const b = Math.floor(rand() * safeBins)
    times[i] = b + rand()
  }
  return times
}

const splitEpisodes = (comments: CommentEntity[], episodeCount: EpisodeCount) => {
  const episodes: CommentEntity[][] = []
  const chunk = Math.max(1, Math.floor(comments.length / episodeCount))
  for (let i = 0; i < comments.length; i += chunk) {
    episodes.push(comments.slice(i, i + chunk))
  }
  return episodes
}

const aggregateFlatMap = (episodes: CommentEntity[][]) => {
  return episodes.flatMap((ep) => ep)
}

const aggregatePushLoop = (episodes: CommentEntity[][]) => {
  const out: CommentEntity[] = []
  for (let i = 0; i < episodes.length; i += 1) {
    const ep = episodes[i]
    for (let j = 0; j < ep.length; j += 1) {
      out.push(ep[j])
    }
  }
  return out
}

const parseTimes = (comments: CommentEntity[]) => {
  let sum = 0
  for (let i = 0; i < comments.length; i += 1) {
    sum += parseTime(comments[i].p)
  }
  return sum
}

const parseOptions = (comments: CommentEntity[]) => {
  let sum = 0
  for (let i = 0; i < comments.length; i += 1) {
    const o = utils.parseCommentEntityP(comments[i].p)
    sum += o.time + o.color.length + (o.uid?.length ?? 0)
  }
  return sum
}

type Timed = Array<{ time: number; raw: CommentEntity }>

const buildTimed = (comments: CommentEntity[]) => {
  const timed: Timed = []
  let isSorted = true
  let last = Number.NEGATIVE_INFINITY
  for (let i = 0; i < comments.length; i += 1) {
    const raw = comments[i]
    const time = parseTime(raw.p)
    if (!Number.isFinite(time)) continue
    if (time < last) isSorted = false
    last = time
    timed.push({ time, raw })
  }
  return { timed, isSorted }
}

const sortTimed = (timed: Timed) => {
  timed.sort((a, b) => a.time - b.time)
  return timed
}

const mountNewPipeline = (comments: CommentEntity[]) => {
  const { timed, isSorted } = buildTimed(comments)
  if (!isSorted) {
    sortTimed(timed)
  }
  return timed.length
}

const mountOldPipeline = (comments: CommentEntity[]) => {
  const parsed: ParsedComment[] = new Array(comments.length)
  let count = 0
  for (let i = 0; i < comments.length; i += 1) {
    // transformComment will throw if p is invalid; skip invalid entries to mimic
    // the new pipeline behavior (which ignores invalid times).
    try {
      parsed[count] = transformComment(comments[i], 0)
      count += 1
    } catch {
      // ignore invalid
    }
  }
  parsed.length = count
  parsed.sort((a, b) => a.time - b.time)
  return parsed.length
}

const transformAll = (comments: CommentEntity[]) => {
  let sum = 0
  for (let i = 0; i < comments.length; i += 1) {
    try {
      const parsed = transformComment(comments[i], 0)
      sum += parsed.time + parsed.text.length
    } catch {
      // ignore invalid
    }
  }
  return sum
}

const makeSizeDatasets = (n: number): SizeDatasets => {
  const baseTimesRandom = makeTimesRandom(n, n)
  const baseTimesClustered = makeTimesClustered(n, n + 123, TIME_CLUSTER_BINS)

  const uidSimple = 'uid'
  const uidCommaHeavy64 = `uid,${repeat('a', 59)}`
  const uidCommaHeavy256 = `uid,${repeat('b', 251)}`

  const textShort8 = repeat('x', 8)
  const textLong256 = repeat('y', 256)
  const textVeryLong1024 = repeat('z', 1024)

  const baseComments = makeCommentsFromTimes(baseTimesRandom, {
    uid: uidSimple,
    text: textShort8,
    gradientRate: 0,
    invalidRate: 0,
  })

  const clusteredComments = makeCommentsFromTimes(baseTimesClustered, {
    uid: uidSimple,
    text: textShort8,
    gradientRate: 0,
    invalidRate: 0,
  })

  const randomInvalid = makeCommentsFromTimes(baseTimesRandom, {
    uid: uidSimple,
    text: textShort8,
    gradientRate: 0,
    invalidRate: INVALID_P_RATE,
  })

  const sorted = sortByTime(baseComments)
  const nearSorted = nearSortedSwap(
    sorted,
    NEAR_SORTED_SWAP_RATE,
    n + 9999
  )
  const reverse = sorted.slice().reverse()

  const time: SizeDatasets['time'] = {
    random: baseComments,
    'random_invalid1%': randomInvalid,
    sorted,
    'nearSorted1%': nearSorted,
    reverse,
    clustered100: clusteredComments,
  }

  const payload: SizeDatasets['payload'] = {
    base: baseComments,
    uidCommaHeavy64: makeCommentsFromTimes(baseTimesRandom, {
      uid: uidCommaHeavy64,
      text: textShort8,
      gradientRate: 0,
      invalidRate: 0,
    }),
    uidCommaHeavy256: makeCommentsFromTimes(baseTimesRandom, {
      uid: uidCommaHeavy256,
      text: textShort8,
      gradientRate: 0,
      invalidRate: 0,
    }),
    textShort8: makeCommentsFromTimes(baseTimesRandom, {
      uid: uidSimple,
      text: textShort8,
      gradientRate: 0,
      invalidRate: 0,
    }),
    textLong256: makeCommentsFromTimes(baseTimesRandom, {
      uid: uidSimple,
      text: textLong256,
      gradientRate: 0,
      invalidRate: 0,
    }),
    textVeryLong1024: makeCommentsFromTimes(baseTimesRandom, {
      uid: uidSimple,
      text: textVeryLong1024,
      gradientRate: 0,
      invalidRate: 0,
    }),
    'gradient50%': makeCommentsFromTimes(baseTimesRandom, {
      uid: uidSimple,
      text: textShort8,
      gradientRate: 0.5,
      invalidRate: 0,
    }),
    'gradient100%': makeCommentsFromTimes(baseTimesRandom, {
      uid: uidSimple,
      text: textShort8,
      gradientRate: 1,
      invalidRate: 0,
    }),
    worstCase: makeCommentsFromTimes(baseTimesRandom, {
      uid: uidCommaHeavy256,
      text: textVeryLong1024,
      gradientRate: 1,
      invalidRate: INVALID_P_RATE,
    }),
  }

  const episodes: SizeDatasets['episodes'] = {
    1: splitEpisodes(baseComments, 1),
    10: splitEpisodes(baseComments, 10),
    100: splitEpisodes(baseComments, 100),
  }

  return {
    size: n,
    time,
    payload,
    episodes,
  }
}

const DATASETS = new Map<number, SizeDatasets>(
  SIZES.map((n) => [n, makeSizeDatasets(n)])
)

const timeScenarioNames: TimeScenarioName[] = [
  'random',
  'random_invalid1%',
  'sorted',
  'nearSorted1%',
  'reverse',
  'clustered100',
]

const payloadScenarioNames: PayloadScenarioName[] = [
  'base',
  'uidCommaHeavy64',
  'uidCommaHeavy256',
  'textShort8',
  'textLong256',
  'textVeryLong1024',
  'gradient50%',
  'gradient100%',
  'worstCase',
]

const episodeCounts: EpisodeCount[] = [1, 10, 100]

describe('Danmaku Load Benchmarks (Multi-Dim)', () => {
  for (const n of SIZES) {
    const dataset = DATASETS.get(n)
    if (!dataset) continue

    for (const scenario of timeScenarioNames) {
      const comments = dataset.time[scenario]

      bench(`parse time time=${scenario} x${n}`, () => {
        const sum = parseTimes(comments)
        // allow NaN if invalid entries dominate (shouldn't), but consume
        if (sum === 42) throw new Error('unreachable')
      })

      bench(`build timed time=${scenario} x${n}`, () => {
        const { timed } = buildTimed(comments)
        if (timed.length < 0) throw new Error('unreachable')
      })

      bench(`sort timed time=${scenario} x${n}`, () => {
        const { timed } = buildTimed(comments)
        sortTimed(timed)
        if (timed.length < 0) throw new Error('unreachable')
      })

      bench(`mount new pipeline time=${scenario} x${n}`, () => {
        const len = mountNewPipeline(comments)
        if (len < 0) throw new Error('unreachable')
      })

      bench(`mount old pipeline time=${scenario} x${n}`, () => {
        const len = mountOldPipeline(comments)
        if (len < 0) throw new Error('unreachable')
      })
    }

    for (const scenario of payloadScenarioNames) {
      const comments = dataset.payload[scenario]

      bench(`parse time payload=${scenario} x${n}`, () => {
        const sum = parseTimes(comments)
        if (sum === 42) throw new Error('unreachable')
      })

      bench(`parseCommentEntityP payload=${scenario} x${n}`, () => {
        const sum = parseOptions(comments)
        if (!Number.isFinite(sum) && scenario !== 'worstCase') {
          throw new Error('sum is not finite')
        }
      })

      bench(`transformComment payload=${scenario} x${n}`, () => {
        const sum = transformAll(comments)
        if (!Number.isFinite(sum) && scenario !== 'worstCase') {
          throw new Error('sum is not finite')
        }
      })
    }

    for (const epCount of episodeCounts) {
      const eps = dataset.episodes[epCount]

      bench(`aggregate flatMap episodes=${epCount} x${n}`, () => {
        const out = aggregateFlatMap(eps)
        if (out.length !== n) throw new Error('unexpected size')
      })

      bench(`aggregate pushLoop episodes=${epCount} x${n}`, () => {
        const out = aggregatePushLoop(eps)
        if (out.length !== n) throw new Error('unexpected size')
      })
    }
  }
})

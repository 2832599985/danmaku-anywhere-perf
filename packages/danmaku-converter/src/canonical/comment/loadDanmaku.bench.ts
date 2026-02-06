import { bench, describe } from 'vitest'
import type { CommentEntity } from './types.js'
import { parseCommentEntityP, parseCommentEntityTime } from './utils.js'

// Import from source to benchmark the current implementation without requiring a build.
import { transformComment } from '../../../../danmaku-engine/src/parser'

type Dataset = {
  commentsSorted: CommentEntity[]
  commentsUnsorted: CommentEntity[]
  episodes: CommentEntity[][]
}

const SIZES = [1_000, 10_000, 100_000] as const

// Simple deterministic PRNG so results are repeatable across runs.
const mulberry32 = (seed: number) => {
  let t = seed >>> 0
  return () => {
    t += 0x6d2b79f5
    let x = Math.imul(t ^ (t >>> 15), 1 | t)
    x ^= x + Math.imul(x ^ (x >>> 7), 61 | x)
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296
  }
}

const makeP = (time: number) => {
  // p format: time,mode,color,uid
  // Use a fixed mode/color to reduce noise (we mainly care about parsing overhead).
  return `${time.toFixed(2)},1,16777215,uid`
}

const makeComments = (n: number, sorted: boolean): CommentEntity[] => {
  const rand = mulberry32(n)
  const arr: CommentEntity[] = new Array(n)

  for (let i = 0; i < n; i += 1) {
    const t = sorted ? i / 10 : rand() * (n / 10)
    arr[i] = { p: makeP(t), m: `c${i}` }
  }

  return arr
}

const splitEpisodes = (comments: CommentEntity[], episodeCount: number) => {
  const episodes: CommentEntity[][] = []
  const chunk = Math.max(1, Math.floor(comments.length / episodeCount))
  for (let i = 0; i < comments.length; i += chunk) {
    episodes.push(comments.slice(i, i + chunk))
  }
  return episodes
}

const DATASETS = new Map<number, Dataset>(
  SIZES.map((n) => {
    const commentsSorted = makeComments(n, true)
    const commentsUnsorted = makeComments(n, false)
    return [
      n,
      {
        commentsSorted,
        commentsUnsorted,
        // Use multiple episodes to mimic "mount selected danmaku" cases.
        episodes: splitEpisodes(commentsUnsorted, 10),
      },
    ]
  })
)

const flattenEpisodes = (episodes: CommentEntity[][]) => {
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
    sum += parseCommentEntityTime(comments[i].p)
  }
  return sum
}

const parseOptions = (comments: CommentEntity[]) => {
  let sum = 0
  for (let i = 0; i < comments.length; i += 1) {
    const o = parseCommentEntityP(comments[i].p)
    // Consume values so V8 doesn't optimize away the call.
    sum += o.time + o.color.length
  }
  return sum
}

const buildTimed = (comments: CommentEntity[]) => {
  const timed: Array<{ time: number; raw: CommentEntity }> = []
  let isSorted = true
  let last = Number.NEGATIVE_INFINITY
  for (let i = 0; i < comments.length; i += 1) {
    const raw = comments[i]
    const time = parseCommentEntityTime(raw.p)
    if (!Number.isFinite(time)) continue
    if (time < last) isSorted = false
    last = time
    timed.push({ time, raw })
  }
  return { timed, isSorted }
}

const sortTimed = (timed: Array<{ time: number; raw: CommentEntity }>) => {
  timed.sort((a, b) => a.time - b.time)
  return timed
}

const parseAllToParsedComments = (comments: CommentEntity[]) => {
  let sum = 0
  for (let i = 0; i < comments.length; i += 1) {
    const parsed = transformComment(comments[i], 0)
    sum += parsed.time + parsed.text.length
  }
  return sum
}

describe('Danmaku Load Benchmarks', () => {
  for (const n of SIZES) {
    const dataset = DATASETS.get(n)
    if (!dataset) continue

    bench(`flatten episodes x${n}`, () => {
      const flat = flattenEpisodes(dataset.episodes)
      // consume
      if (flat.length !== n) throw new Error('unexpected size')
    })

    bench(`parseCommentEntityTime x${n}`, () => {
      const sum = parseTimes(dataset.commentsUnsorted)
      if (!Number.isFinite(sum)) throw new Error('sum is not finite')
    })

    bench(`parseCommentEntityP x${n}`, () => {
      const sum = parseOptions(dataset.commentsUnsorted)
      if (!Number.isFinite(sum)) throw new Error('sum is not finite')
    })

    bench(`build timed (sorted input) x${n}`, () => {
      const { timed, isSorted } = buildTimed(dataset.commentsSorted)
      if (!isSorted) throw new Error('expected sorted')
      if (timed.length !== n) throw new Error('unexpected size')
    })

    bench(`build timed (unsorted input) x${n}`, () => {
      const { timed } = buildTimed(dataset.commentsUnsorted)
      if (timed.length !== n) throw new Error('unexpected size')
    })

    bench(`sort timed x${n}`, () => {
      const { timed } = buildTimed(dataset.commentsUnsorted)
      const sorted = sortTimed(timed)
      if (sorted.length !== n) throw new Error('unexpected size')
    })

    bench(`transformComment (preparse) x${n}`, () => {
      const sum = parseAllToParsedComments(dataset.commentsUnsorted)
      if (!Number.isFinite(sum)) throw new Error('sum is not finite')
    })
  }
})


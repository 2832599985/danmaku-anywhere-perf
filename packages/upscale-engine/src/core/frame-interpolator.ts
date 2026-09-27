import type {
  Dimensions,
  FrameInterpolationOptions,
  FrameInterpolationResolution,
} from '../types'

const ALIGNMENT = 16
const SOURCE_POOL_SIZE = 8
/**
 * Ceiling on the generated-frame pool. Every entry is a full-size rgba8unorm
 * texture and the pool is allocated up front, so 8x at 720p would reserve 23 of
 * them (~85 MB) purely to let several pairs overlap. A single pair never needs
 * more than `maxFactor - 1` (<= 7), so the cap only bounds that overlap.
 */
const MAX_MID_POOL_SIZE = 12
/** Hard ceiling on the interpolation factor (quality/GPU-cost guard). */
const MAX_INTERPOLATION_FACTOR = 8
/** Lowest source fps assumed when sizing pools for a target-fps request. */
const MIN_ASSUMED_SOURCE_FPS = 20
/**
 * Consecutive pairs that produced nothing displayable before the effective
 * factor drops one step — and only once it is already 2 is interpolation
 * bypassed at all. Dropping a step first matters: the first sub-frame of a
 * factor-f pair sits (1 - 1/f) of a source interval *before* the current
 * frame's slot, so one step down buys a whole extra slice of slack and a GPU
 * that cannot hold 3x settles at 2x instead of latching off.
 */
const LATE_PAIRS_BEFORE_DEGRADE = 3
/** Consecutive timely pairs needed to give the factor one step back. */
const TIMELY_PAIRS_BEFORE_RECOVERY = 60
/** Bypass window used once even 2x cannot keep up. */
const OVERLOAD_BYPASS_MS = 600
/** Short bypass used to let a saturated source pool drain. */
const POOL_RECOVERY_BYPASS_MS = 500
/**
 * Megapixels of generated output a single source pair may cost. Interpolation
 * work scales with (factor - 1) x processing pixels, so without this the same
 * factor that is comfortable at 720p saturates the GPU at 1080p and thrashes
 * the overload bypass. Calibrated so 720p keeps the full 8x and 1080p settles
 * at 4x.
 */
const INTERPOLATION_PIXEL_BUDGET_MP = 6.5
const MIN_PROCESSING_DELAY_MS = 20
const MAX_PROCESSING_DELAY_MS = 50
/**
 * Slack added to the display delay for the classify readback, the queue wait
 * and the jitter of the frame callback itself.
 */
const INTERPOLATION_COMPUTE_LEAD_MS = 12
/**
 * Repeat test resolution. 160x90 is the smallest thumbnail that still resolves
 * a drawing change, and `resizeQuality: 'medium'` is what makes it clean:
 * measured inside the real WebView2 on 1080p anime, a held pair never differs
 * by more than 7 (summed over the three channels, so 0..765) while any real
 * drawing change starts at 189 — a two-order-of-magnitude gap, not a tight fit.
 * It costs ~2.3 ms p50 asynchronously, whereas the GPU readback it replaces
 * queued behind Anime4K for 8-16 ms average and up to 88 ms.
 */
const CLASSIFY_WIDTH = 160
const CLASSIFY_HEIGHT = 90
/** Max summed-RGB difference below which the pair is the same drawing. */
const REPEAT_MAX_DIFFERENCE = 8
/** Mean per-channel difference above which the pair is a cut between shots. */
const SCENE_CUT_MEAN_DIFFERENCE = 32

const blitShader = `
struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
}

@vertex
fn vertexMain(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
  const positions = array(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>(3.0, -1.0),
    vec2<f32>(-1.0, 3.0),
  );
  const uvs = array(
    vec2<f32>(0.0, 1.0),
    vec2<f32>(2.0, 1.0),
    vec2<f32>(0.0, -1.0),
  );
  var output: VertexOutput;
  output.position = vec4<f32>(positions[vertexIndex], 0.0, 1.0);
  output.uv = uvs[vertexIndex];
  return output;
}

@group(0) @binding(0) var sourceTexture: texture_2d<f32>;
@group(0) @binding(1) var sourceSampler: sampler;

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4<f32> {
  return textureSampleLevel(sourceTexture, sourceSampler, input.uv, 0.0);
}
`

export interface FrameDifferenceClassification {
  duplicate: boolean
  sceneCut: boolean
  mean: number
  maximum: number
}

export interface InterpolationFrame {
  texture: GPUTexture
  release: () => void
  /**
   * True when this frame was synthesized by the model rather than captured from
   * the video. The renderer counts presents by this flag, which is the only
   * honest way to split the output rate: repeat frames are elided and source
   * frames are captured at the file's rate, so counting captures would report a
   * source rate the viewer never saw.
   */
  generated: boolean
}

export interface FrameInterpolatorCreateOptions {
  device: GPUDevice
  video: HTMLVideoElement
  options: FrameInterpolationOptions
  maxTextureDimension: number
  onWarning?: (message: string, error?: unknown) => void
  onFrameGenerated?: (count: number) => void
}

export interface FrameCaptureTiming {
  arrival: number
  expectedDisplayTime?: number
  mediaTime?: number
  presentedFrames?: number
}

/**
 * Cumulative pair accounting since the interpolator was created. Every source
 * pair ends in exactly one of the outcome buckets, so their sum is the number
 * of pairs seen; the timings say where the time went. Read it (e.g. from a
 * debugger or the HUD) to tell "the GPU is saturated" apart from "the
 * scheduler gave up on work the GPU could still do".
 */
export interface FrameInterpolationStats {
  /** Pairs that produced at least one generated frame. */
  produced: number
  /** Generated frames enqueued for display. */
  generatedFrames: number
  /** Pairs skipped as repeats (anime held on twos/threes, paused). */
  duplicate: number
  /** Source frames skipped by the Anime4K chain because they repeat the last one. */
  elided: number
  /** Pairs skipped as scene cuts (a mid would blend two shots). */
  sceneCut: number
  /** Pairs skipped because the source cadence is outside 22–100 ms. */
  cadence: number
  /** Pairs dropped because their output slot had already passed. */
  late: number
  /** Pairs skipped while the overload guard's bypass window was open. */
  bypassed: number
  /** Pairs abandoned by a seek / rebuild (a new timeline). */
  stale: number
  /** Frames that could not be captured because every source slot was busy. */
  poolSaturated: number
  /** Times the overload guard armed its bypass window. */
  bypassArms: number
  /** Factor the interpolator is configured for (after the resolution cap). */
  maxFactor: number
  /** Current adaptive factor ceiling; drops under load, climbs back when idle. */
  factorCeiling: number
  /** Mean ms from capture to the start of pair processing (queue wait). */
  averageQueueWaitMs: number
  /** Mean ms the repeat/scene-cut readback took. */
  averageClassifyMs: number
  /** Worst classify readback seen. */
  maximumClassifyMs: number
  /** Mean slack (ms) between "ready to enqueue" and the first sub-frame's slot. */
  averageSlackMs: number
}

type QueuedFrame = {
  texture: GPUTexture
  displayAt: number
  /** True when the frame came out of the model rather than off the video. */
  generated: boolean
  /**
   * Set once the pair it belongs to is classified as a repeat: the canvas
   * already shows this exact picture, so presenting it would buy an Anime4K
   * pass and nothing else. Held drawings are 50-70% of an anime source, so this
   * is most of the chain's work.
   */
  elide: boolean
}

interface FramegenRuntime {
  prepPair(a: GPUTexture, b: GPUTexture): void
  runT(t: number, output: GPUTexture): void
  destroy(): void
}

interface FramegenRuntimeModule {
  createRT(
    device: GPUDevice,
    options: {
      w: number
      h: number
      weightsBin: ArrayBuffer
      weightsManifest: Record<string, { offset: number; shape: number[] }>
      textureInput: boolean
      textureOutput: boolean
      staticGuard: boolean
      sparseRefine: boolean
    }
  ): Promise<FramegenRuntime>
}

const alignDown = (value: number) =>
  Math.max(ALIGNMENT, Math.floor(value / ALIGNMENT) * ALIGNMENT)

export function calculateInterpolationDimensions(
  source: Dimensions,
  resolution: FrameInterpolationResolution,
  maxTextureDimension = Number.POSITIVE_INFINITY
): Dimensions {
  const maximumHeight =
    resolution === '1080p' ? 1080 : resolution === '720p' ? 720 : 480
  const scale = Math.min(
    1,
    maximumHeight / Math.max(1, source.height),
    maxTextureDimension / Math.max(1, source.width),
    maxTextureDimension / Math.max(1, source.height)
  )
  const fittedWidth = Math.max(1, source.width * scale)
  const fittedHeight = Math.max(1, source.height * scale)
  const height = alignDown(fittedHeight)

  // Both sides must land on the model's 16-pixel grid, so flooring each one
  // independently can skew the aspect ratio by >2% (640x360 -> 640x352), which
  // then shows up as a squashed picture once Anime4K scales back out. Choose
  // the aligned width that best preserves the source aspect instead.
  const aspect = fittedWidth / fittedHeight
  const lower = alignDown(height * aspect)
  const upper = lower + ALIGNMENT
  const aspectError = (candidate: number) =>
    Math.abs(candidate / height - aspect)
  const preferUpper =
    upper <= maxTextureDimension && aspectError(upper) < aspectError(lower)

  return { width: preferUpper ? upper : lower, height }
}

/**
 * Upper bound on the interpolation factor for a given processing resolution,
 * derived from the per-pair pixel budget. Keeps a high target-fps request from
 * asking a 1080p pipeline for work it cannot finish inside one source interval.
 */
export function computeResolutionFactorCap(
  dimensions: Dimensions,
  cap = MAX_INTERPOLATION_FACTOR
): number {
  const megapixels = (dimensions.width * dimensions.height) / 1_000_000
  if (!(megapixels > 0)) return cap
  return Math.max(
    2,
    Math.min(cap, 1 + Math.floor(INTERPOLATION_PIXEL_BUDGET_MP / megapixels))
  )
}

/**
 * Compare two 160x90 RGBA thumbnails of consecutive frames. The maximum is what
 * separates "same drawing" from "the drawing changed" (see
 * REPEAT_MAX_DIFFERENCE); the mean only has to catch hard cuts, where every
 * pixel changes at once.
 */
export function classifyThumbnailDifference(
  previous: Uint8ClampedArray,
  current: Uint8ClampedArray
): FrameDifferenceClassification {
  const pixels = previous.length / 4
  if (previous.length !== current.length || !(pixels >= 1)) {
    // An unknown must never read as "held": a false "changed" only costs GPU
    // work, while a false "held" would elide a frame the viewer needs.
    return { duplicate: false, sceneCut: false, mean: 0, maximum: 0 }
  }
  let maximum = 0
  let sum = 0
  for (let index = 0; index < previous.length; index += 4) {
    const difference =
      Math.abs(previous[index] - current[index]) +
      Math.abs(previous[index + 1] - current[index + 1]) +
      Math.abs(previous[index + 2] - current[index + 2])
    sum += difference
    if (difference > maximum) maximum = difference
  }
  const mean = sum / pixels / 3
  return {
    duplicate: maximum <= REPEAT_MAX_DIFFERENCE,
    sceneCut: mean >= SCENE_CUT_MEAN_DIFFERENCE,
    mean,
    maximum,
  }
}

/** Options subset that selects the interpolation factor. */
export interface InterpolationFactorOptions {
  multiplier?: number
  targetFps?: number
}

/**
 * The largest factor the interpolator may ever use for a request, used to size
 * GPU texture pools up front. An explicit multiplier is exact; a target fps is
 * sized against the lowest source fps we expect so pools never run short.
 */
export function computeMaxInterpolationFactor(
  options: InterpolationFactorOptions,
  cap = MAX_INTERPOLATION_FACTOR
): number {
  if (options.multiplier && options.multiplier >= 2) {
    return Math.max(2, Math.min(cap, Math.floor(options.multiplier)))
  }
  if (options.targetFps && options.targetFps > 0) {
    return Math.max(
      2,
      Math.min(cap, Math.ceil(options.targetFps / MIN_ASSUMED_SOURCE_FPS))
    )
  }
  return 2
}

/**
 * The factor to apply to a specific source pair. Explicit multiplier wins;
 * otherwise it is derived from the target fps and the live source fps, so 24fps
 * and 30fps sources both approach the target. Always in [2, maxFactor].
 */
export function resolveInterpolationFactor(
  options: InterpolationFactorOptions,
  sourceFps: number,
  maxFactor = MAX_INTERPOLATION_FACTOR
): number {
  const cap = Math.max(2, maxFactor)
  if (options.multiplier && options.multiplier >= 2) {
    return Math.max(2, Math.min(cap, Math.floor(options.multiplier)))
  }
  if (options.targetFps && sourceFps > 0) {
    return Math.max(2, Math.min(cap, Math.round(options.targetFps / sourceFps)))
  }
  return 2
}

/** Outcome of one source pair, as seen by the overload guard. */
export type InterpolationPairOutcome = 'late' | 'timely'

/**
 * Overload-guard state. `factorCeiling` is the whole point: instead of a
 * binary on/off, sustained lateness costs one step of the interpolation factor
 * (down to 2x) and a healthy stretch gives it back. The old guard armed a
 * 2-second full bypass after three late pairs, so a GPU with plenty of headroom
 * spent 40%+ of its pairs interpolating nothing at all (measured: 86 of 204
 * pairs bypassed at 45% GPU utilization).
 */
export interface InterpolationOverloadState {
  /** Consecutive pairs that produced nothing displayable. */
  lateSamples: number
  /** Consecutive pairs that produced something displayable. */
  timelySamples: number
  /** Adaptive ceiling on the interpolation factor, in [2, maxFactor]. */
  factorCeiling: number
  /** While > now, interpolation is skipped entirely (pool recovery). */
  bypassUntil: number
}

export function createInterpolationOverloadState(
  maxFactor: number
): InterpolationOverloadState {
  return {
    lateSamples: 0,
    timelySamples: 0,
    factorCeiling: Math.max(2, maxFactor),
    bypassUntil: 0,
  }
}

/**
 * Fold one pair outcome into the overload state. A pair is "late" when it
 * produced nothing that could still be displayed — a signal attributable to
 * interpolation alone, unlike a queue-drain timing, which also measures the
 * Anime4K passes sharing the same GPU queue.
 */
export function updateInterpolationOverload(
  state: InterpolationOverloadState,
  outcome: InterpolationPairOutcome,
  now: number,
  options: {
    threshold?: number
    bypassMs?: number
    recoveryPairs?: number
    maxFactor?: number
  } = {}
): InterpolationOverloadState {
  const maxFactor = Math.max(2, options.maxFactor ?? state.factorCeiling)
  if (outcome === 'timely') {
    const lateSamples = Math.max(0, state.lateSamples - 1)
    const timelySamples = state.timelySamples + 1
    if (
      state.factorCeiling < maxFactor &&
      timelySamples >= (options.recoveryPairs ?? TIMELY_PAIRS_BEFORE_RECOVERY)
    ) {
      return {
        lateSamples,
        timelySamples: 0,
        factorCeiling: state.factorCeiling + 1,
        bypassUntil: state.bypassUntil,
      }
    }
    return { ...state, lateSamples, timelySamples }
  }

  const lateSamples = state.lateSamples + 1
  if (lateSamples < (options.threshold ?? LATE_PAIRS_BEFORE_DEGRADE)) {
    return { ...state, lateSamples, timelySamples: 0 }
  }
  if (state.factorCeiling > 2) {
    return {
      lateSamples: 0,
      timelySamples: 0,
      factorCeiling: state.factorCeiling - 1,
      bypassUntil: state.bypassUntil,
    }
  }
  return {
    lateSamples: 0,
    timelySamples: 0,
    factorCeiling: 2,
    bypassUntil: now + (options.bypassMs ?? OVERLOAD_BYPASS_MS),
  }
}

export function shouldInterpolateInterval(intervalMs: number): boolean {
  // The first release targets 24/25/30 fps video. At >=45 fps a 2x stream
  // cannot be displayed on the common 60 Hz path and only adds GPU pressure.
  return intervalMs >= 22 && intervalMs <= 100
}

/**
 * How far after a frame's nominal display time it is shown. The delay has to
 * cover the (1 - 1/factor) of a source interval that separates the current
 * frame's slot from the first sub-frame's slot, plus the time the pair needs to
 * be classified. Without the factor term — the delay used to be a flat
 * interval/2 — the first sub-frame of every pair was already 1-8 ms in the past
 * by the time it was computed, so 3x and 4x produced at most their later
 * sub-frames and usually nothing at all.
 */
export function calculateFrameProcessingDelay(
  intervalMs: number,
  factor = 2
): number {
  const firstSubFrameLead =
    intervalMs * (1 - 1 / Math.max(2, Math.floor(factor)))
  return Math.min(
    MAX_PROCESSING_DELAY_MS,
    Math.max(
      MIN_PROCESSING_DELAY_MS,
      firstSubFrameLead + INTERPOLATION_COMPUTE_LEAD_MS
    )
  )
}

export function isMediaTimelineDiscontinuity(options: {
  previousMediaTime: number | null
  mediaTime: number
  previousExpectedDisplayTime: number | null
  expectedDisplayTime?: number
  intervalMs: number
  playbackRate: number
}): boolean {
  const {
    previousMediaTime,
    mediaTime,
    previousExpectedDisplayTime,
    expectedDisplayTime,
    intervalMs,
    playbackRate,
  } = options
  if (previousMediaTime === null) return false

  const mediaDeltaMs = (mediaTime - previousMediaTime) * 1000
  if (mediaDeltaMs < -1) return true

  const discontinuityThresholdMs = Math.max(120, intervalMs * 3)
  const mediaWallDeltaMs = mediaDeltaMs / Math.max(0.01, Math.abs(playbackRate))
  if (mediaWallDeltaMs > discontinuityThresholdMs) return true

  if (
    expectedDisplayTime === undefined ||
    previousExpectedDisplayTime === null
  ) {
    return false
  }

  const expectedDisplayDeltaMs =
    expectedDisplayTime - previousExpectedDisplayTime
  return (
    expectedDisplayDeltaMs <= 0 ||
    Math.abs(mediaWallDeltaMs - expectedDisplayDeltaMs) >
      discontinuityThresholdMs
  )
}

export class FrameInterpolator {
  public readonly dimensions: Dimensions

  private static runtimeModulePromise: Promise<FramegenRuntimeModule> | null =
    null
  private static weightsCache = new Map<
    string,
    Promise<{
      bin: ArrayBuffer
      manifest: Record<string, { offset: number; shape: number[] }>
    }>
  >()

  private readonly device: GPUDevice
  private readonly video: HTMLVideoElement
  private readonly runtime: FramegenRuntime
  private readonly onWarning?: (message: string, error?: unknown) => void
  private readonly onFrameGenerated?: (count: number) => void
  private readonly sourceTextures: GPUTexture[]
  private readonly midTextures: GPUTexture[]
  private readonly retainCounts = new Map<GPUTexture, number>()
  private readonly queue: QueuedFrame[] = []
  private readonly captureTexture: GPUTexture
  private readonly capturePipeline: GPURenderPipeline
  private readonly captureBindGroup: GPUBindGroup
  private readonly classifyContext: CanvasRenderingContext2D

  private lastTexture: GPUTexture | null = null
  private lastDisplayAt = 0
  private lastMediaTime: number | null = null
  private lastExpectedDisplayTime: number | null = null
  private lastPresentedFrames: number | null = null
  /** 160x90 RGBA of the previous captured frame, for the repeat test. */
  private lastThumbnailData: Uint8ClampedArray | null = null
  private intervalMs = 1000 / 30
  private sourceIndex = 0
  private midIndex = 0
  private pairTail: Promise<void> = Promise.resolve()
  private generation = 0
  private destroyed = false
  private overload: InterpolationOverloadState
  private lastSourcePoolWarningAt = 0
  private generatedFrames = 0
  /** Raw counters behind `getStats()`. */
  private readonly tally = {
    produced: 0,
    duplicate: 0,
    elided: 0,
    sceneCut: 0,
    cadence: 0,
    late: 0,
    bypassed: 0,
    stale: 0,
    poolSaturated: 0,
    bypassArms: 0,
    enqueued: 0,
    queueWaitTotal: 0,
    queueWaitSamples: 0,
    classifyTotal: 0,
    classifySamples: 0,
    classifyMax: 0,
    slackTotal: 0,
    slackSamples: 0,
  }

  /** Factor selection (explicit multiplier or derived from targetFps). */
  private readonly factorOptions: InterpolationFactorOptions
  /** Upper bound the mid-texture pool was sized for. */
  private readonly maxFactor: number

  private readonly handleSeeking = () => this.resetTimeline()

  private constructor(
    createOptions: FrameInterpolatorCreateOptions,
    runtime: FramegenRuntime,
    dimensions: Dimensions
  ) {
    this.device = createOptions.device
    this.video = createOptions.video
    this.runtime = runtime
    this.dimensions = dimensions
    this.onWarning = createOptions.onWarning
    this.onFrameGenerated = createOptions.onFrameGenerated
    this.video.addEventListener('seeking', this.handleSeeking)

    this.factorOptions = {
      multiplier: createOptions.options.multiplier,
      targetFps: createOptions.options.targetFps,
    }
    // The requested factor is additionally capped by what this processing
    // resolution can sustain, so a 170fps target at 1080p degrades to a factor
    // the GPU can actually hit instead of oscillating through overload bypass.
    this.maxFactor = Math.min(
      computeMaxInterpolationFactor(this.factorOptions),
      computeResolutionFactorCap(dimensions)
    )
    this.overload = createInterpolationOverloadState(this.maxFactor)

    this.sourceTextures = Array.from({ length: SOURCE_POOL_SIZE }, (_, index) =>
      this.createFrameTexture(
        `danmaku-anywhere-framegen-source-${index}`,
        false
      )
    )
    // Each source pair may enqueue up to (maxFactor - 1) generated frames, and a
    // couple of pairs can be in flight, so scale the pool with the factor —
    // bounded, because the whole pool is allocated eagerly.
    const midPoolSize = Math.min(
      MAX_MID_POOL_SIZE,
      Math.max(4, (this.maxFactor - 1) * 3 + 2)
    )
    this.midTextures = Array.from({ length: midPoolSize }, (_, index) =>
      this.createFrameTexture(`danmaku-anywhere-framegen-mid-${index}`, true)
    )

    this.captureTexture = this.device.createTexture({
      label: 'danmaku-anywhere-framegen-capture',
      size: [this.video.videoWidth, this.video.videoHeight, 1],
      format: 'rgba8unorm',
      usage:
        GPUTextureUsage.COPY_DST |
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.RENDER_ATTACHMENT,
    })

    const captureSampler = this.device.createSampler({
      magFilter: 'linear',
      minFilter: 'linear',
    })
    const captureModule = this.device.createShaderModule({ code: blitShader })
    this.capturePipeline = this.device.createRenderPipeline({
      layout: 'auto',
      vertex: { module: captureModule, entryPoint: 'vertexMain' },
      fragment: {
        module: captureModule,
        entryPoint: 'fragmentMain',
        targets: [{ format: 'rgba8unorm' }],
      },
      primitive: { topology: 'triangle-list' },
    })
    this.captureBindGroup = this.device.createBindGroup({
      layout: this.capturePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: this.captureTexture.createView() },
        { binding: 1, resource: captureSampler },
      ],
    })

    // The repeat test runs on the CPU. Doing it on the GPU meant a mapAsync
    // readback on the same queue Anime4K saturates, so it measured 8-16 ms
    // average and up to 88 ms — long enough that the pair's output slot had
    // always passed by the time the verdict arrived.
    const canvas = document.createElement('canvas')
    canvas.width = CLASSIFY_WIDTH
    canvas.height = CLASSIFY_HEIGHT
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) {
      throw new Error('Failed to create a 2D context for the repeat test')
    }
    this.classifyContext = context
  }

  public static async create(
    options: FrameInterpolatorCreateOptions
  ): Promise<FrameInterpolator> {
    if (!options.device.features.has('shader-f16')) {
      throw new Error('Frame interpolation requires WebGPU shader-f16 support')
    }

    // Validate the source rather than the aligned result: alignDown() floors at
    // ALIGNMENT, so a check on the returned dimensions can never fail. A video
    // whose metadata has not arrived yet reports 0x0, which would otherwise
    // build a zero-sized capture texture and emit validation errors for every
    // frame while still reporting interpolation as active.
    const source = {
      width: options.video.videoWidth,
      height: options.video.videoHeight,
    }
    if (
      !Number.isFinite(source.width) ||
      !Number.isFinite(source.height) ||
      source.width < ALIGNMENT ||
      source.height < ALIGNMENT
    ) {
      throw new Error(
        `Video dimensions are unavailable or too small for frame interpolation (${source.width}x${source.height})`
      )
    }

    const dimensions = calculateInterpolationDimensions(
      source,
      options.options.resolution,
      options.maxTextureDimension
    )

    const [runtimeModule, weights] = await Promise.all([
      (FrameInterpolator.runtimeModulePromise ??= import(
        './framegen-runtime'
      ) as Promise<FramegenRuntimeModule>),
      FrameInterpolator.loadWeights(options.options),
    ])
    const runtime = await runtimeModule.createRT(options.device, {
      w: dimensions.width,
      h: dimensions.height,
      weightsBin: weights.bin,
      weightsManifest: weights.manifest,
      textureInput: true,
      textureOutput: true,
      staticGuard: true,
      sparseRefine: true,
    })
    // The texture pools are the largest allocation the engine makes. Without an
    // error scope an exhausted GPU reports out-of-memory asynchronously, so
    // create() would resolve and the renderer would mark interpolation active
    // over a broken pool instead of falling back to Anime4K only.
    options.device.pushErrorScope('out-of-memory')
    let interpolator: FrameInterpolator
    try {
      interpolator = new FrameInterpolator(options, runtime, dimensions)
    } catch (error) {
      await options.device.popErrorScope()
      throw error
    }
    const outOfMemory = await options.device.popErrorScope()
    if (outOfMemory) {
      interpolator.destroy()
      throw new Error(
        `Frame interpolation ran out of GPU memory: ${outOfMemory.message}`
      )
    }
    return interpolator
  }

  private static loadWeights(options: FrameInterpolationOptions) {
    const cacheKey = `${options.weightsBinUrl}|${options.weightsManifestUrl}`
    let request = FrameInterpolator.weightsCache.get(cacheKey)
    if (!request) {
      request = Promise.all([
        fetch(options.weightsBinUrl).then((response) => {
          if (!response.ok) {
            throw new Error(
              `Failed to load Framegen weights (${response.status})`
            )
          }
          return response.arrayBuffer()
        }),
        fetch(options.weightsManifestUrl).then(async (response) => {
          if (!response.ok) {
            throw new Error(
              `Failed to load Framegen manifest (${response.status})`
            )
          }
          return (await response.json()) as Record<
            string,
            { offset: number; shape: number[] }
          >
        }),
      ]).then(([bin, manifest]) => ({ bin, manifest }))
      FrameInterpolator.weightsCache.set(cacheKey, request)
      void request.catch(() => FrameInterpolator.weightsCache.delete(cacheKey))
    }
    return request
  }

  private createFrameTexture(label: string, storage: boolean): GPUTexture {
    return this.device.createTexture({
      label,
      size: [this.dimensions.width, this.dimensions.height, 1],
      format: 'rgba8unorm',
      usage:
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.RENDER_ATTACHMENT |
        (storage ? GPUTextureUsage.STORAGE_BINDING : 0),
    })
  }

  private retain(texture: GPUTexture): void {
    this.retainCounts.set(texture, (this.retainCounts.get(texture) ?? 0) + 1)
  }

  private release(texture: GPUTexture): void {
    const next = (this.retainCounts.get(texture) ?? 1) - 1
    if (next <= 0) this.retainCounts.delete(texture)
    else this.retainCounts.set(texture, next)
  }

  private acquireTexture(
    pool: GPUTexture[],
    cursor: 'sourceIndex' | 'midIndex'
  ): GPUTexture | null {
    for (let offset = 0; offset < pool.length; offset++) {
      const index = (this[cursor] + offset) % pool.length
      const texture = pool[index]
      if (!this.retainCounts.has(texture)) {
        this[cursor] = (index + 1) % pool.length
        return texture
      }
    }
    return null
  }

  private enqueue(
    texture: GPUTexture,
    displayAt: number,
    generated: boolean
  ): QueuedFrame {
    const frame: QueuedFrame = { texture, displayAt, generated, elide: false }
    this.retain(texture)
    this.queue.push(frame)
    return frame
  }

  /**
   * Snapshot the frame currently in the video element as a 160x90 thumbnail.
   * Issued at capture time so the bitmap belongs to the same frame as the
   * texture, and awaited by the pair task — `createImageBitmap` resizes off the
   * main thread, so this never blocks the render loop.
   */
  private createThumbnail(): Promise<ImageBitmap | null> {
    return createImageBitmap(this.video, {
      resizeWidth: CLASSIFY_WIDTH,
      resizeHeight: CLASSIFY_HEIGHT,
      resizeQuality: 'medium',
    }).catch(() => null)
  }

  /**
   * Invalidate every queued frame pair without disturbing the display queue.
   * Pending pairs fail their generation check and release their source textures
   * in their own `finally`, so a saturated pool recovers within a microtask.
   */
  private dropPendingPairWork(): void {
    this.generation++
  }

  private resetTimeline(): void {
    this.generation++
    for (const queued of this.queue) this.release(queued.texture)
    this.queue.length = 0
    if (this.lastTexture) this.release(this.lastTexture)
    this.lastTexture = null
    this.lastDisplayAt = 0
    this.lastMediaTime = null
    this.lastExpectedDisplayTime = null
    this.lastPresentedFrames = null
    this.lastThumbnailData = null
  }

  private capture(texture: GPUTexture): void {
    this.device.queue.copyExternalImageToTexture(
      { source: this.video },
      { texture: this.captureTexture },
      [this.video.videoWidth, this.video.videoHeight]
    )
    const encoder = this.device.createCommandEncoder()
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: texture.createView(),
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
    })
    pass.setPipeline(this.capturePipeline)
    pass.setBindGroup(0, this.captureBindGroup)
    pass.draw(3)
    pass.end()
    this.device.queue.submit([encoder.finish()])
  }

  public captureFrame(
    timing: FrameCaptureTiming = { arrival: performance.now() }
  ): boolean {
    const { arrival } = timing
    if (
      this.destroyed ||
      this.video.readyState < this.video.HAVE_CURRENT_DATA
    ) {
      return false
    }

    const mediaTime = timing.mediaTime ?? this.video.currentTime
    const previousMediaTime = this.lastMediaTime
    if (
      isMediaTimelineDiscontinuity({
        previousMediaTime,
        mediaTime,
        previousExpectedDisplayTime: this.lastExpectedDisplayTime,
        expectedDisplayTime: timing.expectedDisplayTime,
        intervalMs: this.intervalMs,
        playbackRate: this.video.playbackRate,
      }) ||
      (timing.presentedFrames !== undefined &&
        this.lastPresentedFrames !== null &&
        timing.presentedFrames < this.lastPresentedFrames)
    ) {
      this.resetTimeline()
    }
    this.lastMediaTime = mediaTime
    this.lastExpectedDisplayTime = timing.expectedDisplayTime ?? null
    if (timing.presentedFrames !== undefined) {
      this.lastPresentedFrames = timing.presentedFrames
    }

    const currentTexture = this.acquireTexture(
      this.sourceTextures,
      'sourceIndex'
    )
    if (!currentTexture) {
      // Saturation pins the real frames too, and in this mode the interpolator
      // queue is the renderer's only input — doing nothing here freezes the
      // canvas on the last processed frame while playback continues. Invalidate
      // the queued pair work (each pair releases its sources as soon as it
      // short-circuits) and bypass interpolation briefly, so the pool is free
      // again by the next frame instead of staying pinned.
      this.dropPendingPairWork()
      this.tally.poolSaturated += 1
      this.overload = {
        ...this.overload,
        lateSamples: 0,
        bypassUntil: Math.max(
          this.overload.bypassUntil,
          arrival + POOL_RECOVERY_BYPASS_MS
        ),
      }
      if (arrival - this.lastSourcePoolWarningAt >= 2000) {
        this.lastSourcePoolWarningAt = arrival
        this.onWarning?.('Frame interpolation source pool is saturated')
      }
      return false
    }

    // Thumbnail first: both this and the texture copy below snapshot the frame
    // the video element is showing right now, so they must be issued together.
    const thumbnail = this.createThumbnail()
    this.capture(currentTexture)

    // Derive the source cadence from media time rather than from
    // `expectedDisplayTime`. The compositor's expected display time jitters by
    // tens of milliseconds under load, and this smoothed interval gates both
    // `shouldInterpolateInterval` and the display delay — a jittery value made
    // whole stretches read as "wrong cadence" and go uninterpolated.
    const playbackRate = Math.abs(this.video.playbackRate) || 1
    if (previousMediaTime !== null && timing.mediaTime !== undefined) {
      const deltaMs =
        ((timing.mediaTime - previousMediaTime) * 1000) / playbackRate
      if (deltaMs > 5 && deltaMs < 500) {
        this.intervalMs = this.intervalMs * 0.85 + deltaMs * 0.15
      }
    }

    const cadenceAt = timing.expectedDisplayTime ?? arrival
    // Size the delay for the factor this pair is expected to use — the request
    // capped by the adaptive ceiling — rather than the configured maximum.
    // Oversizing it would add display latency the pair never needs.
    const expectedFactor = Math.min(
      resolveInterpolationFactor(
        this.factorOptions,
        1000 / this.intervalMs,
        this.maxFactor
      ),
      this.overload.factorCeiling
    )
    const currentDisplayAt =
      cadenceAt + calculateFrameProcessingDelay(this.intervalMs, expectedFactor)
    const queued = this.enqueue(currentTexture, currentDisplayAt, false)

    const previousTexture = this.lastTexture
    const previousDisplayAt = this.lastDisplayAt
    if (previousTexture) {
      this.retain(previousTexture)
      this.retain(currentTexture)
      const generation = this.generation
      const capturedAt = performance.now()
      this.pairTail = this.pairTail
        .then(() =>
          this.processPair(
            generation,
            previousTexture,
            currentTexture,
            previousDisplayAt,
            currentDisplayAt,
            capturedAt,
            thumbnail,
            queued
          )
        )
        .catch((error) => {
          this.onWarning?.('Frame interpolation pair failed', error)
        })
        .finally(() => {
          this.release(previousTexture)
          this.release(currentTexture)
        })
    } else {
      // No pair to classify yet, but this thumbnail is the right reference for
      // the next pair. Chained onto the same tail so the pair that follows
      // always classifies against it rather than against "unknown" — otherwise
      // the first change after every seek would be forced to interpolate even
      // when it is a held drawing.
      const generation = this.generation
      this.pairTail = this.pairTail
        .then(async () => {
          const bitmap = await thumbnail
          try {
            if (this.destroyed || generation !== this.generation) return
            this.classifyThumbnail(bitmap)
          } finally {
            bitmap?.close()
          }
        })
        .catch(() => undefined)
    }

    if (this.lastTexture) this.release(this.lastTexture)
    this.lastTexture = currentTexture
    this.lastDisplayAt = currentDisplayAt
    this.retain(currentTexture)
    return true
  }

  private async processPair(
    generation: number,
    previousTexture: GPUTexture,
    currentTexture: GPUTexture,
    previousDisplayAt: number,
    currentDisplayAt: number,
    capturedAt: number,
    thumbnail: Promise<ImageBitmap | null>,
    queued: QueuedFrame
  ): Promise<void> {
    const startedAt = performance.now()
    this.tally.queueWaitTotal += startedAt - capturedAt
    this.tally.queueWaitSamples += 1
    const bitmap = await thumbnail
    try {
      if (this.destroyed || generation !== this.generation) {
        this.tally.stale += 1
        return
      }

      // Classify first: the verdict decides two independent things. Whether to
      // interpolate this pair is time-sensitive; whether the *source* frame is
      // worth an Anime4K pass at all is not. A held drawing must be elided even
      // while interpolation is bypassed — elision removes GPU work, which is
      // exactly what a bypass is waiting for, so skipping it there would
      // re-add the redundant passes at the worst moment.
      const classifyStartedAt = performance.now()
      const classification = this.classifyThumbnail(bitmap)
      const classifyMs = performance.now() - classifyStartedAt
      this.tally.classifyTotal += classifyMs
      this.tally.classifySamples += 1
      this.tally.classifyMax = Math.max(this.tally.classifyMax, classifyMs)

      if (classification.duplicate) {
        this.tally.duplicate += 1
        // The drawing is held: the canvas already shows this exact picture, so
        // the Anime4K chain can skip the frame entirely. Held drawings are
        // 50-70% of an anime source, which is most of the chain's work — and
        // freeing that is what lets the interpolated sub-frames fit.
        queued.elide = true
        this.tally.elided += 1
        return
      }
      if (classification.sceneCut) {
        this.tally.sceneCut += 1
        return
      }
      if (performance.now() < this.overload.bypassUntil) {
        this.tally.bypassed += 1
        return
      }
      if (!shouldInterpolateInterval(this.intervalMs)) {
        this.tally.cadence += 1
        return
      }

      // Drop stale work before doing any GPU work. Otherwise a brief slowdown
      // creates an unbounded pair backlog where every result arrives too late,
      // so interpolation can never catch up to live playback. Timed here, after
      // the thumbnail await, because that is the point of no return.
      if ((previousDisplayAt + currentDisplayAt) / 2 <= performance.now() + 4) {
        this.tally.late += 1
        this.recordPairOutcome('late')
        return
      }

      // Choose how many frames to synthesize for this pair. Explicit multiplier
      // is constant; a target-fps request adapts to the live source cadence.
      // The adaptive ceiling can lower it below the request under load.
      const sourceFps = this.intervalMs > 0 ? 1000 / this.intervalMs : 0
      const factor = Math.min(
        resolveInterpolationFactor(
          this.factorOptions,
          sourceFps,
          this.maxFactor
        ),
        this.overload.factorCeiling
      )

      // Acquire a mid texture and compute the display time for each sub-frame at
      // t = k/factor. Skip sub-frames that are already stale.
      const now = performance.now()
      this.tally.slackTotal +=
        previousDisplayAt +
        (currentDisplayAt - previousDisplayAt) / factor -
        now
      this.tally.slackSamples += 1
      const generated: { texture: GPUTexture; t: number; displayAt: number }[] =
        []
      for (let k = 1; k < factor; k++) {
        const t = k / factor
        const subDisplayAt =
          previousDisplayAt + (currentDisplayAt - previousDisplayAt) * t
        if (subDisplayAt <= now + 4) continue
        const texture = this.acquireTexture(this.midTextures, 'midIndex')
        if (!texture) break // pool exhausted — present what we have
        generated.push({ texture, t, displayAt: subDisplayAt })
      }
      if (generated.length === 0) {
        // Every sub-frame missed its slot, or the mid pool was empty: this pair
        // cost GPU time and produced nothing displayable.
        this.tally.late += 1
        this.recordPairOutcome('late')
        return
      }
      this.tally.produced += 1
      this.tally.enqueued += generated.length
      this.recordPairOutcome('timely')

      this.runtime.prepPair(previousTexture, currentTexture)
      for (const frame of generated) {
        this.runtime.runT(frame.t, frame.texture)
        this.enqueue(frame.texture, frame.displayAt, true)
      }

      void this.device.queue
        .onSubmittedWorkDone()
        .then(() => {
          if (this.destroyed) return
          this.generatedFrames += generated.length
          this.onFrameGenerated?.(this.generatedFrames)
        })
        .catch(() => undefined)
    } finally {
      bitmap?.close()
    }
  }

  /**
   * Compare the new thumbnail against the last *presented* drawing and decide
   * whether this frame is worth an Anime4K pass. The reference is deliberately
   * not the previous frame but the previous frame we actually showed: elided
   * frames are, by definition, within the repeat threshold of their
   * predecessor, so comparing frame-to-frame would let a slow fade or a
   * creeping pan walk out of the threshold in small steps that each look like a
   * repeat while the picture on screen drifts.
   *
   * The first pair after a seek has nothing to compare against and is reported
   * as a change, which is the safe default: a false "changed" only costs GPU
   * work, while a false "held" would freeze a frame.
   */
  private classifyThumbnail(
    bitmap: ImageBitmap | null
  ): FrameDifferenceClassification {
    if (!bitmap) {
      return { duplicate: false, sceneCut: false, mean: 0, maximum: 0 }
    }
    this.classifyContext.drawImage(
      bitmap,
      0,
      0,
      CLASSIFY_WIDTH,
      CLASSIFY_HEIGHT
    )
    const current = this.classifyContext.getImageData(
      0,
      0,
      CLASSIFY_WIDTH,
      CLASSIFY_HEIGHT
    ).data
    const reference = this.lastThumbnailData
    const classification = reference
      ? classifyThumbnailDifference(reference, current)
      : { duplicate: false, sceneCut: false, mean: 0, maximum: 0 }
    if (!classification.duplicate) this.lastThumbnailData = current
    return classification
  }

  /**
   * Fold one pair outcome into the overload guard and surface the transition.
   * Timing the queue drain instead would attribute the Anime4K passes that
   * share this GPU queue to interpolation and degrade it on every loaded GPU.
   */
  private recordPairOutcome(outcome: InterpolationPairOutcome): void {
    const previous = this.overload
    this.overload = updateInterpolationOverload(
      previous,
      outcome,
      performance.now(),
      { maxFactor: this.maxFactor }
    )
    if (this.overload.bypassUntil > previous.bypassUntil) {
      this.tally.bypassArms += 1
      this.onWarning?.(
        'Frame interpolation is temporarily bypassed because the GPU is saturated'
      )
    }
  }

  /** Cumulative pair accounting (see FrameInterpolationStats). */
  public getStats(): FrameInterpolationStats {
    const t = this.tally
    const mean = (total: number, samples: number) =>
      samples > 0 ? total / samples : 0
    return {
      produced: t.produced,
      generatedFrames: t.enqueued,
      duplicate: t.duplicate,
      elided: t.elided,
      sceneCut: t.sceneCut,
      cadence: t.cadence,
      late: t.late,
      bypassed: t.bypassed,
      stale: t.stale,
      poolSaturated: t.poolSaturated,
      bypassArms: t.bypassArms,
      maxFactor: this.maxFactor,
      factorCeiling: this.overload.factorCeiling,
      averageQueueWaitMs: mean(t.queueWaitTotal, t.queueWaitSamples),
      averageClassifyMs: mean(t.classifyTotal, t.classifySamples),
      maximumClassifyMs: t.classifyMax,
      averageSlackMs: mean(t.slackTotal, t.slackSamples),
    }
  }

  public takeDueFrame(now = performance.now()): InterpolationFrame | null {
    if (this.destroyed || this.queue.length === 0) return null
    this.queue.sort((a, b) => a.displayAt - b.displayAt)
    let dueIndex = -1
    for (let index = 0; index < this.queue.length; index++) {
      if (this.queue[index].displayAt <= now) dueIndex = index
      else break
    }
    if (dueIndex < 0) return null

    const dueFrames = this.queue.splice(0, dueIndex + 1)
    // A repeat frame is a picture the canvas already shows (see QueuedFrame.elide),
    // so the newest *non-elided* due frame is the only one worth an Anime4K pass.
    // Skipping them is what keeps a high Anime4K tier affordable: the held
    // drawings cost nothing instead of costing a full chain each.
    let selected: QueuedFrame | null = null
    for (const frame of dueFrames) {
      if (frame.elide) {
        this.release(frame.texture)
        continue
      }
      if (selected) this.release(selected.texture)
      selected = frame
    }
    if (!selected) return null

    let released = false
    return {
      texture: selected.texture,
      generated: selected.generated,
      release: () => {
        if (released) return
        released = true
        this.release(selected.texture)
      },
    }
  }

  public destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.video.removeEventListener('seeking', this.handleSeeking)
    this.resetTimeline()
    try {
      this.runtime.destroy()
    } catch {
      // Best-effort cleanup during device loss or extension teardown.
    }
    for (const texture of this.sourceTextures) texture.destroy()
    for (const texture of this.midTextures) texture.destroy()
    this.captureTexture.destroy()
  }
}

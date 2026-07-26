import type {
  Dimensions,
  FrameInterpolationOptions,
  FrameInterpolationResolution,
} from '../types'

const ALIGNMENT = 16
const SOURCE_POOL_SIZE = 8
/** Hard ceiling on the interpolation factor (quality/GPU-cost guard). */
const MAX_INTERPOLATION_FACTOR = 8
/** Lowest source fps assumed when sizing pools for a target-fps request. */
const MIN_ASSUMED_SOURCE_FPS = 20
const DEDUP_SAMPLE_WIDTH = 48
const DEDUP_SAMPLE_HEIGHT = 27
const DEDUP_SAMPLE_COUNT = DEDUP_SAMPLE_WIDTH * DEDUP_SAMPLE_HEIGHT
const DEDUP_ZERO = new Uint32Array(2)
const MIN_PROCESSING_DELAY_MS = 20
const MAX_PROCESSING_DELAY_MS = 50
const INTERPOLATION_COMPUTE_LEAD_MS = 8

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

const differenceShader = `
@group(0) @binding(0) var previousTexture: texture_2d<f32>;
@group(0) @binding(1) var currentTexture: texture_2d<f32>;
@group(0) @binding(2) var sourceSampler: sampler;
@group(0) @binding(3) var<storage, read_write> stats: array<atomic<u32>, 2>;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x >= ${DEDUP_SAMPLE_WIDTH}u || id.y >= ${DEDUP_SAMPLE_HEIGHT}u) {
    return;
  }
  let uv = (vec2<f32>(f32(id.x), f32(id.y)) + 0.5) /
    vec2<f32>(${DEDUP_SAMPLE_WIDTH}.0, ${DEDUP_SAMPLE_HEIGHT}.0);
  let previous = textureSampleLevel(previousTexture, sourceSampler, uv, 0.0).rgb;
  let current = textureSampleLevel(currentTexture, sourceSampler, uv, 0.0).rgb;
  let difference = u32(dot(abs(previous - current), vec3<f32>(255.0)));
  atomicAdd(&stats[0], difference);
  atomicMax(&stats[1], difference);
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

type QueuedFrame = {
  texture: GPUTexture
  displayAt: number
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
  return {
    width: alignDown(Math.max(1, source.width * scale)),
    height: alignDown(Math.max(1, source.height * scale)),
  }
}

export function classifyDifferenceStats(
  sum: number,
  maximum: number,
  sampleCount = DEDUP_SAMPLE_COUNT
): FrameDifferenceClassification {
  const mean = sum / Math.max(1, sampleCount)
  return {
    duplicate: mean < 2.5 && maximum < 45,
    sceneCut: mean > 90,
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

export function shouldInterpolateInterval(intervalMs: number): boolean {
  // The first release targets 24/25/30 fps video. At >=45 fps a 2x stream
  // cannot be displayed on the common 60 Hz path and only adds GPU pressure.
  return intervalMs >= 22 && intervalMs <= 100
}

export function calculateFrameProcessingDelay(intervalMs: number): number {
  return Math.min(
    MAX_PROCESSING_DELAY_MS,
    Math.max(
      MIN_PROCESSING_DELAY_MS,
      intervalMs / 2 + INTERPOLATION_COMPUTE_LEAD_MS
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
  private readonly differencePipeline: GPUComputePipeline
  private readonly differenceSampler: GPUSampler
  private readonly differenceStats: GPUBuffer
  private readonly differenceReadback: GPUBuffer
  private readonly differenceBindGroups = new Map<string, GPUBindGroup>()

  private lastTexture: GPUTexture | null = null
  private lastDisplayAt = 0
  private lastArrival = 0
  private lastMediaTime: number | null = null
  private lastExpectedDisplayTime: number | null = null
  private lastPresentedFrames: number | null = null
  private intervalMs = 1000 / 30
  private sourceIndex = 0
  private midIndex = 0
  private pairTail: Promise<void> = Promise.resolve()
  private generation = 0
  private destroyed = false
  private interpolationCostMs = 0
  private overloadSamples = 0
  private skipInterpolationUntil = 0
  private lastSourcePoolWarningAt = 0
  private generatedFrames = 0

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
    this.maxFactor = computeMaxInterpolationFactor(this.factorOptions)

    this.sourceTextures = Array.from({ length: SOURCE_POOL_SIZE }, (_, index) =>
      this.createFrameTexture(
        `danmaku-anywhere-framegen-source-${index}`,
        false
      )
    )
    // Each source pair may enqueue up to (maxFactor - 1) generated frames, and a
    // couple of pairs can be in flight, so scale the pool with the factor.
    const midPoolSize = Math.max(4, (this.maxFactor - 1) * 3 + 2)
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

    this.differenceSampler = this.device.createSampler({
      magFilter: 'linear',
      minFilter: 'linear',
    })
    this.differenceStats = this.device.createBuffer({
      size: 8,
      usage:
        GPUBufferUsage.STORAGE |
        GPUBufferUsage.COPY_DST |
        GPUBufferUsage.COPY_SRC,
    })
    this.differenceReadback = this.device.createBuffer({
      size: 8,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    })
    this.differencePipeline = this.device.createComputePipeline({
      layout: 'auto',
      compute: {
        module: this.device.createShaderModule({ code: differenceShader }),
        entryPoint: 'main',
      },
    })
  }

  public static async create(
    options: FrameInterpolatorCreateOptions
  ): Promise<FrameInterpolator> {
    if (!options.device.features.has('shader-f16')) {
      throw new Error('Frame interpolation requires WebGPU shader-f16 support')
    }

    const dimensions = calculateInterpolationDimensions(
      { width: options.video.videoWidth, height: options.video.videoHeight },
      options.options.resolution,
      options.maxTextureDimension
    )
    if (dimensions.width < ALIGNMENT || dimensions.height < ALIGNMENT) {
      throw new Error('Video dimensions are too small for frame interpolation')
    }

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
    return new FrameInterpolator(options, runtime, dimensions)
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

  private enqueue(texture: GPUTexture, displayAt: number): void {
    this.retain(texture)
    this.queue.push({ texture, displayAt })
  }

  private resetTimeline(): void {
    this.generation++
    for (const queued of this.queue) this.release(queued.texture)
    this.queue.length = 0
    if (this.lastTexture) this.release(this.lastTexture)
    this.lastTexture = null
    this.lastDisplayAt = 0
    this.lastArrival = 0
    this.lastMediaTime = null
    this.lastExpectedDisplayTime = null
    this.lastPresentedFrames = null
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
    if (
      isMediaTimelineDiscontinuity({
        previousMediaTime: this.lastMediaTime,
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
      if (arrival - this.lastSourcePoolWarningAt >= 2000) {
        this.lastSourcePoolWarningAt = arrival
        this.onWarning?.('Frame interpolation source pool is saturated')
      }
      return false
    }

    this.capture(currentTexture)
    const cadenceAt = timing.expectedDisplayTime ?? arrival
    if (this.lastArrival > 0) {
      const delta = cadenceAt - this.lastArrival
      if (delta > 5 && delta < 500) {
        this.intervalMs = this.intervalMs * 0.85 + delta * 0.15
      }
    }
    this.lastArrival = cadenceAt

    const currentDisplayAt =
      cadenceAt + calculateFrameProcessingDelay(this.intervalMs)
    this.enqueue(currentTexture, currentDisplayAt)

    const previousTexture = this.lastTexture
    const previousDisplayAt = this.lastDisplayAt
    if (previousTexture) {
      this.retain(previousTexture)
      this.retain(currentTexture)
      const generation = this.generation
      this.pairTail = this.pairTail
        .then(() =>
          this.processPair(
            generation,
            previousTexture,
            currentTexture,
            previousDisplayAt,
            currentDisplayAt
          )
        )
        .catch((error) => {
          this.onWarning?.('Frame interpolation pair failed', error)
        })
        .finally(() => {
          this.release(previousTexture)
          this.release(currentTexture)
        })
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
    currentDisplayAt: number
  ): Promise<void> {
    if (
      this.destroyed ||
      generation !== this.generation ||
      performance.now() < this.skipInterpolationUntil
    ) {
      return
    }

    const displayAt = (previousDisplayAt + currentDisplayAt) / 2
    // Drop stale work before the GPU readback. Otherwise a brief classification
    // slowdown creates an unbounded pair backlog where every result arrives too
    // late, so interpolation can never catch up to live playback.
    if (displayAt <= performance.now() + 4) return

    const classification = await this.classifyPair(
      previousTexture,
      currentTexture
    )
    if (
      this.destroyed ||
      generation !== this.generation ||
      classification.duplicate ||
      classification.sceneCut ||
      !shouldInterpolateInterval(this.intervalMs)
    ) {
      return
    }

    // Choose how many frames to synthesize for this pair. Explicit multiplier is
    // constant; a target-fps request adapts to the live source cadence.
    const sourceFps = this.intervalMs > 0 ? 1000 / this.intervalMs : 0
    const factor = resolveInterpolationFactor(
      this.factorOptions,
      sourceFps,
      this.maxFactor
    )

    // Acquire a mid texture and compute the display time for each sub-frame at
    // t = k/factor. Skip sub-frames that are already stale.
    const now = performance.now()
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
    if (generated.length === 0) return

    const startedAt = performance.now()
    this.runtime.prepPair(previousTexture, currentTexture)
    for (const frame of generated) {
      this.runtime.runT(frame.t, frame.texture)
      this.enqueue(frame.texture, frame.displayAt)
    }

    void this.device.queue
      .onSubmittedWorkDone()
      .then(() => {
        if (this.destroyed) return
        this.generatedFrames += generated.length
        this.onFrameGenerated?.(this.generatedFrames)
        const elapsed = performance.now() - startedAt
        this.interpolationCostMs = this.interpolationCostMs
          ? this.interpolationCostMs * 0.8 + elapsed * 0.2
          : elapsed
        // All sub-frames must fit inside the source interval; use the whole
        // budget (higher factors legitimately cost more per pair).
        if (this.interpolationCostMs > this.intervalMs * 0.85) {
          this.overloadSamples++
          if (this.overloadSamples >= 3) {
            this.skipInterpolationUntil = performance.now() + 2000
            this.overloadSamples = 0
            this.onWarning?.(
              'Frame interpolation is temporarily bypassed because the GPU is saturated'
            )
          }
        } else {
          this.overloadSamples = Math.max(0, this.overloadSamples - 1)
        }
      })
      .catch(() => undefined)
  }

  private async classifyPair(
    previousTexture: GPUTexture,
    currentTexture: GPUTexture
  ): Promise<FrameDifferenceClassification> {
    const key = `${previousTexture.label}|${currentTexture.label}`
    let bindGroup = this.differenceBindGroups.get(key)
    if (!bindGroup) {
      bindGroup = this.device.createBindGroup({
        layout: this.differencePipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: previousTexture.createView() },
          { binding: 1, resource: currentTexture.createView() },
          { binding: 2, resource: this.differenceSampler },
          { binding: 3, resource: { buffer: this.differenceStats } },
        ],
      })
      this.differenceBindGroups.set(key, bindGroup)
    }

    this.device.queue.writeBuffer(this.differenceStats, 0, DEDUP_ZERO)
    const encoder = this.device.createCommandEncoder()
    const pass = encoder.beginComputePass()
    pass.setPipeline(this.differencePipeline)
    pass.setBindGroup(0, bindGroup)
    pass.dispatchWorkgroups(6, 4)
    pass.end()
    encoder.copyBufferToBuffer(
      this.differenceStats,
      0,
      this.differenceReadback,
      0,
      8
    )
    this.device.queue.submit([encoder.finish()])
    await this.differenceReadback.mapAsync(GPUMapMode.READ)
    const values = new Uint32Array(
      this.differenceReadback.getMappedRange().slice(0)
    )
    this.differenceReadback.unmap()
    return classifyDifferenceStats(values[0], values[1])
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
    const selected = dueFrames.at(-1)
    if (!selected) return null
    for (let index = 0; index < dueFrames.length - 1; index++) {
      this.release(dueFrames[index].texture)
    }
    let released = false
    return {
      texture: selected.texture,
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
    this.differenceStats.destroy()
    this.differenceReadback.destroy()
  }
}

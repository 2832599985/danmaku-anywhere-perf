import type { Anime4KPipeline } from 'anime4k-webgpu'
import type { Dimensions, EnhancementEffect } from '../types'
import { waitForVideoReady } from '../utils/video-ready'

type DestroyablePipeline = Anime4KPipeline & { destroy?: () => void }

/**
 * 一套与特定源分辨率绑定的完整渲染资源：
 * 输入纹理 + 效果链管线 + 最终绘制绑定组。三者互相引用，必须整体换入换出。
 */
type PipelineSet = {
  videoFrameTexture: GPUTexture
  pipelines: Anime4KPipeline[]
  renderBindGroup: GPUBindGroup
}
type Anime4KEffectConstructor = new (options: {
  device: GPUDevice
  inputTexture: GPUTexture
  nativeDimensions: Dimensions
  targetDimensions: Dimensions
}) => Anime4KPipeline

import { RendererInitializationError, RendererRuntimeError } from './errors'

/**
 * 全屏纹理四边形顶点着色器
 * 定义顶点位置和UV坐标，用于渲染全屏纹理
 */
const fullscreenTexturedQuadWGSL = `
struct VertexOutput {
  @builtin(position) Position : vec4<f32>,
  @location(0) fragUV : vec2<f32>,
}

@vertex
fn vert_main(@builtin(vertex_index) VertexIndex : u32) -> VertexOutput {
  const pos = array(
    vec2( 1.0,  1.0),  // 右上
    vec2( 1.0, -1.0),  // 右下
    vec2(-1.0, -1.0),  // 左下
    vec2( 1.0,  1.0),  // 右上 (重复)
    vec2(-1.0, -1.0),  // 左下 (重复)
    vec2(-1.0,  1.0),  // 左上
  );

  const uv = array(
    vec2(1.0, 0.0),  // 右上UV
    vec2(1.0, 1.0),  // 右下UV
    vec2(0.0, 1.0),  // 左下UV
    vec2(1.0, 0.0),  // 右上UV (重复)
    vec2(0.0, 1.0),  // 左下UV (重复)
    vec2(0.0, 0.0),  // 左上UV
  );

  var output : VertexOutput;
  output.Position = vec4(pos[VertexIndex], 0.0, 1.0);
  output.fragUV = uv[VertexIndex];
  return output;
}
`

/**
 * 纹理采样片段着色器
 * 从纹理中采样颜色值并输出到屏幕
 */
const sampleExternalTextureWGSL = `
@group(0) @binding(1) var mySampler: sampler;
@group(0) @binding(2) var myTexture: texture_2d<f32>;

@fragment
fn main(@location(0) fragUV : vec2f) -> @location(0) vec4f {
  // 使用基础边缘钳制采样纹理
  return textureSampleBaseClampToEdge(myTexture, mySampler, fragUV);
}
`

/**
 * RendererOptions 定义了创建 Renderer 实例所需的配置项
 */
export interface RendererOptions {
  /** 视频播放器元素 */
  video: HTMLVideoElement
  /** 用于渲染的 Canvas 元素 */
  canvas: HTMLCanvasElement
  /** 要应用的增强效果数组 */
  effects: EnhancementEffect[]
  /** 渲染的目标分辨率 */
  targetDimensions: Dimensions
  /** Decouple canvas presentation from video callbacks by default. */
  presentationMode?: RendererPresentationMode
  /** 发生运行时错误时的回调函数 */
  onError?: (error: Error) => void
  /** 成功渲染第一帧时的回调函数 */
  onFirstFrameRendered?: () => void
  /** 初始化进度回调函数 */
  onProgress?: (stage: string | null, current?: number, total?: number) => void
  /** Optional diagnostics. Defaults preserve the production render path. */
  diagnostics?: RendererDiagnosticsOptions
  onDiagnostics?: (summary: RendererDiagnosticsSummary) => void
}

export type RendererDiagnosticMode =
  | 'full'
  | 'copy-only'
  | 'canvas-only'
  | 'freeze-input'

export type RendererPresentationMode = 'rvfc' | 'raf'

export interface RendererDiagnosticsOptions {
  mode?: RendererDiagnosticMode
  inputTextureFormat?: 'rgba16float' | 'rgba8unorm'
  earlyResubscribe?: boolean
  reportIntervalMs?: number
  queueProbeEveryFrames?: number
}

export interface RendererDiagnosticsSummary {
  mode: RendererDiagnosticMode
  inputTextureFormat: 'rgba16float' | 'rgba8unorm'
  presentationMode: RendererPresentationMode
  frames: number
  presentedFrameGaps: number
  rendererBusyDrops: number
  lateCallbacks: number
  averageHeadroomMs: number
  minimumHeadroomMs: number
  averageCallbackDeltaMs: number
  maximumCallbackDeltaMs: number
  averageCopyCallMs: number
  maximumCopyCallMs: number
  averageEncodeMs: number
  maximumEncodeMs: number
  averageSubmitMs: number
  maximumSubmitMs: number
  averageCpuFrameMs: number
  maximumCpuFrameMs: number
  latestQueueDrainMs: number | null
  videoDroppedFrames: number
  videoTotalFrames: number
}

/**
 * Renderer 类封装了所有与 WebGPU 相关的渲染逻辑。
 * 它负责管理 GPU 设备、上下文、渲染管线、纹理和渲染循环。
 */
export class Renderer {
  // --- 核心属性 ---
  private video: HTMLVideoElement
  private canvas: HTMLCanvasElement
  private effects: EnhancementEffect[]
  private targetDimensions: Dimensions
  private onError?: (error: Error) => void
  private onFirstFrameRendered?: () => void
  private onProgress?: (
    stage: string | null,
    current?: number,
    total?: number
  ) => void
  private readonly diagnostics: Required<RendererDiagnosticsOptions>
  private readonly diagnosticsEnabled: boolean
  private readonly presentationMode: RendererPresentationMode
  private readonly onDiagnostics?: (summary: RendererDiagnosticsSummary) => void
  private hasCopiedInputFrame = false
  private hasProcessedFrame = false
  private hasPresentedFirstFrame = false
  private processedFrameGeneration = 0
  private presentedFrameGeneration = -1
  private frameInFlight = false
  private diagnosticsWindowStartedAt = performance.now()
  private diagnosticsFrames = 0
  private diagnosticsPresentedFrameGaps = 0
  private diagnosticsBusyDrops = 0
  private diagnosticsLateCallbacks = 0
  private diagnosticsHeadroomTotal = 0
  private diagnosticsHeadroomMin = Number.POSITIVE_INFINITY
  private diagnosticsCallbackDeltaTotal = 0
  private diagnosticsCallbackDeltaMax = 0
  private diagnosticsCopyTotal = 0
  private diagnosticsCopyMax = 0
  private diagnosticsEncodeTotal = 0
  private diagnosticsEncodeMax = 0
  private diagnosticsSubmitTotal = 0
  private diagnosticsSubmitMax = 0
  private diagnosticsCpuTotal = 0
  private diagnosticsCpuMax = 0
  private diagnosticsLastCallbackAt: number | null = null
  private diagnosticsLastPresentedFrames: number | null = null
  private diagnosticsLatestQueueDrainMs: number | null = null
  private diagnosticsQueueProbePending = false

  // --- 状态标志 ---
  private destroyed = false
  private animationFrameId: number | null = null
  private presentationAnimationFrameId: number | null = null
  /** 是否使用 ImageBitmap 作为回退方案来复制视频帧 */
  private useImageBitmapFallback = false
  /** 在单次渲染循环中是否已尝试过自动修复 */
  private fixAttempted = false
  private lastError: Error | null = null
  // 正在进行的源尺寸重建；渲染循环在此期间必须跳帧（见 processFrame）
  private resizePromise: Promise<void> | null = null
  /** 是否正在恢复设备（设备丢失后的自动恢复） */
  private isRecovering = false

  // --- WebGPU 对象 ---
  private device!: GPUDevice
  private context!: GPUCanvasContext
  private presentationFormat!: GPUTextureFormat
  /** 用于从视频帧复制图像数据的中间纹理 */
  private videoFrameTexture!: GPUTexture
  /** 效果处理管线链 */
  private pipelines: Anime4KPipeline[] = []
  /**
   * 按源分辨率缓存的整套管线。自适应码率在固定几档清晰度间来回切换
   * （如 1080p→720p→1080p），每次切换原本都要完整重建：逐效果编译着色器
   * + 预热，期间渲染循环持续跳帧、画面停顿数百毫秒。缓存后切回见过的
   * 分辨率零重建。键为 `${srcW}x${srcH}`；效果链/目标分辨率/设备任一
   * 变化即整体失效（见 clearPipelineCache 调用点）。
   */
  private pipelineCache = new Map<string, PipelineSet>()
  /** 缓存容量上限。每套管线持有整链中间纹理（VRAM 数十至数百 MB），从紧。 */
  private static readonly MAX_CACHED_PIPELINE_SETS = 3
  /** 设备支持的最大 2D 纹理边长，用于把目标分辨率钳制在 GPU 能力内 */
  private maxTextureDimension = 8192
  /** 连续渲染失败计数，触发熔断以防止无限刷错卡死页面 */
  private consecutiveFailures = 0
  /** 连续失败达到此阈值即熔断停止渲染循环 */
  private static readonly MAX_CONSECUTIVE_FAILURES = 60

  // --- 最终渲染阶段的对象 ---
  private renderBindGroupLayout!: GPUBindGroupLayout
  private renderPipeline!: GPURenderPipeline
  private sampler!: GPUSampler
  private renderBindGroup!: GPUBindGroup

  // --- 静态属性，用于确保只检测一次 ---
  private static hasCheckedWebGPUFeatures = false
  private static webgpuFeatureCheckPromise: Promise<boolean> | null = null
  /** 缓存的 anime4k-webgpu 模块（避免重复动态导入） */
  private static cachedAnime4KModule: typeof import('anime4k-webgpu') | null =
    null

  /**
   * Renderer 的构造函数是私有的，请使用 `Renderer.create()` 静态方法来创建实例。
   * @param options - 初始化渲染器所需的配置
   */
  private constructor(options: RendererOptions) {
    this.video = options.video
    this.canvas = options.canvas
    this.effects =
      options.diagnostics?.mode === 'copy-only' ||
      options.diagnostics?.mode === 'canvas-only'
        ? []
        : options.effects
    this.targetDimensions = options.targetDimensions
    this.onError = options.onError
    this.onFirstFrameRendered = options.onFirstFrameRendered
    this.onProgress = options.onProgress
    this.diagnostics = {
      mode: options.diagnostics?.mode ?? 'full',
      inputTextureFormat:
        options.diagnostics?.inputTextureFormat ?? 'rgba16float',
      earlyResubscribe: options.diagnostics?.earlyResubscribe ?? false,
      reportIntervalMs: options.diagnostics?.reportIntervalMs ?? 1000,
      queueProbeEveryFrames: options.diagnostics?.queueProbeEveryFrames ?? 30,
    }
    this.diagnosticsEnabled = options.diagnostics !== undefined
    this.presentationMode = options.presentationMode ?? 'raf'
    this.onDiagnostics = options.onDiagnostics
  }

  /**
   * 创建并异步初始化一个新的 Renderer 实例。
   * 这是实例化 Renderer 的首选方法。
   * @param options - 初始化渲染器所需的配置
   * @returns 返回一个 Promise，解析为一个完全初始化的 Renderer 实例
   */
  public static async create(options: RendererOptions): Promise<Renderer> {
    const renderer = new Renderer(options)
    await renderer.initialize()
    return renderer
  }

  /**
   * 初始化 WebGPU 设备、上下文和所有必要的渲染资源。
   */
  private async initialize(): Promise<void> {
    try {
      // 等待视频有当前帧数据（HAVE_CURRENT_DATA 已满足纹理拷贝需求）。
      // 注意：不能用 onloadeddata 属性死等——该事件每个加载周期只触发一次，
      // 且属性赋值会与站点播放器互相覆盖（曾导致按钮永远卡在"启动中"）。
      try {
        await waitForVideoReady(this.video, this.video.HAVE_CURRENT_DATA)
      } catch (waitError) {
        throw new RendererInitializationError(
          (waitError as Error).message || 'Timed out waiting for video data.',
          { cause: waitError as Error }
        )
      }

      // 请求 GPU 适配器，并根据平台设置能效偏好
      this.onProgress?.('initGpu')
      const adapterOptions: GPURequestAdapterOptions = {}
      // 在 Windows 上设置 powerPreference 会产生警告，因此仅在非 Windows 平台使用
      if (!navigator.platform.startsWith('Win')) {
        adapterOptions.powerPreference = 'high-performance'
      }
      const adapter = await navigator.gpu.requestAdapter(adapterOptions)
      if (!adapter) {
        throw new RendererInitializationError(
          'WebGPU not supported: No adapter found.'
        )
      }

      // 请求 GPU 设备并配置 Canvas 上下文
      this.device = await this.requestDeviceWithLimits(adapter)

      // 监听设备丢失事件并尝试自动恢复
      this.device.lost.then((info) => {
        // 如果渲染器已销毁，不需要处理
        if (this.destroyed) return

        console.warn(
          `[Anime4KWebExt] GPU device lost: ${info.reason} - ${info.message}`
        )

        // 尝试自动恢复（仅在非主动销毁的情况下）
        if (info.reason !== 'destroyed' && !this.isRecovering) {
          console.log(
            '[Anime4KWebExt] Attempting to recover from device loss...'
          )
          this.recoverFromDeviceLoss()
        }
      })

      // 检查是否需要使用 ImageBitmap 回退方案
      const supportsVideoTexture = await Renderer.detectWebGPUFeatures()
      this.useImageBitmapFallback = !supportsVideoTexture
      if (this.useImageBitmapFallback) {
        console.log(
          '[Anime4KWebExt] Renderer: Using ImageBitmap fallback for copying video frames.'
        )
      }

      const context = this.canvas.getContext('webgpu')
      if (!context) {
        throw new RendererInitializationError(
          'Failed to get WebGPU context from canvas.'
        )
      }
      this.context = context
      this.presentationFormat = navigator.gpu.getPreferredCanvasFormat()
      this.context.configure({
        device: this.device,
        format: this.presentationFormat,
        // 输出每个像素都不透明（clear a=1 + 全屏四边形覆盖），声明 opaque
        // 可让合成器跳过整幅画布的逐帧透明混合
        alphaMode: 'opaque',
      })

      // 创建初始资源
      this.createResources()
      await this.buildPipelines()
      await this.createRenderPipeline()
      this.createRenderBindGroup()

      // 启动渲染循环，尝试渲染第一帧并启动持续渲染
      this.renderFirstFrameAndStartLoop()
    } catch (error) {
      if (error instanceof RendererInitializationError) {
        throw error
      }
      throw new RendererInitializationError(
        'An unexpected error occurred during renderer initialization.',
        { cause: error as Error }
      )
    }
  }

  /**
   * 请求 GPU 设备，尽可能解锁更高的限制。
   * 关键：显式请求 adapter 支持的 maxTextureDimension2D（默认仅 8192，
   * 但多数硬件支持 16384），并记录该上限用于后续钳制目标分辨率，
   * 避免高倍率 × 高分辨率视频生成超限纹理导致每帧渲染失败、刷错卡死。
   */
  private async requestDeviceWithLimits(
    adapter: GPUAdapter
  ): Promise<GPUDevice> {
    const adapterLimits = adapter.limits
    this.maxTextureDimension = adapterLimits.maxTextureDimension2D || 8192
    return adapter.requestDevice({
      requiredLimits: {
        maxBufferSize: adapterLimits.maxBufferSize,
        maxStorageBufferBindingSize: adapterLimits.maxStorageBufferBindingSize,
        maxTextureDimension2D: this.maxTextureDimension,
      },
    })
  }

  /** 返回设备支持的最大 2D 纹理边长（供上层钳制目标分辨率） */
  public getMaxTextureDimension(): number {
    return this.maxTextureDimension
  }

  /**
   * 把目标分辨率钳制在设备支持的最大纹理边长以内，保持宽高比。
   * 关键防线：高倍率（如 x8）× 已自适应到 1080p 的源 = 15360×8640，
   * 远超默认 8192 上限。超限纹理会让每帧渲染抛 WebGPU 校验错误，
   * 而这些错误是异步、非抛出的——渲染循环无法感知失败，逐帧疯狂重试、
   * 刷爆控制台直至页面卡死。此处提前把输出尺寸压回上限内即可根治。
   */
  private clampDimensionsToDeviceLimit(dims: Dimensions): Dimensions {
    const limit = this.maxTextureDimension
    const maxSide = Math.max(dims.width, dims.height)
    if (maxSide <= limit) {
      return dims
    }
    const scale = limit / maxSide
    const clamped = {
      width: Math.max(1, Math.floor(dims.width * scale)),
      height: Math.max(1, Math.floor(dims.height * scale)),
    }
    console.warn(
      `[Anime4KWebExt] Target ${dims.width}x${dims.height} exceeds GPU texture limit ${limit}, ` +
        `clamping to ${clamped.width}x${clamped.height}.`
    )
    return clamped
  }

  /**
   * 创建（或重新创建）依赖于视频源分辨率的核心资源。
   * 主要是 videoFrameTexture——用于从视频逐帧拷贝像素的中间纹理。
   * 注意：不销毁旧纹理——旧纹理的所有权归调用方处置（源尺寸变化时
   * 已随整套管线移入缓存，设备丢失时随旧设备一并失效）。
   */
  private createResources(): void {
    this.hasProcessedFrame = false
    this.videoFrameTexture = this.device.createTexture({
      size: [this.video.videoWidth, this.video.videoHeight, 1],
      format: this.diagnostics.inputTextureFormat,
      usage:
        GPUTextureUsage.TEXTURE_BINDING | // 可以作为着色器输入
        GPUTextureUsage.COPY_DST | // 可以作为拷贝目的地
        GPUTextureUsage.RENDER_ATTACHMENT, // 可以作为渲染目标
    })
  }

  /** 销毁一套管线资源（效果链 + 输入纹理；绑定组无需显式销毁） */
  private destroyPipelineSet(set: PipelineSet): void {
    for (const p of set.pipelines) {
      try {
        ;(p as DestroyablePipeline).destroy?.()
      } catch {
        // 忽略单个管道销毁错误
      }
    }
    set.videoFrameTexture.destroy()
  }

  /**
   * 把当前整套管线按其源分辨率存入缓存并移交所有权（清空 this.pipelines，
   * 防止后续 buildPipelines 把缓存中的管线当旧管线销毁）。超容量时按
   * 插入序淘汰最旧的一套（命中时取出、再次换出时重新插入，即为 LRU）。
   */
  private stashCurrentPipelineSet(): void {
    if (
      !this.videoFrameTexture ||
      !this.renderBindGroup ||
      this.pipelines.length === 0
    ) {
      return
    }
    const key = `${this.videoFrameTexture.width}x${this.videoFrameTexture.height}`
    const existing = this.pipelineCache.get(key)
    if (existing) {
      // 防御：同尺寸旧条目不应存在，若有则先销毁避免泄漏
      this.pipelineCache.delete(key)
      this.destroyPipelineSet(existing)
    }
    this.pipelineCache.set(key, {
      videoFrameTexture: this.videoFrameTexture,
      pipelines: this.pipelines,
      renderBindGroup: this.renderBindGroup,
    })
    this.pipelines = []
    while (this.pipelineCache.size > Renderer.MAX_CACHED_PIPELINE_SETS) {
      const oldestKey = this.pipelineCache.keys().next().value
      if (oldestKey === undefined) break
      const oldest = this.pipelineCache.get(oldestKey)
      this.pipelineCache.delete(oldestKey)
      if (oldest) this.destroyPipelineSet(oldest)
    }
  }

  /** 清空管线缓存。效果链、目标分辨率或 GPU 设备变化后，旧管线全部失效。 */
  private clearPipelineCache(): void {
    for (const set of this.pipelineCache.values()) {
      this.destroyPipelineSet(set)
    }
    this.pipelineCache.clear()
  }

  /**
   * 根据当前的效果链（this.effects）构建 Anime4K 处理管线。
   * 此方法会销毁旧管线并创建新管线。
   */
  private async buildPipelines(): Promise<void> {
    // 关键防线：把目标分辨率钳制到 GPU 纹理上限内，避免超限纹理导致逐帧
    // 校验失败、无限重试卡死页面。钳制后写回 this.targetDimensions，
    // 使后续所有效果、Downscale 中间尺寸计算都基于安全值。
    this.targetDimensions = this.clampDimensionsToDeviceLimit(
      this.targetDimensions
    )

    // Canvas 绘制缓冲本身也是一张 GPU 纹理，同样受 maxTextureDimension2D 约束。
    // 上层（video-enhancer）按未钳制的目标尺寸设置了 canvas.width/height，
    // 若超限，context.getCurrentTexture() 会逐帧抛校验错误。此处以钳制后的
    // 尺寸校正 canvas 缓冲，让渲染器成为 canvas 尺寸的最终权威。
    // 仅在不一致时写入——设置 canvas.width/height 会清空并重置绘制缓冲。
    if (
      this.canvas.width !== this.targetDimensions.width ||
      this.canvas.height !== this.targetDimensions.height
    ) {
      this.canvas.width = this.targetDimensions.width
      this.canvas.height = this.targetDimensions.height
    }

    // 等待 GPU 队列完成后再销毁旧管道，避免资源竞争
    try {
      await this.device.queue.onSubmittedWorkDone()
    } catch {
      // 忽略错误，设备可能已丢失
    }

    // 安全销毁旧管道
    for (const p of this.pipelines) {
      try {
        ;(p as DestroyablePipeline).destroy?.()
      } catch {
        // 忽略单个管道销毁错误
      }
    }

    const pipelines: Anime4KPipeline[] = []
    let currentTexture = this.videoFrameTexture
    let curWidth = this.video.videoWidth
    let curHeight = this.video.videoHeight

    // 使用缓存的模块，避免重复动态导入
    if (!Renderer.cachedAnime4KModule) {
      Renderer.cachedAnime4KModule = await import('anime4k-webgpu')
    }
    const anime4kModule = Renderer.cachedAnime4KModule

    // 如果需要，获取 Downscale 类
    const needsDownscaling = this.effects.some((effect, i) => {
      const remainingFactor = this.effects
        .slice(i + 1)
        .reduce((acc, val) => acc * (val.upscaleFactor ?? 1), 1)
      return (effect.upscaleFactor ?? 1) > 1 && remainingFactor > 1
    })
    const DownscaleClass = needsDownscaling ? anime4kModule.Downscale : null

    const upscaleFactors = this.effects.map((e) => e.upscaleFactor ?? 1)
    const remainingUpscaleFactors = upscaleFactors.map((_, i) =>
      upscaleFactors.slice(i + 1).reduce((acc, val) => acc * val, 1)
    )

    for (let i = 0; i < this.effects.length; i++) {
      // 报告预热进度
      this.onProgress?.('loadingEffect', i + 1, this.effects.length)

      // 让出主线程，避免界面冻结
      await new Promise((resolve) => setTimeout(resolve, 0))

      const effect = this.effects[i]
      // 从缓存的模块获取效果类
      const EffectClass = (
        anime4kModule as unknown as Record<
          string,
          Anime4KEffectConstructor | undefined
        >
      )[effect.className]

      if (EffectClass) {
        const pipeline = new EffectClass({
          device: this.device,
          inputTexture: currentTexture,
          nativeDimensions: { width: curWidth, height: curHeight },
          targetDimensions: this.targetDimensions,
        })
        pipelines.push(pipeline)

        currentTexture = pipeline.getOutputTexture()

        if (effect.upscaleFactor) {
          curWidth *= effect.upscaleFactor
          curHeight *= effect.upscaleFactor

          const remainingFactor = remainingUpscaleFactors[i]
          if (DownscaleClass && remainingFactor > 1) {
            const idealIntermediateWidth =
              this.targetDimensions.width / remainingFactor
            const idealIntermediateHeight =
              this.targetDimensions.height / remainingFactor

            if (curWidth > idealIntermediateWidth * 1.1) {
              // 再次让出主线程
              await new Promise((resolve) => setTimeout(resolve, 0))

              const intermediateDownscale = new DownscaleClass({
                device: this.device,
                inputTexture: currentTexture,
                targetDimensions: {
                  width: Math.ceil(idealIntermediateWidth),
                  height: Math.ceil(idealIntermediateHeight),
                },
              })
              pipelines.push(intermediateDownscale)

              currentTexture = intermediateDownscale.getOutputTexture()
              curWidth = Math.ceil(idealIntermediateWidth)
              curHeight = Math.ceil(idealIntermediateHeight)
            }
          }
        }
      } else {
        console.warn(
          `[Anime4KWebExt] Effect class "${effect.className}" not found in anime4k-webgpu module.`
        )
      }
    }

    // === 整链一次性预热：单次提交跑完全部 pass，只做一次 CPU⇄GPU 同步 ===
    // 预热的目的只是逼驱动提前编译着色器；原先逐效果 submit +
    // onSubmittedWorkDone，5 个效果就是 5 次串行全队列往返，合并后
    // 编译触发效果相同，重建耗时显著缩短。
    if (pipelines.length > 0) {
      try {
        const commandEncoder = this.device.createCommandEncoder()
        for (const pipeline of pipelines) {
          pipeline.pass(commandEncoder)
        }
        this.device.queue.submit([commandEncoder.finish()])
        await this.device.queue.onSubmittedWorkDone()
      } catch (e) {
        console.warn('[Anime4KWebExt] Pipeline warmup failed:', e)
      }
    }

    if (pipelines.length === 0) {
      // 如果没有应用任何效果，则创建一个虚拟管道
      pipelines.push({
        pass: () => {
          // Intentional no-op pipeline when no enhancement effect is selected.
        },
        getOutputTexture: () => this.videoFrameTexture,
        updateParam: () => {
          // Intentional no-op pipeline when no enhancement effect is selected.
        },
      } as unknown as Anime4KPipeline)
    }
    this.pipelines = pipelines

    // 通知预热完成
    this.onProgress?.(null)

    console.log(
      `[Anime4KWebExt] Built ${pipelines.length} pipelines with warmup complete.`
    )
  }

  /**
   * 检测当前环境的 WebGPU 实现是否支持直接从 VideoFrame 复制纹理。
   */
  public static async detectWebGPUFeatures(): Promise<boolean> {
    // 如果已经检测过，直接返回结果
    if (Renderer.hasCheckedWebGPUFeatures) {
      return Renderer.webgpuFeatureCheckPromise ?? false
    }

    // 如果正在检测中，等待检测完成
    if (Renderer.webgpuFeatureCheckPromise) {
      return Renderer.webgpuFeatureCheckPromise
    }

    // 开始检测
    Renderer.webgpuFeatureCheckPromise = (async () => {
      try {
        // 在 initialize() 中已经检测了基本的 WebGPU 支持，这里只需要检测 VideoFrame 支持

        const adapter = await navigator.gpu.requestAdapter()
        const device = await adapter?.requestDevice()
        if (!device) {
          throw new Error('Failed to get GPU device.')
        }

        // 创建一个 OffscreenCanvas
        const offscreenCanvas = new OffscreenCanvas(1, 1)
        // 获取 2D 上下文
        const context = offscreenCanvas.getContext('2d')
        if (!context) {
          throw new Error('Failed to get 2d context from OffscreenCanvas')
        }
        // context.fillStyle = 'black';
        context.fillRect(0, 0, 1, 1)
        // 创建一个最小化的 VideoFrame 和 GPUTexture 用于测试
        const frame = new VideoFrame(offscreenCanvas, { timestamp: 0 })
        const texture = device.createTexture({
          size: [1, 1],
          format: 'rgba8unorm',
          usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
        })

        // 核心测试：此操作如果不支持会抛出异常
        device.queue.copyExternalImageToTexture(
          { source: frame },
          { texture },
          [1, 1]
        )

        // 清理资源
        frame.close()
        texture.destroy()
        device.destroy()

        // 如果成功，则说明支持
        console.log(
          '[Anime4KWebExt] WebGPU feature detection: VideoFrame as texture source is SUPPORTED.'
        )
        Renderer.hasCheckedWebGPUFeatures = true
        return true
      } catch (error) {
        // 任何步骤失败都意味着不支持
        console.log(
          '[Anime4KWebExt] WebGPU feature detection: VideoFrame as texture source is NOT SUPPORTED.',
          error
        )
        Renderer.hasCheckedWebGPUFeatures = true
        return false
      }
    })()

    return Renderer.webgpuFeatureCheckPromise
  }

  /**
   * 创建最终的渲染管线，该管线负责将处理完成的纹理绘制到 Canvas 上。
   */
  private async createRenderPipeline(): Promise<void> {
    // 定义绑定组布局，描述着色器所需的资源
    this.renderBindGroupLayout = this.device.createBindGroupLayout({
      entries: [
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: {} }, // 采样器
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: {} }, // 输入纹理
      ],
    })

    // 异步创建渲染管线以提高性能
    this.renderPipeline = await this.device.createRenderPipelineAsync({
      layout: this.device.createPipelineLayout({
        bindGroupLayouts: [this.renderBindGroupLayout],
      }),
      vertex: {
        module: this.device.createShaderModule({
          code: fullscreenTexturedQuadWGSL,
        }),
        entryPoint: 'vert_main',
      },
      fragment: {
        module: this.device.createShaderModule({
          code: sampleExternalTextureWGSL,
        }),
        entryPoint: 'main',
        targets: [{ format: this.presentationFormat }],
      },
      primitive: { topology: 'triangle-list' },
    })

    this.sampler = this.device.createSampler({
      magFilter: 'linear',
      minFilter: 'linear',
    })
  }

  /**
   * 创建渲染绑定组，它将实际的资源（采样器和最终纹理）绑定到渲染管线。
   */
  private createRenderBindGroup(): void {
    const finalPipeline = this.pipelines.at(-1)
    if (!finalPipeline) {
      throw new RendererInitializationError('No render pipeline is available')
    }
    this.renderBindGroup = this.device.createBindGroup({
      layout: this.renderBindGroupLayout,
      entries: [
        { binding: 1, resource: this.sampler },
        // 获取效果链中最后一个管线的输出纹理作为最终渲染的输入
        {
          binding: 2,
          resource: finalPipeline.getOutputTexture().createView(),
        },
      ],
    })
  }

  /** Encode only the final textured-quad pass targeting the WebGPU canvas. */
  private encodeCanvasPresentation(commandEncoder: GPUCommandEncoder): void {
    const passEncoder = commandEncoder.beginRenderPass({
      colorAttachments: [
        {
          view: this.context.getCurrentTexture().createView(),
          clearValue: { r: 0.0, g: 0.0, b: 0.0, a: 1.0 },
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
    })
    passEncoder.setPipeline(this.renderPipeline)
    passEncoder.setBindGroup(0, this.renderBindGroup)
    passEncoder.draw(6)
    passEncoder.end()
  }

  /**
   * 处理单帧渲染的核心逻辑。
   * @returns {boolean} 如果成功渲染了一帧则返回 true，否则返回 false。
   */
  private async processFrame(): Promise<boolean> {
    if (this.destroyed) return false

    // 管线重建期间必须跳帧：旧管线/绑定组可能引用已销毁的纹理，
    // 继续渲染会触发 WebGPU validation error。
    // 同时重置失败计数，避免较慢的重建（>60 帧）误触熔断。
    if (this.resizePromise) {
      this.consecutiveFailures = 0
      return false
    }

    try {
      if (this.video.readyState < this.video.HAVE_CURRENT_DATA) {
        return false // 视频未准备好，跳过此帧
      }

      // 检查分辨率是否变化
      if (
        this.video.videoWidth !== this.videoFrameTexture.width ||
        this.video.videoHeight !== this.videoFrameTexture.height
      ) {
        console.log(
          `[Anime4KWebExt] Resolution changed: ${this.videoFrameTexture.width}x${this.videoFrameTexture.height} -> ${this.video.videoWidth}x${this.video.videoHeight}`
        )
        void this.handleSourceResize()
        return false // 分辨率已变，跳过此帧的渲染，等待重建完成
      }

      const frameStartedAt = this.diagnosticsEnabled ? performance.now() : 0
      const shouldCopy =
        this.diagnostics.mode !== 'canvas-only' &&
        (this.diagnostics.mode !== 'freeze-input' || !this.hasCopiedInputFrame)
      const copyStartedAt = this.diagnosticsEnabled ? performance.now() : 0
      if (shouldCopy && this.useImageBitmapFallback) {
        // 使用 ImageBitmap 回退方案（用于兼容 Firefox 等不支持直接从 video 复制的浏览器）
        const bitmap = await createImageBitmap(this.video)
        this.device.queue.copyExternalImageToTexture(
          { source: bitmap },
          { texture: this.videoFrameTexture },
          [this.video.videoWidth, this.video.videoHeight]
        )
        bitmap.close() // 复制完成后立即关闭，无需缓存
        this.hasCopiedInputFrame = true
      } else if (shouldCopy) {
        this.device.queue.copyExternalImageToTexture(
          { source: this.video },
          { texture: this.videoFrameTexture },
          [this.video.videoWidth, this.video.videoHeight]
        )
        this.hasCopiedInputFrame = true
      }
      const copyMs = this.diagnosticsEnabled
        ? performance.now() - copyStartedAt
        : 0

      const encodeStartedAt = this.diagnosticsEnabled ? performance.now() : 0
      const commandEncoder = this.device.createCommandEncoder()
      if (this.diagnostics.mode !== 'copy-only') {
        this.pipelines.forEach((pipeline) => pipeline.pass(commandEncoder))
      }
      if (this.presentationMode === 'rvfc') {
        this.encodeCanvasPresentation(commandEncoder)
      }
      const encodeMs = this.diagnosticsEnabled
        ? performance.now() - encodeStartedAt
        : 0
      const submitStartedAt = this.diagnosticsEnabled ? performance.now() : 0
      this.device.queue.submit([commandEncoder.finish()])
      this.hasProcessedFrame = true
      this.processedFrameGeneration++
      if (this.diagnosticsEnabled) {
        const submitMs = performance.now() - submitStartedAt
        const cpuMs = performance.now() - frameStartedAt
        this.recordCpuTimings(copyMs, encodeMs, submitMs, cpuMs)
        this.maybeProbeQueue()
      }

      return true // 成功渲染
    } catch (error) {
      console.error('[Anime4KWebExt] Frame processing failed:', error)

      // 检查是否是可恢复的尺寸不匹配错误
      if (
        error instanceof Error &&
        error.name === 'OperationError' &&
        error.message.includes('out of bounds')
      ) {
        // 这是一个潜在可恢复的错误
        this.lastError = new RendererRuntimeError(
          'Texture copy failed due to size mismatch.',
          { cause: error, recoverable: true }
        )
        // 仅在第一次尝试时进行修复
        if (!this.fixAttempted) {
          console.warn(
            '[Anime4KWebExt] Caught out-of-bounds error. Attempting to recover by resizing resources...'
          )
          void this.handleSourceResize()
        }
      } else {
        // 对于所有其他错误，视为不可恢复，并包含原始错误信息
        const errorMessage =
          error instanceof Error ? error.message : String(error)
        this.lastError = new RendererRuntimeError(
          `Frame processing failed: ${errorMessage}`,
          { cause: error as Error }
        )
      }
      // 返回 false，让渲染循环决定下一步操作
      return false
    }
  }

  private recordCpuTimings(
    copyMs: number,
    encodeMs: number,
    submitMs: number,
    cpuMs: number
  ): void {
    this.diagnosticsCopyTotal += copyMs
    this.diagnosticsCopyMax = Math.max(this.diagnosticsCopyMax, copyMs)
    this.diagnosticsEncodeTotal += encodeMs
    this.diagnosticsEncodeMax = Math.max(this.diagnosticsEncodeMax, encodeMs)
    this.diagnosticsSubmitTotal += submitMs
    this.diagnosticsSubmitMax = Math.max(this.diagnosticsSubmitMax, submitMs)
    this.diagnosticsCpuTotal += cpuMs
    this.diagnosticsCpuMax = Math.max(this.diagnosticsCpuMax, cpuMs)
  }

  private maybeProbeQueue(): void {
    if (
      this.diagnosticsQueueProbePending ||
      this.diagnosticsFrames === 0 ||
      this.diagnosticsFrames % this.diagnostics.queueProbeEveryFrames !== 0
    ) {
      return
    }
    this.diagnosticsQueueProbePending = true
    const startedAt = performance.now()
    void this.device.queue
      .onSubmittedWorkDone()
      .then(() => {
        this.diagnosticsLatestQueueDrainMs = performance.now() - startedAt
      })
      .catch(() => undefined)
      .finally(() => {
        this.diagnosticsQueueProbePending = false
        this.frameInFlight = false
      })
  }

  private recordFrameCallback(
    now: number,
    metadata: VideoFrameCallbackMetadata
  ): void {
    this.diagnosticsFrames++
    const headroom = metadata.expectedDisplayTime - now
    this.diagnosticsHeadroomTotal += headroom
    this.diagnosticsHeadroomMin = Math.min(
      this.diagnosticsHeadroomMin,
      headroom
    )
    if (headroom <= 0) this.diagnosticsLateCallbacks++
    if (this.diagnosticsLastCallbackAt !== null) {
      const delta = now - this.diagnosticsLastCallbackAt
      this.diagnosticsCallbackDeltaTotal += delta
      this.diagnosticsCallbackDeltaMax = Math.max(
        this.diagnosticsCallbackDeltaMax,
        delta
      )
    }
    if (this.diagnosticsLastPresentedFrames !== null) {
      this.diagnosticsPresentedFrameGaps += Math.max(
        0,
        metadata.presentedFrames - this.diagnosticsLastPresentedFrames - 1
      )
    }
    this.diagnosticsLastCallbackAt = now
    this.diagnosticsLastPresentedFrames = metadata.presentedFrames
    if (
      performance.now() - this.diagnosticsWindowStartedAt >=
      this.diagnostics.reportIntervalMs
    ) {
      this.emitDiagnostics()
    }
  }

  private emitDiagnostics(): void {
    const frames = this.diagnosticsFrames
    if (frames === 0) return
    const callbackIntervals = Math.max(1, frames - 1)
    const quality = this.video.getVideoPlaybackQuality?.()
    this.onDiagnostics?.({
      mode: this.diagnostics.mode,
      inputTextureFormat: this.diagnostics.inputTextureFormat,
      presentationMode: this.presentationMode,
      frames,
      presentedFrameGaps: this.diagnosticsPresentedFrameGaps,
      rendererBusyDrops: this.diagnosticsBusyDrops,
      lateCallbacks: this.diagnosticsLateCallbacks,
      averageHeadroomMs: this.diagnosticsHeadroomTotal / frames,
      minimumHeadroomMs: this.diagnosticsHeadroomMin,
      averageCallbackDeltaMs:
        this.diagnosticsCallbackDeltaTotal / callbackIntervals,
      maximumCallbackDeltaMs: this.diagnosticsCallbackDeltaMax,
      averageCopyCallMs: this.diagnosticsCopyTotal / frames,
      maximumCopyCallMs: this.diagnosticsCopyMax,
      averageEncodeMs: this.diagnosticsEncodeTotal / frames,
      maximumEncodeMs: this.diagnosticsEncodeMax,
      averageSubmitMs: this.diagnosticsSubmitTotal / frames,
      maximumSubmitMs: this.diagnosticsSubmitMax,
      averageCpuFrameMs: this.diagnosticsCpuTotal / frames,
      maximumCpuFrameMs: this.diagnosticsCpuMax,
      latestQueueDrainMs: this.diagnosticsLatestQueueDrainMs,
      videoDroppedFrames: quality?.droppedVideoFrames ?? 0,
      videoTotalFrames: quality?.totalVideoFrames ?? 0,
    })
    this.diagnosticsWindowStartedAt = performance.now()
    this.diagnosticsFrames = 0
    this.diagnosticsPresentedFrameGaps = 0
    this.diagnosticsBusyDrops = 0
    this.diagnosticsLateCallbacks = 0
    this.diagnosticsHeadroomTotal = 0
    this.diagnosticsHeadroomMin = Number.POSITIVE_INFINITY
    this.diagnosticsCallbackDeltaTotal = 0
    this.diagnosticsCallbackDeltaMax = 0
    this.diagnosticsCopyTotal = 0
    this.diagnosticsCopyMax = 0
    this.diagnosticsEncodeTotal = 0
    this.diagnosticsEncodeMax = 0
    this.diagnosticsSubmitTotal = 0
    this.diagnosticsSubmitMax = 0
    this.diagnosticsCpuTotal = 0
    this.diagnosticsCpuMax = 0
  }

  private notifyFirstFrameRendered(): void {
    if (this.hasPresentedFirstFrame) return
    this.hasPresentedFirstFrame = true
    this.onFirstFrameRendered?.()
  }

  /**
   * Draw the most recently processed texture to the canvas. GPU queue ordering
   * guarantees that an earlier copy/compute submission completes before this
   * pass. Re-presenting the latest completed texture on every display cadence
   * keeps canvas swapchain pacing independent from irregular video callbacks.
   */
  private presentLatestProcessedFrame(): boolean {
    if (
      this.destroyed ||
      this.isRecovering ||
      this.resizePromise ||
      !this.hasProcessedFrame ||
      (this.video.paused &&
        this.presentedFrameGeneration === this.processedFrameGeneration)
    ) {
      return false
    }

    try {
      const commandEncoder = this.device.createCommandEncoder()
      this.encodeCanvasPresentation(commandEncoder)
      this.device.queue.submit([commandEncoder.finish()])
      this.presentedFrameGeneration = this.processedFrameGeneration
      return true
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const runtimeError = new RendererRuntimeError(
        `Failed to present processed frame: ${message}`,
        { cause: error as Error }
      )
      console.error('[Anime4KWebExt] Frame presentation failed:', error)
      this.onError?.(runtimeError)
      this.destroy()
      return false
    }
  }

  private presentationLoop: FrameRequestCallback = () => {
    this.presentationAnimationFrameId = null
    if (this.destroyed) return

    if (this.presentLatestProcessedFrame()) this.notifyFirstFrameRendered()

    if (!this.destroyed) {
      this.presentationAnimationFrameId = requestAnimationFrame(
        this.presentationLoop
      )
    }
  }

  private startPresentationLoop(): void {
    if (
      this.presentationMode !== 'raf' ||
      this.destroyed ||
      this.presentationAnimationFrameId !== null
    ) {
      return
    }
    this.presentationAnimationFrameId = requestAnimationFrame(
      this.presentationLoop
    )
  }

  private stopPresentationLoop(): void {
    if (this.presentationAnimationFrameId === null) return
    cancelAnimationFrame(this.presentationAnimationFrameId)
    this.presentationAnimationFrameId = null
  }

  /**
   * 尝试渲染第一帧。成功后，调用回调并切换到常规渲染循环。
   * 如果不成功（例如视频暂停），则重新调度自身。
   */
  private renderFirstFrameAndStartLoop = async (): Promise<void> => {
    if (this.destroyed) return

    if (await this.processFrame()) {
      // 第一帧成功处理。rAF 模式要等到它真正提交到 canvas 后再通知上层。
      if (this.presentationMode === 'raf') {
        this.startPresentationLoop()
      } else {
        this.notifyFirstFrameRendered()
      }
      this.fixAttempted = false
      this.lastError = null
      this.consecutiveFailures = 0
      // 切换到常规渲染循环
      this.animationFrameId = this.video.requestVideoFrameCallback(
        this.renderLoop
      )
    } else {
      // 第一帧渲染失败或被跳过
      const error = this.lastError
      if (error) {
        // 这是一个真正的错误
        if (
          error instanceof RendererRuntimeError &&
          error.recoverable &&
          !this.fixAttempted
        ) {
          this.fixAttempted = true // 标记已尝试修复
          console.log(
            '[Anime4KWebExt] Retrying first frame render after recovery attempt...'
          )
        } else {
          console.error(
            '[Anime4KWebExt] Unrecoverable error on first frame. Destroying renderer.'
          )
          if (this.onError) this.onError(error)
          this.destroy()
          return // 停止
        }
      } else {
        // 如果没有错误，说明是良性跳帧（如分辨率调整），直接重试
        console.log(
          '[Anime4KWebExt] First frame skipped (e.g. resolution change), retrying...'
        )
      }

      if (!this.destroyed) {
        this.animationFrameId = this.video.requestVideoFrameCallback(
          this.renderFirstFrameAndStartLoop
        )
      }
    }
  }

  /**
   * 常规渲染循环，处理第一帧之后的所有帧。
   */
  private renderLoop: VideoFrameRequestCallback = async (now, metadata) => {
    if (this.destroyed) return

    if (this.diagnosticsEnabled) this.recordFrameCallback(now, metadata)
    if (this.diagnostics.earlyResubscribe) {
      this.animationFrameId = this.video.requestVideoFrameCallback(
        this.renderLoop
      )
      if (this.frameInFlight) {
        this.diagnosticsBusyDrops++
        return
      }
      this.frameInFlight = true
    }

    if (await this.processFrame()) {
      // 帧渲染成功
      this.fixAttempted = false
      this.lastError = null
      this.consecutiveFailures = 0
    } else {
      // 帧渲染失败或被跳过
      this.consecutiveFailures++
      const error = this.lastError
      if (error) {
        // 这是一个真正的错误
        if (
          error instanceof RendererRuntimeError &&
          error.recoverable &&
          !this.fixAttempted
        ) {
          this.fixAttempted = true // 标记已尝试修复，下一帧将是第二次尝试
          console.log(
            '[Anime4KWebExt] Retrying frame render after recovery attempt...'
          )
        } else {
          console.error(
            `[Anime4KWebExt] Unrecoverable error in render loop. Destroying renderer. Error: ${error.message}`
          )
          if (this.onError) this.onError(error)
          this.destroy()
          return // 停止循环
        }
      } else if (
        this.consecutiveFailures >= Renderer.MAX_CONSECUTIVE_FAILURES
      ) {
        // 良性跳帧（如分辨率调整）本身无害，但连续大量跳帧且无成功帧，
        // 说明渲染卡在坏状态（如超限纹理每帧静默失败）。熔断停止，
        // 避免逐帧疯狂重试刷爆控制台拖垮页面。
        console.error(
          `[Anime4KWebExt] Circuit breaker tripped: ${this.consecutiveFailures} consecutive failed frames. Destroying renderer.`
        )
        if (this.onError) {
          this.onError(
            new RendererRuntimeError(
              'Rendering stalled: too many consecutive failed frames.'
            )
          )
        }
        this.destroy()
        return // 停止循环
      }
      // 未达熔断阈值的良性跳帧：什么都不做，等待下一帧
    }

    // 持续调度自身
    if (!this.destroyed && !this.diagnostics.earlyResubscribe) {
      this.animationFrameId = this.video.requestVideoFrameCallback(
        this.renderLoop
      )
    }
    if (this.diagnostics.earlyResubscribe) this.frameInFlight = false
  }

  /**
   * 当视频源本身的分辨率发生变化时调用（例如，用户在视频播放器中切换了清晰度）
   * 这将重新创建基于视频原始尺寸的资源
   */
  public async handleSourceResize(): Promise<void> {
    if (this.destroyed) return
    // 重入安全：渲染循环与外部调用（如视频节点变化）并发触发时共享同一次重建
    if (this.resizePromise) return this.resizePromise
    this.hasProcessedFrame = false
    const rebuild = async () => {
      console.log(
        '[Anime4KWebExt] Resizing renderer due to video source dimension change...'
      )
      // 当前整套管线移入缓存而非销毁——自适应码率大概率很快切回这一档
      this.stashCurrentPipelineSet()
      const key = `${this.video.videoWidth}x${this.video.videoHeight}`
      const cached = this.pipelineCache.get(key)
      if (cached) {
        // 命中：整套换回，零着色器编译、零预热，下一帧即恢复渲染
        this.pipelineCache.delete(key)
        this.videoFrameTexture = cached.videoFrameTexture
        this.pipelines = cached.pipelines
        this.renderBindGroup = cached.renderBindGroup
        this.hasProcessedFrame = false
        console.log('[Anime4KWebExt] Renderer resized for source (cache hit).')
        return
      }
      this.createResources()
      await this.buildPipelines()
      if (this.destroyed) return
      this.createRenderBindGroup()
      console.log('[Anime4KWebExt] Renderer resized for source.')
    }
    // 存储的 promise 永不 reject：错误写入 lastError 走渲染循环的
    // 既有错误路径（onError/熔断），避免调用方产生未处理的 rejection。
    this.resizePromise = rebuild()
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error)
        this.lastError = new RendererRuntimeError(
          `Failed to rebuild renderer after source resize: ${message}`,
          { cause: error as Error }
        )
      })
      .finally(() => {
        this.resizePromise = null
      })
    return this.resizePromise
  }

  /**
   * 根据用户设置（效果或目标分辨率）更新渲染器配置
   * @param options 包含新效果和目标尺寸的对象
   */
  public async updateConfiguration(options: {
    effects: EnhancementEffect[]
    targetDimensions: Dimensions
  }): Promise<void> {
    if (this.destroyed) return

    const { effects, targetDimensions } = options

    // 使用JSON字符串比较来检测效果数组是否有实质性变化
    const effectsChanged =
      JSON.stringify(this.effects) !== JSON.stringify(effects)
    const dimensionsChanged =
      this.targetDimensions.width !== targetDimensions.width ||
      this.targetDimensions.height !== targetDimensions.height

    if (!effectsChanged && !dimensionsChanged) {
      console.log(
        '[Anime4KWebExt] Configuration unchanged, skipping pipeline rebuild.'
      )
      return
    }

    if (dimensionsChanged) {
      console.log(
        `[Anime4KWebExt] Updating target dimensions to ${targetDimensions.width}x${targetDimensions.height}.`
      )
      this.targetDimensions = targetDimensions
    }

    if (effectsChanged) {
      console.log('[Anime4KWebExt] Updating effects.')
      this.effects = effects
    }

    console.log(
      '[Anime4KWebExt] Rebuilding pipeline due to configuration update.'
    )
    this.hasProcessedFrame = false
    // 缓存中的管线组都绑定旧效果链/旧目标分辨率，整体失效
    this.clearPipelineCache()
    await this.buildPipelines()
    this.createRenderBindGroup()
    console.log('[Anime4KWebExt] Renderer configuration updated.')
  }

  /**
   * 更新渲染器使用的视频源。
   * @param newVideo - 新的 HTMLVideoElement
   */
  public async updateVideoSource(newVideo: HTMLVideoElement): Promise<void> {
    console.log('[Anime4KWebExt] Renderer video source updated.')
    if (
      newVideo.videoWidth !== this.videoFrameTexture.width ||
      newVideo.videoHeight !== this.videoFrameTexture.height
    ) {
      console.log(
        '[Anime4KWebExt] Video dimensions changed on reattach. Updating renderer.'
      )
      await this.handleSourceResize()
    }
    this.video = newVideo
  }

  /**
   * 从设备丢失中恢复
   * 尝试重新初始化 GPU 资源并恢复渲染
   */
  private async recoverFromDeviceLoss(): Promise<void> {
    if (this.destroyed || this.isRecovering) return

    this.isRecovering = true
    console.log('[Anime4KWebExt] Starting device recovery...')

    try {
      // 停止当前渲染循环
      if (this.animationFrameId !== null) {
        this.video.cancelVideoFrameCallback(this.animationFrameId)
        this.animationFrameId = null
      }
      this.stopPresentationLoop()
      this.hasProcessedFrame = false
      this.frameInFlight = false

      // 重新请求 GPU 适配器和设备
      const adapter = await navigator.gpu.requestAdapter()
      if (!adapter) {
        throw new Error('Failed to get GPU adapter during recovery')
      }

      this.device = await this.requestDeviceWithLimits(adapter)

      // 设置新设备的丢失监听
      this.device.lost.then((info) => {
        if (this.destroyed) return
        console.warn(
          `[Anime4KWebExt] GPU device lost: ${info.reason} - ${info.message}`
        )
        if (info.reason !== 'destroyed' && !this.isRecovering) {
          this.recoverFromDeviceLoss()
        }
      })

      // 重新配置上下文
      this.context.configure({
        device: this.device,
        format: this.presentationFormat,
        alphaMode: 'opaque',
      })

      // 重建资源和管道（缓存中的管线组属于已丢失的旧设备，整体失效）
      this.clearPipelineCache()
      this.createResources()
      await this.buildPipelines()
      await this.createRenderPipeline()
      this.createRenderBindGroup()

      // 重启渲染循环
      this.isRecovering = false
      this.renderFirstFrameAndStartLoop()

      console.log('[Anime4KWebExt] Device recovery successful!')
    } catch (error) {
      this.isRecovering = false
      console.error('[Anime4KWebExt] Device recovery failed:', error)
      if (this.onError) {
        this.onError(
          new RendererRuntimeError('Failed to recover from device loss', {
            cause: error as Error,
          })
        )
      }
    }
  }

  /**
   * 销毁渲染器并释放所有 WebGPU 资源。
   * 这是一个关键的清理方法，以防止内存和 GPU 资源泄漏。
   */
  public destroy(): void {
    if (this.destroyed) return
    // 立即设置销毁标志，以防止任何异步操作（如 device.lost）在销毁过程中执行不必要的操作
    this.destroyed = true

    // 停止渲染循环
    if (this.animationFrameId !== null) {
      this.video.cancelVideoFrameCallback(this.animationFrameId)
      this.animationFrameId = null
    }
    this.stopPresentationLoop()

    // 安全地销毁所有 GPU 资源
    try {
      this.clearPipelineCache()
      this.pipelines.forEach((pipeline) => {
        ;(pipeline as DestroyablePipeline).destroy?.()
      })
      this.videoFrameTexture?.destroy()
      // 解除画布与GPU设备的关联，这对于后续重新初始化至关重要
      this.context?.unconfigure()
      // 主动销毁设备，这将触发 device.lost Promise
      this.device?.destroy()
      console.log('[Anime4KWebExt] Renderer destroyed.')
    } catch (error) {
      console.error('[Anime4KWebExt] Error during renderer destruction:', error)
    }
  }
}

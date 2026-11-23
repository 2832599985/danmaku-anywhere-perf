type VideoSrcChangeListener = (src: string, video: HTMLVideoElement) => void

export class VideoSrcObserver {
  private videoNode: HTMLVideoElement | null = null
  private currentSrc = ''
  private srcChangeListeners = new Set<VideoSrcChangeListener>()
  private observer: MutationObserver
  private eventListenerCleanup: (() => void) | null = null

  constructor() {
    this.observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type !== 'attributes') continue
        if (mutation.target.nodeName !== 'VIDEO') continue
        const target = mutation.target as HTMLVideoElement

        if (this.currentSrc !== target.src) {
          this.currentSrc = target.src
          this.notifyListeners()
        }
      }
    })
  }

  get src() {
    return this.currentSrc
  }

  public onSrcChange(listener: VideoSrcChangeListener) {
    this.srcChangeListeners.add(listener)
  }

  public observe(videoNode: HTMLVideoElement) {
    this.observer.disconnect()
    // Detach the previous element's listeners before rebinding, or every video
    // swap leaks a pair of listeners on the element we no longer observe.
    if (this.eventListenerCleanup) {
      this.eventListenerCleanup()
      this.eventListenerCleanup = null
    }
    this.currentSrc = videoNode.src
    this.videoNode = videoNode

    // MutationObserver for src attribute changes
    this.observer.observe(videoNode, {
      attributes: true,
      attributeFilter: ['src'],
    })

    // Event listeners for MSE/srcObject changes that don't modify the src attribute
    const handleSourceChange = () => {
      // A late event from an element we have since stopped observing must not
      // be reported as a source change on the current one.
      if (this.videoNode !== videoNode) return
      this.checkSourceChange()
    }

    videoNode.addEventListener('loadstart', handleSourceChange)
    videoNode.addEventListener('loadeddata', handleSourceChange)

    this.eventListenerCleanup = () => {
      videoNode.removeEventListener('loadstart', handleSourceChange)
      videoNode.removeEventListener('loadeddata', handleSourceChange)
    }
  }

  private checkSourceChange() {
    if (!this.videoNode) return

    // For MSE/srcObject, the src attribute may be empty or a blob URL.
    // Use currentSrc which reflects the actual media source.
    const effectiveSrc = this.videoNode.currentSrc || this.videoNode.src

    if (this.currentSrc !== effectiveSrc) {
      this.currentSrc = effectiveSrc
      this.notifyListeners()
    }
  }

  private notifyListeners() {
    this.srcChangeListeners.forEach((listener) => {
      if (this.videoNode) {
        listener(this.currentSrc, this.videoNode)
      }
    })
  }

  public disconnect() {
    this.observer.disconnect()
    if (this.eventListenerCleanup) {
      this.eventListenerCleanup()
      this.eventListenerCleanup = null
    }
  }

  public cleanup() {
    this.disconnect()
    this.srcChangeListeners.clear()
  }
}

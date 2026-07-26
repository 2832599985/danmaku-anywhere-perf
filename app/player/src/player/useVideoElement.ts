import { useEffect } from 'react'
import { usePlayerStore } from '@/store/playerStore'

const finiteOrZero = (n: number): number => (Number.isFinite(n) ? n : 0)

/**
 * Mirror the <video> element's state into the store. The video element is the
 * source of truth for playback; the UI reads the mirrored copy.
 */
export const useVideoElement = (video: HTMLVideoElement | null): void => {
  useEffect(() => {
    if (!video) return
    const patch = usePlayerStore.getState().patchPlayback

    const syncBuffered = () => {
      const buffered = video.buffered
      patch({
        bufferedEnd: buffered.length ? buffered.end(buffered.length - 1) : 0,
      })
    }

    const onTimeUpdate = () => patch({ currentTime: video.currentTime })
    const onDurationChange = () =>
      patch({ duration: finiteOrZero(video.duration) })
    const onPlay = () => patch({ playing: true })
    const onPlaying = () => patch({ playing: true })
    const onPause = () => patch({ playing: false })
    const onEnded = () => patch({ playing: false })
    const onVolumeChange = () =>
      patch({ volume: video.volume, muted: video.muted })
    const onRateChange = () => patch({ playbackRate: video.playbackRate })
    const onLoadedMetadata = () =>
      patch({
        ready: true,
        duration: finiteOrZero(video.duration),
        videoWidth: video.videoWidth,
        videoHeight: video.videoHeight,
      })
    const onSeeked = () => patch({ currentTime: video.currentTime })

    // A persistent history means entries routinely outlive the files they point
    // at, so a failed load must say so instead of leaving a black screen.
    const onError = () => {
      const code = video.error?.code
      const message =
        code === MediaError.MEDIA_ERR_ABORTED
          ? '加载已中止 · Load aborted'
          : code === MediaError.MEDIA_ERR_NETWORK
            ? '读取文件失败 · Cannot read the file'
            : code === MediaError.MEDIA_ERR_DECODE
              ? '解码失败，文件可能已损坏 · Decode failed'
              : '无法播放：文件可能已被移动、删除，或格式不受支持'
      usePlayerStore.getState().setMediaError(message)
      patch({ playing: false, ready: false })
    }
    const onLoadedData = () => usePlayerStore.getState().setMediaError(null)

    video.addEventListener('timeupdate', onTimeUpdate)
    video.addEventListener('durationchange', onDurationChange)
    video.addEventListener('play', onPlay)
    video.addEventListener('playing', onPlaying)
    video.addEventListener('pause', onPause)
    video.addEventListener('ended', onEnded)
    video.addEventListener('volumechange', onVolumeChange)
    video.addEventListener('ratechange', onRateChange)
    video.addEventListener('loadedmetadata', onLoadedMetadata)
    video.addEventListener('seeked', onSeeked)
    video.addEventListener('progress', syncBuffered)
    video.addEventListener('error', onError)
    video.addEventListener('loadeddata', onLoadedData)

    // Prime the store with the element's current values.
    patch({
      playing: !video.paused && !video.ended,
      currentTime: video.currentTime,
      duration: finiteOrZero(video.duration),
      volume: video.volume,
      muted: video.muted,
      playbackRate: video.playbackRate,
      videoWidth: video.videoWidth,
      videoHeight: video.videoHeight,
    })

    return () => {
      video.removeEventListener('timeupdate', onTimeUpdate)
      video.removeEventListener('durationchange', onDurationChange)
      video.removeEventListener('play', onPlay)
      video.removeEventListener('playing', onPlaying)
      video.removeEventListener('pause', onPause)
      video.removeEventListener('ended', onEnded)
      video.removeEventListener('volumechange', onVolumeChange)
      video.removeEventListener('ratechange', onRateChange)
      video.removeEventListener('loadedmetadata', onLoadedMetadata)
      video.removeEventListener('seeked', onSeeked)
      video.removeEventListener('progress', syncBuffered)
      video.removeEventListener('error', onError)
      video.removeEventListener('loadeddata', onLoadedData)
    }
  }, [video])
}

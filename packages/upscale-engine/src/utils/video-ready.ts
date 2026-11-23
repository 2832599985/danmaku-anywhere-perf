/**
 * 等待视频元素达到指定的 readyState。
 *
 * 不能只监听单一事件（如 loadeddata）：它每个加载周期只触发一次，
 * 如果在开始等待前已经触发过（例如 seek 导致 readyState 临时回落），
 * 监听将永远不会兑现，按钮就会永远卡在"启动中"。
 * 因此这里采用「多事件 + 轮询兜底 + 超时」三重保障，并通过
 * addEventListener 监听，避免与站点播放器的 on* 属性互相覆盖。
 *
 * @param video 目标视频元素
 * @param minReadyState 需要达到的最小 readyState（如 HAVE_METADATA / HAVE_CURRENT_DATA）
 * @param timeoutMs 超时时间，超时后 reject，保证调用方不会无限挂起
 */
export function waitForVideoReady(
  video: HTMLVideoElement,
  minReadyState: number,
  timeoutMs = 20000
): Promise<void> {
  if (video.readyState >= minReadyState) {
    return Promise.resolve()
  }

  return new Promise<void>((resolve, reject) => {
    const events = [
      'loadedmetadata',
      'loadeddata',
      'canplay',
      'canplaythrough',
      'playing',
      'seeked',
      'timeupdate',
    ]
    let pollTimer = 0
    let timeoutTimer = 0

    const cleanup = () => {
      events.forEach((name) => video.removeEventListener(name, check))
      video.removeEventListener('error', onError)
      clearInterval(pollTimer)
      clearTimeout(timeoutTimer)
    }

    const check = () => {
      if (video.readyState >= minReadyState) {
        cleanup()
        resolve()
      }
    }

    const onError = () => {
      cleanup()
      reject(
        new Error(
          `Video failed to load: ${video.error?.message || 'unknown media error'}`
        )
      )
    }

    events.forEach((name) => video.addEventListener(name, check))
    video.addEventListener('error', onError)
    // 兜底轮询：部分站点脚本会拦截/吞掉媒体事件
    pollTimer = window.setInterval(check, 250)
    timeoutTimer = window.setTimeout(() => {
      cleanup()
      reject(
        new Error(
          `Timed out waiting for video readyState >= ${minReadyState} (current: ${video.readyState}).`
        )
      )
    }, timeoutMs)
  })
}

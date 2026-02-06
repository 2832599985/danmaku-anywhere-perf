import type { Manager } from '@mr-quin/danmu'
import type { DanmakuOptions } from '../options'
import { type ParsedComment, type TimedComment, transformComment } from '../parser'
import { useFixedDanmaku } from './fixedDanmaku'

const binarySearch = <T extends { time: number }>(
  comments: T[],
  time: number
): number => {
  let low = 0
  let high = comments.length - 1
  let ans = comments.length

  while (low <= high) {
    const mid = Math.floor((low + high) / 2)
    const commentTime = comments[mid].time

    if (commentTime >= time) {
      ans = mid
      high = mid - 1
    } else {
      low = mid + 1
    }
  }
  return ans
}

const DURATION_MS = 5000
const DURATION_S = DURATION_MS / 1000

export const bindVideo =
  (
    video: HTMLMediaElement,
    comments: Array<ParsedComment | TimedComment>,
    getConfig: () => DanmakuOptions
  ) =>
  (manager: Manager<ParsedComment>) => {
    const { plugin, isFull, getDanmakuOptions } = useFixedDanmaku(manager)

    // index of the next comment
    let cursor = 0
    // user-defined offset in seconds
    let offset = getConfig().offset / 1000
    let documentVisible = true

    const updateCursor = () => {
      // include danmaku that are within the duration range
      // so that we can "catch up" with the last
      cursor = binarySearch(comments, video.currentTime - offset - DURATION_S)
    }

    updateCursor()

    const toParsedComment = (
      comment: ParsedComment | TimedComment
    ): ParsedComment => {
      if ('raw' in comment) {
        if (comment.parsed) {
          return comment.parsed
        }
        const parsed = transformComment(comment.raw, 0)
        comment.parsed = parsed
        return parsed
      }
      return comment
    }

    const emitDanmaku = (
      comment: ParsedComment | TimedComment,
      progress = 0
    ) => {
      const parsed = toParsedComment(comment)

      switch (parsed.mode) {
        case 'rtl': {
          // since comments are time-sensitive, use unshift to prioritize the latest comment
          manager.unshift(parsed, { progress })
          break
        }
        case 'ltr': {
          manager.unshift(parsed, {
            direction: 'right',
            progress,
          })
          break
        }
        case 'top':
        case 'bottom': {
          if (manager.isFreeze()) {
            break
          }

          // check the render mode for the comment
          const config = getConfig()
          const fixedCommentMode = config.specialComments[parsed.mode]
          if (fixedCommentMode === 'normal') {
            if (config.allowOverlap || !isFull(parsed.mode)) {
              manager.pushFlexibleDanmaku(parsed, {
                duration: DURATION_MS,
                direction: 'none',
                ...getDanmakuOptions(parsed.mode),
              })
            }
          } else if (fixedCommentMode === 'scroll') {
            manager.unshift({ ...parsed, mode: 'rtl' }, { progress })
          }

          break
        }
      }
    }

    const handleTimeupdate = () => {
      const offsetTime = video.currentTime - offset

      if (cursor >= comments.length || comments[cursor].time > offsetTime) {
        return
      }

      while (cursor < comments.length) {
        const comment = comments[cursor]

        // return early if we haven't reached the comment time
        if (comment.time > offsetTime) {
          return
        }

        // for danmaku that are in the "past", set the progress so that they can start in the middle of the screen
        let progress = (offsetTime - comment.time) / DURATION_S
        if (progress < 0.1) {
          progress = 0
        }

        if (documentVisible) {
          // emitting while the page is not visible causes comments to "pile up"
          emitDanmaku(comment, progress)
        }

        cursor++
      }
    }

    const handleSeek = () => {
      manager.clear()
      updateCursor()
      handleTimeupdate()
    }

    const handlePause = () => {
      manager.freeze()
      manager.stopPlaying()
    }

    const handlePlay = () => {
      if (manager.isFreeze()) {
        manager.unfreeze()
      }
      manager.startPlaying()
      handleTimeupdate()
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        documentVisible = false
      } else if (document.visibilityState === 'visible') {
        documentVisible = true
      }
    }

    video.addEventListener('timeupdate', handleTimeupdate)
    video.addEventListener('seeking', handleSeek)
    video.addEventListener('pause', handlePause)
    video.addEventListener('waiting', handlePause)
    video.addEventListener('play', handlePlay)
    video.addEventListener('playing', handlePlay)

    document.addEventListener('visibilitychange', handleVisibilityChange)

    manager.use({
      name: 'bind-video',
      unmount() {
        video.removeEventListener('timeupdate', handleTimeupdate)
        video.removeEventListener('seeking', handleSeek)
        video.removeEventListener('play', handlePlay)
        video.removeEventListener('playing', handlePlay)
        video.removeEventListener('pause', handlePause)
        video.removeEventListener('waiting', handlePause)
      },
      updateOptions() {
        // the offset changes only when the config changes
        if (getConfig().offset !== offset) {
          offset = getConfig().offset / 1000
          updateCursor()
          manager.clear()
        }
      },
    })
    manager.use(plugin)
  }

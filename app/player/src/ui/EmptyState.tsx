import { Box, Stack, Typography } from '@mui/material'
import { alpha } from '@mui/material/styles'
import { useEffect, useState } from 'react'
import { getPlatform } from '@/platform'
import { usePlayerCommands } from '@/player/commands'
import type { PlaylistItem, ResumeEntry } from '@/store/playerStore'
import { usePlayerStore } from '@/store/playerStore'
import {
  CRISP_EASE,
  halftoneSx,
  hatchSx,
  INK,
  INK_STAGE,
  inkStampPressSx,
  LINE_FRAME,
  LINE_SUBTLE,
  MONO,
  PAPER,
  SERIF_JP,
  VERMILION,
} from '@/theme/theme'
import { CloseIcon } from './icons'
import { formatTime } from './TimeDisplay'

/**
 * The frame the video was left on (loaded from the platform's thumbnail
 * store), or the hatch placeholder until one exists — older history, or every
 * capture so far was a black frame. `version` reloads it after a new capture.
 */
const ResumeThumb = ({ path, version }: { path: string; version: number }) => {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    let objectUrl: string | null = null
    void getPlatform()
      .loadResumeThumb(path)
      .then((blob) => {
        if (!alive || !blob) return
        objectUrl = URL.createObjectURL(blob)
        setUrl(objectUrl)
      })
      .catch(() => undefined)
    return () => {
      alive = false
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [path, version])

  const frameSx = {
    height: 88,
    borderBottom: LINE_SUBTLE,
  }
  if (url) {
    return (
      <Box
        component="img"
        src={url}
        alt=""
        data-resume-thumb
        draggable={false}
        sx={{
          ...frameSx,
          display: 'block',
          width: '100%',
          objectFit: 'cover',
          background: INK,
        }}
      />
    )
  }
  return (
    <Box
      sx={{
        ...frameSx,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        ...hatchSx(),
      }}
    >
      <Typography
        sx={{
          fontFamily: MONO,
          fontSize: 9,
          color: alpha(PAPER, 0.4),
          fontWeight: 700,
          letterSpacing: '0.2em',
        }}
      >
        THUMB
      </Typography>
    </Box>
  )
}

/** Recent, resumable history shown under the hero (most recently watched first). */
const pickRecent = (
  playlist: PlaylistItem[],
  progress: Record<string, ResumeEntry>
): { item: PlaylistItem; entry: ResumeEntry }[] =>
  playlist
    .filter(
      (item): item is PlaylistItem & { path: string } =>
        !!item.path && !!progress[item.path]
    )
    .map((item) => ({ item, entry: progress[item.path as string] }))
    .sort((a, b) => b.entry.updatedAt - a.entry.updatedAt)
    .slice(0, 3)

/** Format relative time in Chinese, matching the design (昨天 / N 天前 / 上周). */
const formatRelativeTime = (epochMs: number): string => {
  if (!epochMs) return ''
  const now = Date.now()
  const diff = now - epochMs
  const minutes = Math.floor(diff / 60000)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)

  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes} 分钟前`
  if (hours < 24) return `${hours} 小时前`
  if (days === 1) return '昨天'
  if (days < 7) return `${days} 天前`
  if (days < 14) return '上周'
  if (days < 30) return `${Math.floor(days / 7)} 周前`
  return `${Math.floor(days / 30)} 个月前`
}

/** Four-point anime sparkle (✦). Position/color/animation via sx. */
const Sparkle = ({ size, sx }: { size: number; sx: object }) => (
  <Box
    component="svg"
    viewBox="0 0 24 24"
    aria-hidden
    sx={{
      position: 'absolute',
      width: size,
      height: size,
      pointerEvents: 'none',
      ...sx,
    }}
  >
    <path
      d="M12 0 L14.6 9.4 L24 12 L14.6 14.6 L12 24 L9.4 14.6 L0 12 L9.4 9.4 Z"
      fill="currentColor"
    />
  </Box>
)

/**
 * The idle stage: halftone ground + manga speed-lines + drifting danmaku strip
 * + centered hero + button + continue-watching grid + floating mascot.
 */
export const EmptyState = () => {
  const commands = usePlayerCommands()
  const playlist = usePlayerStore((s) => s.playlist)
  const progress = usePlayerStore((s) => s.progress)
  const clearProgress = usePlayerStore((s) => s.clearProgress)
  const recent = pickRecent(playlist, progress)

  return (
    <Box
      sx={{
        position: 'absolute',
        inset: 0,
        overflow: 'hidden',
        ...halftoneSx(0.1, 12),
      }}
    >
      {/* Manga speed-line layer: conic gradient burst. */}
      <Box
        aria-hidden
        sx={{
          position: 'absolute',
          left: '50%',
          top: '34%',
          width: 'max(150vmax, 1300px)',
          height: 'max(150vmax, 1300px)',
          transform: 'translate(-50%, -50%)',
          background:
            'repeating-conic-gradient(from 0deg at 50% 50%, rgba(244,241,232,.09) 0deg 1.4deg, transparent 1.4deg 7deg)',
          opacity: 0.5,
          pointerEvents: 'none',
          // Keep the burst at the edges: the spotlight leaves the hero and CTA
          // on calm paper instead of crossing them with moving lines.
          maskImage:
            'radial-gradient(circle, transparent 22%, rgba(0,0,0,0.85) 62%, transparent 96%)',
          WebkitMaskImage:
            'radial-gradient(circle, transparent 22%, rgba(0,0,0,0.85) 62%, transparent 96%)',
        }}
      />

      {/* Keep the decorative lines below the top bar. */}
      <Box
        aria-hidden
        sx={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: 340,
          overflow: 'hidden',
          opacity: 0.45,
          pointerEvents: 'none',
          containerType: 'inline-size',
        }}
      >
        {[
          { text: 'また会えたね', duration: 17, delay: 0 },
          { text: '拖入视频就能开始', duration: 21, delay: -7 },
          { text: '4K 补帧待机中', duration: 19, delay: -12, color: VERMILION },
          { text: 'おかえり', duration: 24, delay: -3 },
        ].map(({ text, duration, delay, color }, idx) => (
          <Typography
            key={idx}
            aria-hidden
            sx={{
              position: 'absolute',
              top: `${58 + idx * 66}px`,
              // Start off-screen right; ink-dm translates -2100px so the line
              // sweeps right→left. left:0 (the old value) parked them stacked
              // at the left edge, never moving.
              left: '100%',
              whiteSpace: 'nowrap',
              fontWeight: 700,
              fontSize: `${19 + idx * 2}px`,
              color: color || PAPER,
              animation: `ink-dm ${duration}s linear ${delay}s infinite`,
              willChange: 'transform',
            }}
          >
            {text}
          </Typography>
        ))}
      </Box>

      {/* Center column: title + hero + button + caption + continue-watching + mascot. */}
      {/* Scroll layer: the centered column can exceed small windows, so it
          must scroll rather than clip. A `min-height:100%` centerer keeps the
          content vertically centered when it fits and top-aligned (scrollable,
          never clipping the title) when it does not — the safe flex-centering
          pattern that a plain `align-items:center` on the outer box breaks. */}
      <Box
        sx={{
          position: 'absolute',
          inset: 0,
          zIndex: 1,
          overflowY: 'auto',
          overflowX: 'hidden',
        }}
      >
        <Box
          sx={{
            minHeight: '100%',
            boxSizing: 'border-box',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            textAlign: 'center',
            gap: '26px',
            py: '40px',
            px: 3,
            mx: 'auto',
            width: 840,
            maxWidth: '90%',
          }}
        >
          {/* Title cluster: mono 11px tracked VERMILION label */}
          <Typography
            sx={{
              fontFamily: MONO,
              fontSize: 11,
              letterSpacing: '0.5em',
              color: VERMILION,
              fontWeight: 700,
              ml: '0.5em',
            }}
          >
            DANMAKU PLAYER
          </Typography>

          {/* Hero: PAPER block with rotated text + sparkles + shadow. */}
          <Box
            sx={{
              position: 'relative',
              background: PAPER,
              padding: '6px 26px 10px',
              transform: 'rotate(-1.2deg)',
              boxShadow: `10px 10px 0 ${VERMILION}`,
            }}
          >
            <Typography
              component="h1"
              sx={{
                fontSize: 'clamp(40px, 7vw, 74px)',
                fontWeight: 400,
                fontSynthesisWeight: 'none',
                letterSpacing: '0.06em',
                fontFamily: SERIF_JP,
                color: INK,
                lineHeight: 1.2,
                margin: 0,
              }}
            >
              弾幕プレイヤー
            </Typography>

            {/* Sparkles: ✦ accent marks. */}
            <Sparkle
              size={20}
              sx={{
                position: 'absolute',
                top: -26,
                left: -38,
                color: VERMILION,
                animation: 'ink-sparkle 2.6s ease-in-out infinite',
                '@media (prefers-reduced-motion: reduce)': {
                  animation: 'none',
                  opacity: 0.85,
                },
              }}
            />
            <Sparkle
              size={15}
              sx={{
                position: 'absolute',
                top: 14,
                right: -46,
                color: PAPER,
                animation: 'ink-sparkle 3.4s ease-in-out 0.7s infinite',
                '@media (prefers-reduced-motion: reduce)': {
                  animation: 'none',
                  opacity: 0.7,
                },
              }}
            />
          </Box>

          {/* Subtitle: mono tracked label. */}
          <Typography
            sx={{
              fontFamily: MONO,
              fontSize: 14,
              letterSpacing: '0.32em',
              color: alpha(PAPER, 0.55),
              fontWeight: 700,
            }}
          >
            超分辨率 · 补帧 · 弹幕
          </Typography>

          {/* Main button: 3px frame, hover-only sheen, hard-shadow stamp. */}
          <Box
            component="button"
            type="button"
            onClick={() => void commands.openVideo()}
            sx={{
              appearance: 'none',
              font: 'inherit',
              textAlign: 'inherit',
              cursor: 'pointer',
              position: 'relative',
              '&:focus-visible': {
                outline: `2px solid ${VERMILION}`,
                outlineOffset: '3px',
              },
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              border: LINE_FRAME,
              background: INK_STAGE,
              color: PAPER,
              fontFamily: 'inherit',
              fontSize: 19,
              fontWeight: 900,
              letterSpacing: '0.1em',
              padding: '15px 46px',
              overflow: 'hidden',
              ...inkStampPressSx(8, VERMILION, {
                background: PAPER,
                color: INK,
                borderColor: PAPER,
              }),
              // The paper ink mark under the text stays ink; only the fill
              // inverts on hover, so the hard vermilion shadow never melts.
              '&::after': {
                content: '""',
                position: 'absolute',
                top: 0,
                bottom: 0,
                left: '-30%',
                width: '30%',
                background: `linear-gradient(90deg, transparent, ${alpha(VERMILION, 0.55)}, transparent)`,
                transform: 'translateX(0) skewX(-12deg)',
                opacity: 0,
                pointerEvents: 'none',
                transition: `transform 520ms ${CRISP_EASE}, opacity 120ms linear`,
              },
              '&:hover::after': {
                transform: 'translateX(460%) skewX(-12deg)',
                opacity: 1,
              },
              '@media (prefers-reduced-motion: reduce)': {
                '&::after': { display: 'none' },
              },
            }}
          >
            <Typography
              component="span"
              sx={{
                position: 'relative',
                zIndex: 1,
              }}
            >
              打开视频 / OPEN
            </Typography>
          </Box>

          {/* Caption: tracking, dimmed mono. */}
          <Typography
            sx={{
              fontFamily: MONO,
              fontSize: 11,
              letterSpacing: '0.26em',
              color: alpha(PAPER, 0.4),
              fontWeight: 700,
            }}
          >
            拖入文件亦可 · MP4 / MKV / WEBM / FLV / TS / AVI ·
            自动匹配弹幕与字幕
          </Typography>

          {/* Continue watching grid (3 cols, only if recent items exist). */}
          {recent.length > 0 && (
            <Box sx={{ width: '100%', mt: 1 }}>
              {/* Header row: 标题 + EN micro-label + rule. */}
              <Stack
                direction="row"
                alignItems="center"
                spacing={1}
                sx={{
                  mb: 3,
                  pb: 2,
                  borderBottom: LINE_SUBTLE,
                }}
              >
                <Typography
                  sx={{
                    fontSize: 13,
                    fontWeight: 900,
                    color: PAPER,
                    letterSpacing: '0.08em',
                  }}
                >
                  继续观看
                </Typography>
                <Typography
                  sx={{
                    fontFamily: MONO,
                    fontSize: 9,
                    letterSpacing: '0.24em',
                    color: alpha(PAPER, 0.4),
                    fontWeight: 700,
                    textTransform: 'uppercase',
                  }}
                >
                  CONTINUE WATCHING
                </Typography>
                <Box sx={{ flex: 1 }} />
              </Stack>

              {/* Grid: 3 cols or fewer. */}
              <Box
                sx={{
                  display: 'grid',
                  // minmax(0,1fr) not 1fr: a bare 1fr track floors at its
                  // min-content, so a long filename in one card starves the
                  // others (one card collapsed to 78px). 0 lets tracks share
                  // equally and the inner ellipsis do the clipping.
                  gridTemplateColumns: `repeat(${Math.min(3, recent.length)}, minmax(0, 1fr))`,
                  gap: 3,
                }}
              >
                {recent.map(({ item, entry }, idx) => {
                  const ratio =
                    entry.duration > 0
                      ? Math.min(1, entry.time / entry.duration)
                      : 0
                  const isFirst = idx === 0
                  return (
                    <Box
                      key={item.path}
                      role="button"
                      tabIndex={0}
                      onClick={() =>
                        item.path && commands.openVideoFromPath(item.path)
                      }
                      onKeyDown={(e: React.KeyboardEvent) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          if (item.path) commands.openVideoFromPath(item.path)
                        }
                      }}
                      sx={{
                        position: 'relative',
                        textAlign: 'left',
                        cursor: 'pointer',
                        display: 'flex',
                        '&:focus-visible': {
                          outline: `2px solid ${VERMILION}`,
                          outlineOffset: '2px',
                        },
                        flexDirection: 'column',
                        border: LINE_SUBTLE,
                        background: 'rgba(244,241,232,.04)',
                        transition: `background-color 0ms, border-color 0ms, transform 120ms ${CRISP_EASE}, box-shadow 120ms ${CRISP_EASE}`,
                        '&:hover': {
                          borderColor: PAPER,
                          background: alpha(PAPER, 0.09),
                          transform: 'translate(-2px, -2px)',
                          boxShadow: `4px 4px 0 ${VERMILION}`,
                        },
                        '&:hover [data-remove-recent], &:focus-within [data-remove-recent]':
                          {
                            opacity: 1,
                          },
                        '&:active': {
                          transform: 'translate(1px, 1px)',
                          boxShadow: `2px 2px 0 ${VERMILION}`,
                        },
                        '@media (prefers-reduced-motion: reduce)': {
                          '&:hover, &:active': { transform: 'none' },
                        },
                      }}
                    >
                      {item.path && (
                        <Box
                          component="button"
                          type="button"
                          data-remove-recent
                          aria-label={`移除继续观看 ${item.name}`}
                          title="从继续观看移除"
                          onClick={(e: React.MouseEvent) => {
                            e.stopPropagation()
                            if (!item.path) return
                            clearProgress(item.path)
                            void getPlatform()
                              .deleteResumeThumb(item.path)
                              .catch(() => undefined)
                          }}
                          sx={{
                            appearance: 'none',
                            position: 'absolute',
                            top: 5,
                            right: 5,
                            zIndex: 2,
                            width: 22,
                            height: 22,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            border: `1px solid ${alpha(PAPER, 0.45)}`,
                            background: alpha(INK, 0.82),
                            color: PAPER,
                            cursor: 'pointer',
                            opacity: 0,
                            transition:
                              'opacity 120ms linear, background-color 0ms, color 0ms',
                            '&:hover': {
                              background: VERMILION,
                              borderColor: VERMILION,
                              color: PAPER,
                            },
                            '&:focus-visible': {
                              opacity: 1,
                              outline: `2px solid ${VERMILION}`,
                              outlineOffset: '1px',
                            },
                          }}
                        >
                          <CloseIcon size={10} />
                        </Box>
                      )}
                      {item.path && (
                        <ResumeThumb
                          path={item.path}
                          version={entry.updatedAt}
                        />
                      )}

                      {/* Body: name + progress. */}
                      <Box sx={{ padding: '8px 10px' }}>
                        <Typography
                          noWrap
                          title={item.name}
                          sx={{
                            fontSize: 12,
                            fontWeight: 700,
                            color: PAPER,
                            letterSpacing: '0.02em',
                            lineHeight: 1.4,
                            mb: 1,
                          }}
                        >
                          {item.name}
                        </Typography>

                        {/* Progress bar: fill color = VERMILION for most-recent, PAPER for others. */}
                        <Box
                          sx={{
                            width: '100%',
                            height: 2,
                            background: alpha(PAPER, 0.18),
                            mb: 1,
                            position: 'relative',
                          }}
                        >
                          <Box
                            sx={{
                              position: 'absolute',
                              top: 0,
                              left: 0,
                              width: `${ratio * 100}%`,
                              height: '100%',
                              background: isFirst ? VERMILION : PAPER,
                            }}
                          />
                        </Box>

                        {/* Time label: mono tracked. */}
                        <Typography
                          noWrap
                          title={`${formatTime(entry.time)}${entry.duration > 0 ? ` / ${formatTime(entry.duration)}` : ''} · ${formatRelativeTime(entry.updatedAt)}`}
                          sx={{
                            fontFamily: MONO,
                            fontSize: 9,
                            color: alpha(PAPER, 0.45),
                            fontWeight: 700,
                            letterSpacing: '0.1em',
                            lineHeight: 1.4,
                            fontVariantNumeric: 'tabular-nums',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                          }}
                        >
                          看到 {formatTime(entry.time)}
                          {entry.duration > 0 &&
                            ` / ${formatTime(entry.duration)}`}{' '}
                          · {formatRelativeTime(entry.updatedAt)}
                        </Typography>
                      </Box>
                    </Box>
                  )
                })}
              </Box>
            </Box>
          )}
        </Box>
      </Box>

      {/* Floating mascot (看板娘) at bottom-right. */}
      <Box
        component="img"
        src={`${import.meta.env.BASE_URL}assets/mascot-manga.png`}
        alt=""
        aria-hidden
        sx={{
          position: 'absolute',
          right: 10,
          bottom: 8,
          width: 352,
          pointerEvents: 'none',
          animation: 'ink-float 6s ease-in-out infinite',
          '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
          filter: `drop-shadow(6px 6px 0 ${alpha(VERMILION, 0.85)})`,
          // The mascot overlaps the 3rd continue-watching card on anything
          // narrower than the design's 1600 canvas; shrink it on mid widths
          // and drop it entirely when there's no room.
          '@media (max-width: 1599px)': { width: 280 },
          '@media (max-width: 1199px)': {
            display: 'none',
          },
        }}
      />
    </Box>
  )
}

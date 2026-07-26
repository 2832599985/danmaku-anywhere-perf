import { HistoryRounded, PlayArrowRounded } from '@mui/icons-material'
import { Box, LinearProgress, Stack, Typography } from '@mui/material'
import { usePlayerCommands } from '@/player/commands'
import type { PlaylistItem, ResumeEntry } from '@/store/playerStore'
import { usePlayerStore } from '@/store/playerStore'
import { RICH_GRADIENT } from '@/theme/theme'
import { formatTime } from './TimeDisplay'

/**
 * Ghost danmaku drifting across the idle stage. Purely decorative — they sell
 * "this is a danmaku player" the moment the window opens. Each entry: text,
 * vertical track (%), duration (s), delay (s, negative = already mid-flight),
 * font size and opacity.
 */
const GHOSTS: [string, number, number, number, number, number][] = [
  ['前方高能预警', 12, 34, -6, 20, 0.1],
  ['弹幕护体', 22, 46, -24, 15, 0.07],
  ['2333333', 31, 28, -12, 17, 0.09],
  ['名场面收藏了', 64, 52, -30, 14, 0.06],
  ['awsl', 73, 38, -2, 19, 0.08],
  ['泪目 T_T', 84, 44, -18, 14, 0.06],
]

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
 * Line-art cat-ear TV mascot (电视娘) idling in the corner of the stage —
 * strokes only, in the theme violet, so it reads as set dressing rather than
 * clip-art. Bobs gently; hidden on narrow windows.
 */
const TvMascot = () => (
  <Box
    aria-hidden
    sx={{
      position: 'absolute',
      right: 'clamp(16px, 5vw, 96px)',
      bottom: '7%',
      width: 'clamp(150px, 14vw, 210px)',
      color: 'rgba(196,181,253,0.34)',
      pointerEvents: 'none',
      animation: 'da-bob 6s ease-in-out infinite',
      '@media (max-width: 1080px)': { display: 'none' },
    }}
  >
    <svg viewBox="0 0 220 170" fill="none" stroke="currentColor">
      {/* cat-ear antennas */}
      <path d="M82 52 L60 20" strokeWidth="3" strokeLinecap="round" />
      <circle cx="60" cy="20" r="3.5" fill="currentColor" stroke="none" />
      <path d="M126 52 L148 20" strokeWidth="3" strokeLinecap="round" />
      <circle cx="148" cy="20" r="3.5" fill="currentColor" stroke="none" />
      {/* body + screen */}
      <rect x="46" y="52" width="126" height="88" rx="16" strokeWidth="3" />
      <rect x="61" y="67" width="96" height="58" rx="9" strokeWidth="2.5" />
      {/* screen content: danmaku streaking past a play wedge */}
      <path d="M69 79 H92" strokeWidth="3" strokeLinecap="round" />
      <path d="M126 113 H149" strokeWidth="3" strokeLinecap="round" />
      <path
        d="M103 85 L103 107 L121 96 Z"
        strokeWidth="2.5"
        strokeLinejoin="round"
      />
      {/* feet */}
      <path d="M76 140 V150" strokeWidth="3" strokeLinecap="round" />
      <path d="M142 140 V150" strokeWidth="3" strokeLinecap="round" />
      {/* a stray danmaku bubble drifting by */}
      <rect x="178" y="38" width="34" height="20" rx="10" strokeWidth="2.5" />
      <path d="M186 48 H204" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  </Box>
)

/** Gradient folder-with-play glyph for the open button (replaces the stock MUI icon). */
const OpenIcon = () => (
  <Box
    component="svg"
    aria-hidden
    viewBox="0 0 22 22"
    sx={{ width: 20, height: 20, flexShrink: 0 }}
  >
    <defs>
      <linearGradient id="da-open-grad" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor="#c4b5fd" />
        <stop offset="1" stopColor="#e879f9" />
      </linearGradient>
    </defs>
    <path
      d="M2.5 6.5C2.5 5.4 3.4 4.5 4.5 4.5H8L10 6.5H17.5C18.6 6.5 19.5 7.4 19.5 8.5V15.5C19.5 16.6 18.6 17.5 17.5 17.5H4.5C3.4 17.5 2.5 16.6 2.5 15.5V6.5Z"
      fill="none"
      stroke="#fff"
      strokeOpacity="0.9"
      strokeWidth="1.6"
      strokeLinejoin="round"
    />
    <path d="M9.4 9.3L14.4 12L9.4 14.7Z" fill="url(#da-open-grad)" />
  </Box>
)

/** Mini video-thumbnail glyph for the continue-watching cards. */
const RecentThumb = () => (
  <Box
    component="svg"
    aria-hidden
    viewBox="0 0 44 30"
    sx={{
      width: 44,
      height: 30,
      flexShrink: 0,
      color: 'rgba(196,181,253,0.55)',
    }}
  >
    <rect
      x="1.5"
      y="1.5"
      width="41"
      height="27"
      rx="7"
      fill="rgba(167,139,250,0.08)"
      stroke="currentColor"
      strokeWidth="1.5"
    />
    <path d="M18.5 10 L18.5 20 L27 15 Z" fill="currentColor" />
    <path
      d="M7 8.5 H13"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
    />
    <path
      d="M31 21.5 H37"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
    />
  </Box>
)

/**
 * The idle stage. Not a drop-zone card but a scene: projector beam, floor
 * glow, ghost danmaku drifting by, the mark front and center, and — because
 * the playlist is a persistent history now — a "continue watching" strip.
 */
export const EmptyState = () => {
  const commands = usePlayerCommands()
  const playlist = usePlayerStore((s) => s.playlist)
  const progress = usePlayerStore((s) => s.progress)
  const recent = pickRecent(playlist, progress)

  return (
    <Box
      sx={{
        position: 'absolute',
        inset: 0,
        overflow: 'hidden',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        p: 3,
        // ambient pools of violet/fuchsia in the dark
        background:
          'radial-gradient(110% 80% at 20% -12%, rgba(167,139,250,0.13), transparent 55%),' +
          'radial-gradient(90% 70% at 104% 112%, rgba(232,121,249,0.10), transparent 60%)',
        '@keyframes da-drift': {
          from: { transform: 'translateX(104vw)' },
          to: { transform: 'translateX(-110%)' },
        },
        '@keyframes da-rise': {
          from: { opacity: 0, transform: 'translateY(14px)' },
          to: { opacity: 1, transform: 'translateY(0)' },
        },
        '@keyframes da-bob': {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-8px)' },
        },
        '@keyframes da-twinkle': {
          '0%, 100%': { opacity: 0.2, transform: 'scale(0.75)' },
          '50%': { opacity: 0.9, transform: 'scale(1)' },
        },
      }}
    >
      {/* soft light falling from above the stage (no hard edges) */}
      <Box
        aria-hidden
        sx={{
          position: 'absolute',
          left: '50%',
          top: '-28%',
          width: '120%',
          height: '85%',
          transform: 'translateX(-50%)',
          background:
            'radial-gradient(48% 60% at 50% 22%, rgba(196,181,253,0.09), transparent 72%)',
          pointerEvents: 'none',
        }}
      />
      {/* floor glow where the beam lands */}
      <Box
        aria-hidden
        sx={{
          position: 'absolute',
          left: '50%',
          bottom: '4%',
          width: '68%',
          height: '22%',
          transform: 'translateX(-50%)',
          background:
            'radial-gradient(50% 50% at 50% 50%, rgba(167,139,250,0.12), transparent 70%)',
          filter: 'blur(6px)',
          pointerEvents: 'none',
        }}
      />
      {/* film grain */}
      <Box
        aria-hidden
        sx={{
          position: 'absolute',
          inset: 0,
          opacity: 0.05,
          pointerEvents: 'none',
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/%3E%3C/filter%3E%3Crect width='140' height='140' filter='url(%23n)' opacity='0.6'/%3E%3C/svg%3E\")",
        }}
      />

      {/* ghost danmaku */}
      {GHOSTS.map(([text, top, duration, delay, fontSize, opacity]) => (
        <Typography
          key={text}
          aria-hidden
          sx={{
            position: 'absolute',
            top: `${top}%`,
            left: 0,
            whiteSpace: 'nowrap',
            fontWeight: 700,
            fontSize,
            color: '#fff',
            opacity,
            pointerEvents: 'none',
            animation: `da-drift ${duration}s linear ${delay}s infinite`,
            willChange: 'transform',
          }}
        >
          {text}
        </Typography>
      ))}

      <TvMascot />

      {/* the scene itself */}
      <Stack
        alignItems="center"
        spacing={0}
        sx={{ textAlign: 'center', maxWidth: 560, width: '100%', zIndex: 1 }}
      >
        {/* typography-led hero — the brand IS the picture. Two stacked layers:
            a blurred neon bloom underneath, a metallic gradient with a slow
            specular sweep on top. */}
        <Box
          sx={{
            position: 'relative',
            animation: 'da-rise 600ms cubic-bezier(0.2,0.8,0.2,1) both',
            '@keyframes da-sheen': {
              '0%': { backgroundPosition: '0% 50%' },
              '100%': { backgroundPosition: '100% 50%' },
            },
          }}
        >
          <Typography
            aria-hidden
            component="span"
            sx={{
              position: 'absolute',
              inset: 0,
              fontSize: 'clamp(40px, 6vw, 64px)',
              fontWeight: 900,
              lineHeight: 1.15,
              letterSpacing: '0.06em',
              backgroundImage:
                'linear-gradient(105deg, #7c3aed, #d946ef 70%, #a855f7)',
              backgroundClip: 'text',
              WebkitBackgroundClip: 'text',
              color: 'transparent',
              WebkitTextFillColor: 'transparent',
              filter: 'blur(22px) saturate(150%)',
              opacity: 0.65,
              userSelect: 'none',
              pointerEvents: 'none',
            }}
          >
            弹幕播放器
          </Typography>
          {/* anime sparkles around the wordmark, twinkling out of phase */}
          <Sparkle
            size={16}
            sx={{
              top: -18,
              left: -44,
              color: '#c4b5fd',
              animation: 'da-twinkle 2.8s ease-in-out infinite',
            }}
          />
          <Sparkle
            size={11}
            sx={{
              top: 26,
              right: -38,
              color: '#f0abfc',
              animation: 'da-twinkle 3.4s ease-in-out 0.9s infinite',
            }}
          />
          <Sparkle
            size={8}
            sx={{
              bottom: -4,
              left: -20,
              color: '#e879f9',
              animation: 'da-twinkle 3s ease-in-out 1.7s infinite',
            }}
          />
          <Typography
            component="h1"
            sx={{
              position: 'relative',
              fontSize: 'clamp(40px, 6vw, 64px)',
              fontWeight: 900,
              lineHeight: 1.15,
              letterSpacing: '0.06em',
              backgroundImage: RICH_GRADIENT,
              backgroundSize: '220% 100%',
              backgroundClip: 'text',
              WebkitBackgroundClip: 'text',
              color: 'transparent',
              WebkitTextFillColor: 'transparent',
              animation: 'da-sheen 7s ease-in-out infinite alternate',
            }}
          >
            弹幕播放器
          </Typography>
        </Box>
        <Typography
          variant="body2"
          sx={{
            color: 'rgba(255,255,255,0.4)',
            letterSpacing: '0.42em',
            textTransform: 'uppercase',
            fontSize: 12,
            mt: 1.25,
            ml: '0.42em',
            animation: 'da-rise 600ms cubic-bezier(0.2,0.8,0.2,1) 80ms both',
          }}
        >
          Danmaku Player
        </Typography>

        <Typography
          sx={{
            color: 'rgba(255,255,255,0.55)',
            fontSize: 15,
            mt: 4,
            animation: 'da-rise 600ms cubic-bezier(0.2,0.8,0.2,1) 140ms both',
          }}
        >
          拖入视频文件，或点击打开
        </Typography>

        {/* SVG stroke-dash button: a gradient light segment runs around the
            pill outline (pathLength-normalized, so it works at any width);
            hovering draws the stroke closed and blooms. */}
        <Box
          component="button"
          type="button"
          onClick={() => void commands.openVideo()}
          sx={{
            all: 'unset',
            cursor: 'pointer',
            position: 'relative',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 1,
            mt: 3,
            px: 4.5,
            py: 1.4,
            borderRadius: '999px',
            fontSize: 15,
            fontWeight: 700,
            color: '#fff',
            backgroundColor: 'rgba(18, 13, 30, 0.85)',
            animation: 'da-rise 600ms cubic-bezier(0.2,0.8,0.2,1) 200ms both',
            transition:
              'background-color 200ms ease, box-shadow 250ms ease, transform 200ms ease',
            '@keyframes da-dash': {
              to: { strokeDashoffset: -100 },
            },
            '& .da-btn-rect': {
              // one gradient comet (14%) orbiting the outline
              strokeDasharray: '14 86',
              animation: 'da-dash 3.2s linear infinite',
              transition: 'stroke-dasharray 450ms ease',
            },
            '&:hover': {
              backgroundColor: 'rgba(32, 22, 52, 0.92)',
              boxShadow: '0 10px 38px rgba(168,85,247,0.4)',
              transform: 'translateY(-1px)',
              '& .da-btn-rect': {
                // the comet stretches into a fully drawn border
                strokeDasharray: '100 0',
              },
            },
            '&:focus-visible': {
              outline: '2px solid rgba(196,181,253,0.7)',
              outlineOffset: 2,
            },
          }}
        >
          <Box
            component="svg"
            aria-hidden
            sx={{
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              overflow: 'visible',
              pointerEvents: 'none',
              filter: 'drop-shadow(0 0 6px rgba(168,85,247,0.65))',
            }}
          >
            <defs>
              <linearGradient id="da-btn-grad" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor="#8b5cf6" />
                <stop offset="0.55" stopColor="#c4b5fd" />
                <stop offset="1" stopColor="#e879f9" />
              </linearGradient>
            </defs>
            <rect
              className="da-btn-rect"
              x="1"
              y="1"
              rx="999"
              pathLength={100}
              fill="none"
              stroke="url(#da-btn-grad)"
              strokeWidth="2"
              strokeLinecap="round"
              style={{ width: 'calc(100% - 2px)', height: 'calc(100% - 2px)' }}
            />
          </Box>
          <OpenIcon />
          打开视频 / Open
        </Box>

        <Typography
          variant="caption"
          sx={{
            color: 'rgba(255,255,255,0.35)',
            mt: 1.75,
            animation: 'da-rise 600ms cubic-bezier(0.2,0.8,0.2,1) 260ms both',
          }}
        >
          支持 MP4 / MKV / WebM 等主流格式 · 同名 .xml / .json 弹幕自动挂载
        </Typography>

        {/* continue watching */}
        {recent.length > 0 && (
          <Box
            sx={{
              width: '100%',
              mt: 5,
              animation: 'da-rise 600ms cubic-bezier(0.2,0.8,0.2,1) 340ms both',
            }}
          >
            <Stack
              direction="row"
              alignItems="center"
              spacing={0.75}
              sx={{ mb: 1.25, px: 0.5, color: 'rgba(255,255,255,0.4)' }}
            >
              <HistoryRounded sx={{ fontSize: 15 }} />
              <Typography
                variant="caption"
                sx={{ fontWeight: 700, letterSpacing: '0.12em' }}
              >
                继续观看
              </Typography>
            </Stack>
            <Stack spacing={0.75}>
              {recent.map(({ item, entry }) => {
                const ratio =
                  entry.duration > 0
                    ? Math.min(1, entry.time / entry.duration)
                    : 0
                return (
                  <Box
                    key={item.path}
                    component="button"
                    type="button"
                    onClick={() =>
                      item.path && commands.openVideoFromPath(item.path)
                    }
                    sx={{
                      all: 'unset',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 1.25,
                      px: 1.5,
                      py: 1,
                      borderRadius: '14px',
                      border: '1px solid rgba(255,255,255,0.07)',
                      backgroundColor: 'rgba(255,255,255,0.03)',
                      transition:
                        'background-color 140ms ease, border-color 140ms ease',
                      '&:hover': {
                        backgroundColor: 'rgba(167,139,250,0.10)',
                        borderColor: 'rgba(167,139,250,0.35)',
                        '& .da-recent-play': { opacity: 1 },
                      },
                    }}
                  >
                    <RecentThumb />
                    <Box sx={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                      <Typography
                        variant="body2"
                        noWrap
                        title={item.name}
                        sx={{
                          fontWeight: 600,
                          color: 'rgba(255,255,255,0.85)',
                        }}
                      >
                        {item.name}
                      </Typography>
                      <Stack
                        direction="row"
                        alignItems="center"
                        spacing={1}
                        sx={{ mt: 0.5 }}
                      >
                        <LinearProgress
                          variant="determinate"
                          value={ratio * 100}
                          sx={{
                            flex: 1,
                            height: 3,
                            borderRadius: 2,
                            bgcolor: 'rgba(255,255,255,0.10)',
                          }}
                        />
                        <Typography
                          variant="caption"
                          sx={{
                            color: 'rgba(255,255,255,0.4)',
                            fontVariantNumeric: 'tabular-nums',
                            flexShrink: 0,
                          }}
                        >
                          {formatTime(entry.time)}
                          {entry.duration > 0 &&
                            ` / ${formatTime(entry.duration)}`}
                        </Typography>
                      </Stack>
                    </Box>
                    <PlayArrowRounded
                      className="da-recent-play"
                      sx={{
                        color: 'primary.light',
                        opacity: 0,
                        transition: 'opacity 140ms ease',
                        flexShrink: 0,
                      }}
                    />
                  </Box>
                )
              })}
            </Stack>
          </Box>
        )}
      </Stack>
    </Box>
  )
}

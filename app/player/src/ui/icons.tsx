import { Box } from '@mui/material'
import type { ReactNode } from 'react'

export interface IconProps {
  size?: number
  /** Defaults to the theme's 2px stroke. */
  strokeWidth?: number
  sx?: object
  title?: string
}

const InkSvg = ({
  size = 16,
  strokeWidth = 2,
  sx,
  title,
  children,
}: IconProps & { children: ReactNode }) => (
  <Box
    component={'svg'}
    viewBox={'0 0 24 24'}
    role={title ? 'img' : undefined}
    aria-hidden={title ? undefined : true}
    aria-label={title}
    focusable={'false'}
    sx={{
      width: size,
      height: size,
      display: 'block',
      flexShrink: 0,
      overflow: 'visible',
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth,
      strokeLinecap: 'square',
      strokeLinejoin: 'miter',
      pointerEvents: 'none',
      ...(sx ?? {}),
    }}
  >
    {children}
  </Box>
)

export const PlayIcon = (props: IconProps) => (
  <InkSvg {...props}>
    <path d={'M7 4.5 20 12 7 19.5Z'} />
  </InkSvg>
)

export const PauseIcon = (props: IconProps) => (
  <InkSvg {...props}>
    <path d={'M8 5v14M16 5v14'} strokeWidth={3} />
  </InkSvg>
)

export const PrevIcon = (props: IconProps) => (
  <InkSvg {...props}>
    <path d={'M19 5 8 12l11 7Z'} />
    <path d={'M5 5v14'} />
  </InkSvg>
)

export const NextIcon = (props: IconProps) => (
  <InkSvg {...props}>
    <path d={'M5 5l11 7-11 7Z'} />
    <path d={'M19 5v14'} />
  </InkSvg>
)

export const SkipForwardIcon = (props: IconProps) => (
  <InkSvg {...props}>
    <path d={'M5 5l10 7-10 7Z'} />
    <path d={'M18 5v14'} />
  </InkSvg>
)

export const VolumeIcon = (props: IconProps) => (
  <InkSvg {...props}>
    <path d={'M4 9h4l5-4v14l-5-4H4Z'} />
    <path d={'M16.5 8.5a5 5 0 0 1 0 7'} />
    <path d={'M19 6a8.5 8.5 0 0 1 0 12'} />
  </InkSvg>
)

export const VolumeMuteIcon = (props: IconProps) => (
  <InkSvg {...props}>
    <path d={'M4 9h4l5-4v14l-5-4H4Z'} />
    <path d={'m16 9 5 5M21 9l-5 5'} />
  </InkSvg>
)

export const MiniPlayerIcon = (props: IconProps) => (
  <InkSvg {...props}>
    <rect x={3} y={5} width={18} height={14} />
    <path d={'M12 11h6v5h-6Z'} fill={'currentColor'} stroke={'none'} />
  </InkSvg>
)

export const FullscreenIcon = (props: IconProps) => (
  <InkSvg {...props}>
    <path d={'M4 9V4h5'} />
    <path d={'M15 4h5v5'} />
    <path d={'M20 15v5h-5'} />
    <path d={'M9 20H4v-5'} />
  </InkSvg>
)

export const ExitFullscreenIcon = (props: IconProps) => (
  <InkSvg {...props}>
    <path d={'M9 4v5H4'} />
    <path d={'M15 4v5h5'} />
    <path d={'M20 15h-5v5'} />
    <path d={'M4 15h5v5'} />
  </InkSvg>
)

export const MinimizeIcon = (props: IconProps) => (
  <InkSvg {...props}>
    <path d={'M4 12h16'} />
  </InkSvg>
)

export const MaximizeIcon = (props: IconProps) => (
  <InkSvg {...props}>
    <rect x={5} y={5} width={14} height={14} />
  </InkSvg>
)

export const CloseIcon = (props: IconProps) => (
  <InkSvg {...props}>
    <path d={'m5 5 14 14M19 5 5 19'} />
  </InkSvg>
)

export const ChevronUpIcon = (props: IconProps) => (
  <InkSvg {...props}>
    <path d={'m5 15 7-7 7 7'} />
  </InkSvg>
)

export const ArrowRightIcon = (props: IconProps) => (
  <InkSvg {...props}>
    <path d={'M4 12h15M13 6l6 6-6 6'} />
  </InkSvg>
)

export const PlusIcon = (props: IconProps) => (
  <InkSvg {...props}>
    <path d={'M12 5v14M5 12h14'} />
  </InkSvg>
)

export const MinusIcon = (props: IconProps) => (
  <InkSvg {...props}>
    <path d={'M5 12h14'} />
  </InkSvg>
)

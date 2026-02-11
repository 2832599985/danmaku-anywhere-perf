import type { DanmakuOptions } from '@/common/options/danmakuOptions/constant'

export type DanmakuPresetId = 'minimal' | 'balanced' | 'immersive' | 'eyeCare'

export interface DanmakuPreset {
  readonly id: DanmakuPresetId
  readonly values: Partial<DanmakuOptions>
}

/**
 * Minimal: fewer danmaku, smaller text, high transparency
 */
const minimal: DanmakuPreset = {
  id: 'minimal',
  values: {
    style: {
      opacity: 0.4,
      fontSize: 18,
      fontFamily: 'sans-serif',
    },
    speed: 1,
    maxOnScreen: 150,
    trackHeight: 36,
    overlap: 0,
    interval: 400,
    area: {
      yStart: 0,
      yEnd: 50,
      xStart: 0,
      xEnd: 100,
    },
  },
}

/**
 * Balanced: moderate settings suitable for most use cases
 */
const balanced: DanmakuPreset = {
  id: 'balanced',
  values: {
    style: {
      opacity: 0.7,
      fontSize: 25,
      fontFamily: 'sans-serif',
    },
    speed: 1,
    maxOnScreen: 500,
    trackHeight: 32,
    overlap: 100,
    interval: 200,
    area: {
      yStart: 0,
      yEnd: 80,
      xStart: 0,
      xEnd: 100,
    },
  },
}

/**
 * Immersive: more danmaku, larger text, full screen
 */
const immersive: DanmakuPreset = {
  id: 'immersive',
  values: {
    style: {
      opacity: 0.85,
      fontSize: 28,
      fontFamily: 'sans-serif',
    },
    speed: 1,
    maxOnScreen: 800,
    trackHeight: 28,
    overlap: 200,
    interval: 100,
    area: {
      yStart: 0,
      yEnd: 100,
      xStart: 0,
      xEnd: 100,
    },
  },
}

/**
 * Eye-Care: reduced opacity and smaller text to reduce eye strain
 */
const eyeCare: DanmakuPreset = {
  id: 'eyeCare',
  values: {
    style: {
      opacity: 0.35,
      fontSize: 20,
      fontFamily: 'sans-serif',
    },
    speed: 0.75,
    maxOnScreen: 200,
    trackHeight: 40,
    overlap: 0,
    interval: 500,
    area: {
      yStart: 10,
      yEnd: 60,
      xStart: 0,
      xEnd: 100,
    },
  },
}

export const danmakuPresets: readonly DanmakuPreset[] = [
  minimal,
  balanced,
  immersive,
  eyeCare,
]

export const danmakuPresetsMap: Record<DanmakuPresetId, DanmakuPreset> = {
  minimal,
  balanced,
  immersive,
  eyeCare,
}

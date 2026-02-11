export interface DensityPoint {
  time: number
  value: number
}

export interface SkipRegion {
  /** Start time in seconds */
  startTime: number
  /** End time in seconds */
  endTime: number
  /** 'op' for opening, 'ed' for ending */
  type: 'op' | 'ed'
}

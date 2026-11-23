/**
 * Brand colors: third-party provider/platform colors intentionally EXEMPT from theming.
 *
 * These are brand identity colors (Bilibili, Tencent, QQ, DanDanPlay, etc.) that
 * must remain stable regardless of the UI theme. Centralized here to eliminate
 * hardcoded hex values scattered across icon components.
 *
 * Usage: import { BRAND_COLORS } from '@/common/theme/brandColors'
 * Never import or re-export these in component libraries that auto-migrate colors.
 */

export const BRAND_COLORS = {
  bilibili: '#00aeec',
  tencentVideo: {
    blue: '#009AFF',
    orange: '#FF8800',
    green: '#43E700',
  },
  cnFlag: {
    red: '#DC2E27',
    yellow: '#F7DC15',
    black: '#000000',
  },
} as const

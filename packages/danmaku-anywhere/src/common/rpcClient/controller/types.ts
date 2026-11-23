import type { GenericEpisodeLite } from '@danmaku-anywhere/danmaku-converter'
import type { RPCDef } from '../../rpc/types'

export interface ControllerDanmakuState {
  isMounted: boolean
  manual: boolean
}

export type ControllerMethods = {
  /**
   * Ping the tab to check if it's able to receive messages
   */
  ping: RPCDef<void, true>
  danmakuMount: RPCDef<GenericEpisodeLite[], void>
  danmakuUnmount: RPCDef<void, void>
  danmakuGetState: RPCDef<void, ControllerDanmakuState | null>
  invalidateCache: RPCDef<void, void>
  /**
   * Notified by background when webNavigation.onHistoryStateUpdated fires,
   * indicating a SPA navigation (pushState/replaceState) occurred.
   */
  navigationStateUpdated: RPCDef<{ url: string }, void>
  /**
   * Notified by background when webNavigation.onDOMContentLoaded fires
   * for a sub-frame, indicating a new frame is ready for injection.
   */
  frameNavigated: RPCDef<{ frameId: number; url: string }, void>
}

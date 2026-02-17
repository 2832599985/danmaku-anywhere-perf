import { i18n } from '@/common/localization/i18n'
import type { Hotkey } from '@/common/options/extensionOptions/schema'
import { createLocalizationMap } from '@/common/utils/createLocalizationMap'

export const createHotkey = (key: string, enabled = true) => {
  return {
    key,
    enabled,
  }
}

export const ALL_HOTKEYS = [
  'toggleEnableDanmaku',
  'togglePip',
  'refreshComments',
  'unmountComments',
  'increaseOpacity',
  'decreaseOpacity',
  'increaseFontSize',
  'decreaseFontSize',
  'skipOp',
  'toggleStylePanel',
  'danmakuTimeOffsetIncrease',
  'danmakuTimeOffsetDecrease',
  'danmakuDensityToggle',
  'danmakuSpeedToggle',
  'increaseSpeed',
  'decreaseSpeed',
  'increaseOffset',
  'decreaseOffset',
  'toggleDensityPlot',
] as const

export type AllHotkeys = (typeof ALL_HOTKEYS)[number]

export const HOTKEY_LABELS = createLocalizationMap<AllHotkeys>({
  toggleEnableDanmaku: () =>
    i18n.t('optionsPage.hotkeys.toggleEnableDanmaku', 'Show/Hide danmaku'),
  togglePip: () =>
    i18n.t('optionsPage.hotkeys.togglePip', 'Picture-in-picture'),
  refreshComments: () =>
    i18n.t('optionsPage.hotkeys.refreshComments', 'Refresh comments'),
  unmountComments: () =>
    i18n.t('optionsPage.hotkeys.unmountComments', 'Unmount comments'),
  increaseOpacity: () =>
    i18n.t('optionsPage.hotkeys.increaseOpacity', 'Increase opacity (+10%)'),
  decreaseOpacity: () =>
    i18n.t('optionsPage.hotkeys.decreaseOpacity', 'Decrease opacity (-10%)'),
  increaseFontSize: () =>
    i18n.t('optionsPage.hotkeys.increaseFontSize', 'Increase font size (+2px)'),
  decreaseFontSize: () =>
    i18n.t('optionsPage.hotkeys.decreaseFontSize', 'Decrease font size (-2px)'),
  skipOp: () => i18n.t('optionsPage.hotkeys.skipOp', 'Skip OP'),
  toggleStylePanel: () =>
    i18n.t('optionsPage.hotkeys.toggleStylePanel', 'Toggle style panel'),
  danmakuTimeOffsetIncrease: () =>
    i18n.t(
      'optionsPage.hotkeys.danmakuTimeOffsetIncrease',
      'Danmaku time offset +0.5s'
    ),
  danmakuTimeOffsetDecrease: () =>
    i18n.t(
      'optionsPage.hotkeys.danmakuTimeOffsetDecrease',
      'Danmaku time offset -0.5s'
    ),
  danmakuDensityToggle: () =>
    i18n.t(
      'optionsPage.hotkeys.danmakuDensityToggle',
      'Toggle danmaku density'
    ),
  danmakuSpeedToggle: () =>
    i18n.t('optionsPage.hotkeys.danmakuSpeedToggle', 'Toggle danmaku speed'),
  increaseSpeed: () =>
    i18n.t('optionsPage.hotkeys.increaseSpeed', 'Increase speed (+0.25)'),
  decreaseSpeed: () =>
    i18n.t('optionsPage.hotkeys.decreaseSpeed', 'Decrease speed (-0.25)'),
  increaseOffset: () =>
    i18n.t('optionsPage.hotkeys.increaseOffset', 'Danmaku time offset +1s'),
  decreaseOffset: () =>
    i18n.t('optionsPage.hotkeys.decreaseOffset', 'Danmaku time offset -1s'),
  toggleDensityPlot: () =>
    i18n.t(
      'optionsPage.hotkeys.toggleDensityPlot',
      'Toggle danmaku density plot'
    ),
})

export type Keymap = Record<AllHotkeys, Hotkey>

export const defaultKeymap: Keymap = {
  toggleEnableDanmaku: createHotkey('shift+b'),
  refreshComments: createHotkey('shift+r'),
  unmountComments: createHotkey('shift+u'),
  togglePip: createHotkey('shift+p'),
  increaseOpacity: createHotkey(''),
  decreaseOpacity: createHotkey(''),
  increaseFontSize: createHotkey(''),
  decreaseFontSize: createHotkey(''),
  skipOp: createHotkey(''),
  toggleStylePanel: createHotkey(''),
  danmakuTimeOffsetIncrease: createHotkey(']'),
  danmakuTimeOffsetDecrease: createHotkey('['),
  danmakuDensityToggle: createHotkey('shift+d'),
  danmakuSpeedToggle: createHotkey(''),
  increaseSpeed: createHotkey(''),
  decreaseSpeed: createHotkey(''),
  increaseOffset: createHotkey(''),
  decreaseOffset: createHotkey(''),
  toggleDensityPlot: createHotkey(''),
} as const

/**
 * Detects conflicts in the keymap.
 * Returns a map from hotkey name to array of conflicting hotkey names.
 */
export const detectHotkeyConflicts = (
  keymap: Partial<Keymap>
): Map<AllHotkeys, AllHotkeys[]> => {
  const conflicts = new Map<AllHotkeys, AllHotkeys[]>()
  const keyToActions = new Map<string, AllHotkeys[]>()

  for (const [action, hotkey] of Object.entries(keymap)) {
    if (!hotkey?.key || !hotkey.enabled) continue
    const normalizedKey = hotkey.key.toLowerCase()
    const existing = keyToActions.get(normalizedKey) ?? []
    existing.push(action as AllHotkeys)
    keyToActions.set(normalizedKey, existing)
  }

  for (const actions of keyToActions.values()) {
    if (actions.length > 1) {
      for (const action of actions) {
        const others = actions.filter((a) => a !== action)
        conflicts.set(action, others)
      }
    }
  }

  return conflicts
}

const macModifierSymbols: Record<string, string> = {
  ctrl: '⌃',
  shift: '⇧',
  alt: '⌥',
  meta: '⌘',
}

const keySymbols: Record<string, string> = {
  ctrl: 'Ctrl',
  shift: 'Shift',
  alt: 'Alt',
  meta: 'Win',
  arrowLeft: '←',
  arrowRight: '→',
  arrowUp: '↑',
  arrowDown: '↓',
  ' ': 'Space',
  backspace: '⌫',
}

interface GetKeySymbolMapOptions {
  isMacOs?: boolean
}

export const getKeySymbolMap = ({
  isMacOs = false,
}: GetKeySymbolMapOptions = {}) => {
  if (isMacOs) {
    return { ...keySymbols, ...macModifierSymbols }
  }
  return keySymbols
}

import { i18n } from '@/common/localization/i18n'
import { useToast } from '../components/Toast/toastStore'
import type { ExtensionOptions } from '../options/extensionOptions/schema'
import { chromeRpcClient } from '../rpcClient/background/client'
import { copyToClipboard } from '../utils/copyToClipboard'
import { tryCatch } from '../utils/tryCatch'

// Category for UI grouping
export type SettingCategory = 'advanced' | 'player' | 'general'

type CommonSettingConfig = {
  // Unique command ID for this setting
  id: string
  // Category for UI grouping
  category: SettingCategory
  // Description (translation key)
  descriptionKey?: string
  // Label or translation key for the setting
  label: () => string
}

export type ToggleSettingConfig<S> = CommonSettingConfig & {
  type: 'toggle'
  getValue: (state: S) => boolean
  createUpdate: (state: S, newValue: boolean) => Partial<S>
}

export type ButtonSettingConfig = CommonSettingConfig & {
  type: 'button'
  handler: () => void | Promise<void>
}

// Union type for all setting configs
export type SettingConfig<S> = ToggleSettingConfig<S>

const advancedSettings: SettingConfig<ExtensionOptions>[] = [
  {
    id: 'toggle.analytics',
    label: () =>
      i18n.t('optionsPage.enableAnalytics', 'Enable anonymous analytics'),
    category: 'advanced',
    type: 'toggle',
    getValue: (options) => options.enableAnalytics,
    createUpdate: (_, newValue) => ({ enableAnalytics: newValue }),
  },
  {
    id: 'toggle.debug',
    label: () => 'Debug',
    category: 'advanced',
    type: 'toggle',
    getValue: (options) => options.debug,
    createUpdate: (_, newValue) => ({ debug: newValue }),
  },
  {
    id: 'toggle.matchLocalDanmaku',
    label: () =>
      i18n.t('optionsPage.matchLocalDanmaku', 'Enable matching local Danmaku'),
    category: 'advanced',
    type: 'toggle',
    getValue: (options) => options.matchLocalDanmaku,
    createUpdate: (_, newValue) => ({ matchLocalDanmaku: newValue }),
  },
  {
    id: 'toggle.searchUsingSimplified',
    label: () =>
      i18n.t(
        'optionsPage.searchUsingSimplified',
        'Search using simplified Chinese'
      ),
    category: 'advanced',
    type: 'toggle',
    getValue: (options) => options.searchUsingSimplified,
    createUpdate: (_, newValue) => ({ searchUsingSimplified: newValue }),
  },
  {
    id: 'toggle.restrictInitiatorDomain',
    label: () =>
      i18n.t(
        'optionsPage.restrictInitiatorDomain',
        'Limit DNR initiator domains to this extension'
      ),
    category: 'advanced',
    type: 'toggle',
    getValue: (options) => options.restrictInitiatorDomain,
    createUpdate: (_, newValue) => ({ restrictInitiatorDomain: newValue }),
  },
  {
    id: 'toggle.enableMultiSourceMerge',
    label: () =>
      i18n.t(
        'optionsPage.enableMultiSourceMerge',
        'Enable multi-source danmaku merge'
      ),
    descriptionKey: 'optionsPage.enableMultiSourceMergeDescription',
    category: 'advanced',
    type: 'toggle',
    getValue: (options) => options.enableMultiSourceMerge,
    createUpdate: (_, newValue) => ({ enableMultiSourceMerge: newValue }),
  },
]

const playerSettings: SettingConfig<ExtensionOptions>[] = [
  {
    id: 'toggle.player.showSkipButton',
    label: () =>
      i18n.t('optionsPage.player.showSkipButton', 'Show skip button (OP/ED)'),
    category: 'player',
    type: 'toggle',
    getValue: (options) => options.playerOptions.showSkipButton,
    createUpdate: (options, newValue) => ({
      playerOptions: {
        ...options.playerOptions,
        showSkipButton: newValue,
      },
    }),
  },
  {
    id: 'toggle.player.autoSkipOp',
    label: () =>
      i18n.t('optionsPage.player.autoSkipOp', 'Auto skip opening (OP)'),
    category: 'player',
    type: 'toggle',
    getValue: (options) => options.playerOptions.autoSkipOp,
    createUpdate: (options, newValue) => ({
      playerOptions: {
        ...options.playerOptions,
        autoSkipOp: newValue,
      },
    }),
  },
  {
    id: 'toggle.player.showDanmakuTimeline',
    label: () =>
      i18n.t('optionsPage.player.showDanmakuTimeline', 'Show danmaku density'),
    category: 'player',
    type: 'toggle',
    getValue: (options) => options.playerOptions.showDanmakuTimeline,
    createUpdate: (options, newValue) => ({
      playerOptions: {
        ...options.playerOptions,
        showDanmakuTimeline: newValue,
      },
    }),
  },
  {
    id: 'toggle.player.enableFixedSkip',
    label: () =>
      i18n.t(
        'optionsPage.player.enableFixedSkip',
        'Show fixed time skip button'
      ),
    category: 'player',
    type: 'toggle',
    getValue: (options) => options.playerOptions.enableFixedSkip,
    createUpdate: (options, newValue) => ({
      playerOptions: {
        ...options.playerOptions,
        enableFixedSkip: newValue,
      },
    }),
  },
  {
    id: 'toggle.player.autoDensity',
    label: () =>
      i18n.t('optionsPage.player.autoDensity', 'Auto-adjust danmaku density'),
    category: 'player',
    type: 'toggle',
    getValue: (options) => options.playerOptions.autoDensity,
    createUpdate: (options, newValue) => ({
      playerOptions: {
        ...options.playerOptions,
        autoDensity: newValue,
      },
    }),
  },
  {
    id: 'toggle.player.autoNextEpisode',
    label: () =>
      i18n.t(
        'optionsPage.player.autoNextEpisode',
        'Auto load next episode danmaku'
      ),
    category: 'player',
    type: 'toggle',
    getValue: (options) => options.playerOptions.autoNextEpisode,
    createUpdate: (options, newValue) => ({
      playerOptions: {
        ...options.playerOptions,
        autoNextEpisode: newValue,
      },
    }),
  },
]

export const UPLOAD_DEBUG_DATA_BUTTON: ButtonSettingConfig = {
  id: 'button.uploadDebugData',
  label: () => i18n.t('optionsPage.uploadDebugData', 'Submit Debug Data'),
  category: 'advanced',
  type: 'button',
  handler: async () => {
    const [result, error] = await tryCatch(() =>
      chromeRpcClient.exportDebugData()
    )
    if (error) {
      useToast.getState().toast.error(error.message)
    } else {
      useToast.getState().toast.success(
        i18n.t('optionsPage.uploadDebugDataSuccess', 'Submitted {{ id }}', {
          id: result.data.id,
        }),
        {
          actionFn: () => {
            copyToClipboard(result.data.id)
          },
          actionLabel: i18n.t('common.copy', 'Copy'),
          duration: 10000,
        }
      )
    }
  },
}

export const settingConfigs = {
  advanced: advancedSettings,
  player: playerSettings,
}

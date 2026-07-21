import { DanDanChConvert } from '@danmaku-anywhere/danmaku-provider/ddp'

import { Language } from '@/common/localization/language'
import { defaultKeymap } from '@/common/options/extensionOptions/hotkeys'
import type { ExtensionOptions } from '@/common/options/extensionOptions/schema'
import { ColorMode } from '@/common/theme/enums'

export const ChConvertList = [
  {
    label: 'optionsPage.chConvert.none',
    value: DanDanChConvert.None,
  },
  {
    label: 'optionsPage.chConvert.simplified',
    value: DanDanChConvert.Simplified,
  },
  {
    label: 'optionsPage.chConvert.traditional',
    value: DanDanChConvert.Traditional,
  },
] as const

export const defaultExtensionOptions: ExtensionOptions = {
  enabled: true,
  debug: false,
  lang: Language.zh,
  searchUsingSimplified: false,
  retentionPolicy: {
    enabled: false,
    deleteCommentsAfter: 30,
  },
  // danmakuSources removed - now managed in separate provider config storage
  playerOptions: {
    showSkipButton: true,
    autoSkipOp: false,
    showDanmakuTimeline: true,
    enableFixedSkip: false,
    fixedSkipSeconds: 90,
    autoDensity: false,
    autoNextEpisode: true,
    enableFullscreenInteraction: true,
    enableTranslation: false,
    translationTargetLang: 'en',
    upscale: {
      enabled: false,
      modeId: 'builtin-mode-a',
      performanceTier: 'balanced',
      targetResolution: 'x2',
      enableCrossOriginFix: false,
      frameInterpolation: {
        enabled: false,
        resolution: '720p',
      },
    },
  },
  theme: {
    colorMode: ColorMode.System,
    themeId: 'neon-violet',
  },
  matchLocalDanmaku: true,
  hotkeys: defaultKeymap,
  showReleaseNotes: false,
  enableAnalytics: true,
  id: undefined,
  restrictInitiatorDomain: true,
  enableMultiSourceMerge: false,
  showFloatingButton: true,
}

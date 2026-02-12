import { useEventCallback } from '@mui/material'
import { produce } from 'immer'
import { useHotkeys } from 'react-hotkeys-hook'
import { useTranslation } from 'react-i18next'

import { useToast } from '@/common/components/Toast/toastStore'
import type { DanmakuOptions } from '@/common/options/danmakuOptions/constant'
import { useDanmakuOptions } from '@/common/options/danmakuOptions/useDanmakuOptions'
import { useHotkeyOptions } from '@/common/options/extensionOptions/useHotkeyOptions'
import { playerRpcClient } from '@/common/rpcClient/background/client'
import { PopupTab, usePopup } from '@/content/controller/store/popupStore'
import { useStore } from '@/content/controller/store/store'

const OPACITY_STEP = 0.1
const FONT_SIZE_STEP = 2
const TIME_OFFSET_STEP = 0.5
const DENSITY_PRESETS = [100, 200, 500, 1000] as const
const SPEED_PRESETS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const

export const GlobalHotkeyActions = () => {
  const { t } = useTranslation()
  const { getKeyCombo } = useHotkeyOptions()
  const { data: danmakuOptions, partialUpdate } = useDanmakuOptions()
  const { toast } = useToast()
  const { toggleOpen, setTab, isOpen, tab } = usePopup()
  const { activeFrame } = useStore.use.frame()

  const adjustOpacity = useEventCallback((delta: number) => {
    const updated = produce(danmakuOptions, (draft: DanmakuOptions) => {
      const current = draft.style.opacity
      draft.style.opacity =
        Math.round(Math.min(1, Math.max(0, current + delta)) * 100) / 100
    })
    partialUpdate(updated)
    toast.info(
      t('optionsPage.hotkeys.opacityChanged', {
        value: Math.round(updated.style.opacity * 100),
      })
    )
  })

  const adjustFontSize = useEventCallback((delta: number) => {
    const updated = produce(danmakuOptions, (draft: DanmakuOptions) => {
      const current = draft.style.fontSize
      draft.style.fontSize = Math.min(48, Math.max(4, current + delta))
    })
    partialUpdate(updated)
    toast.info(
      t('optionsPage.hotkeys.fontSizeChanged', {
        value: updated.style.fontSize,
      })
    )
  })

  const toggleStylePanel = () => {
    if (isOpen && tab === PopupTab.Styles) {
      toggleOpen(false)
    } else {
      setTab(PopupTab.Styles)
      toggleOpen(true)
    }
  }

  const skipOp = () => {
    if (activeFrame === undefined) return
    playerRpcClient.player['relay:command:skipOp']({
      frameId: activeFrame.frameId,
    })
  }

  const adjustTimeOffset = useEventCallback((delta: number) => {
    const updated = produce(danmakuOptions, (draft: DanmakuOptions) => {
      draft.offset = Math.round((draft.offset + delta) * 10) / 10
    })
    partialUpdate(updated)
    toast.info(
      t('optionsPage.hotkeys.timeOffsetChanged', {
        defaultValue: 'Time offset: {{value}}s',
        value: updated.offset >= 0 ? `+${updated.offset}` : updated.offset,
      })
    )
  })

  const toggleDensity = useEventCallback(() => {
    const currentDensity = danmakuOptions.maxOnScreen
    const currentIndex = DENSITY_PRESETS.indexOf(
      currentDensity as (typeof DENSITY_PRESETS)[number]
    )
    const nextIndex =
      currentIndex === -1 ? 0 : (currentIndex + 1) % DENSITY_PRESETS.length
    const nextDensity = DENSITY_PRESETS[nextIndex]
    const updated = produce(danmakuOptions, (draft: DanmakuOptions) => {
      draft.maxOnScreen = nextDensity
    })
    partialUpdate(updated)
    toast.info(
      t('optionsPage.hotkeys.densityChanged', {
        defaultValue: 'Danmaku density: {{value}}',
        value: nextDensity,
      })
    )
  })

  const toggleSpeed = useEventCallback(() => {
    const currentSpeed = danmakuOptions.speed
    const currentIndex = SPEED_PRESETS.indexOf(
      currentSpeed as (typeof SPEED_PRESETS)[number]
    )
    const nextIndex =
      currentIndex === -1 ? 0 : (currentIndex + 1) % SPEED_PRESETS.length
    const nextSpeed = SPEED_PRESETS[nextIndex]
    const updated = produce(danmakuOptions, (draft: DanmakuOptions) => {
      draft.speed = nextSpeed
    })
    partialUpdate(updated)
    toast.info(
      t('optionsPage.hotkeys.speedChanged', {
        defaultValue: 'Danmaku speed: {{value}}x',
        value: nextSpeed,
      })
    )
  })

  useHotkeys(
    getKeyCombo('increaseOpacity') || '',
    () => adjustOpacity(OPACITY_STEP),
    { enabled: !!getKeyCombo('increaseOpacity'), preventDefault: true }
  )

  useHotkeys(
    getKeyCombo('decreaseOpacity') || '',
    () => adjustOpacity(-OPACITY_STEP),
    { enabled: !!getKeyCombo('decreaseOpacity'), preventDefault: true }
  )

  useHotkeys(
    getKeyCombo('increaseFontSize') || '',
    () => adjustFontSize(FONT_SIZE_STEP),
    { enabled: !!getKeyCombo('increaseFontSize'), preventDefault: true }
  )

  useHotkeys(
    getKeyCombo('decreaseFontSize') || '',
    () => adjustFontSize(-FONT_SIZE_STEP),
    { enabled: !!getKeyCombo('decreaseFontSize'), preventDefault: true }
  )

  useHotkeys(getKeyCombo('skipOp') || '', () => skipOp(), {
    enabled: !!getKeyCombo('skipOp'),
    preventDefault: true,
  })

  useHotkeys(getKeyCombo('toggleStylePanel') || '', () => toggleStylePanel(), {
    enabled: !!getKeyCombo('toggleStylePanel'),
    preventDefault: true,
  })

  useHotkeys(
    getKeyCombo('danmakuTimeOffsetIncrease') || '',
    () => adjustTimeOffset(TIME_OFFSET_STEP),
    {
      enabled: !!getKeyCombo('danmakuTimeOffsetIncrease'),
      preventDefault: true,
    }
  )

  useHotkeys(
    getKeyCombo('danmakuTimeOffsetDecrease') || '',
    () => adjustTimeOffset(-TIME_OFFSET_STEP),
    {
      enabled: !!getKeyCombo('danmakuTimeOffsetDecrease'),
      preventDefault: true,
    }
  )

  useHotkeys(getKeyCombo('danmakuDensityToggle') || '', () => toggleDensity(), {
    enabled: !!getKeyCombo('danmakuDensityToggle'),
    preventDefault: true,
  })

  useHotkeys(getKeyCombo('danmakuSpeedToggle') || '', () => toggleSpeed(), {
    enabled: !!getKeyCombo('danmakuSpeedToggle'),
    preventDefault: true,
  })

  return null
}

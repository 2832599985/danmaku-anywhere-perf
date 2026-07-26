import { useEventCallback } from '@mui/material'
import { produce } from 'immer'
import { useEffect, useState } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'
import { useTranslation } from 'react-i18next'

import { useToast } from '@/common/components/Toast/toastStore'
import { useUpdateExtensionOptions } from '@/common/hooks/useUpdateExtensionOptions'
import { useDanmakuOptions } from '@/common/options/danmakuOptions/useDanmakuOptions'
import { useExtensionOptions } from '@/common/options/extensionOptions/useExtensionOptions'
import { useHotkeyOptions } from '@/common/options/extensionOptions/useHotkeyOptions'
import { playerRpcClient } from '@/common/rpcClient/background/client'
import { PopupTab, usePopup } from '@/content/controller/store/popupStore'
import { useStore } from '@/content/controller/store/store'
import { HotkeyCheatSheet } from '@/content/controller/ui/floatingButton/components/HotkeyCheatSheet'

const OPACITY_STEP = 0.1
const FONT_SIZE_STEP = 2
const TIME_OFFSET_STEP = 0.5
const SPEED_STEP = 0.25
const OFFSET_STEP = 1
const DENSITY_PRESETS = [100, 200, 500, 1000] as const
const SPEED_PRESETS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const

export const GlobalHotkeyActions = () => {
  const { t } = useTranslation()
  const { getKeyCombo } = useHotkeyOptions()
  const { data: danmakuOptions, partialUpdate } = useDanmakuOptions()
  const { data: extensionOptions } = useExtensionOptions()
  const updateExtensionOptions = useUpdateExtensionOptions()
  const { toast } = useToast()
  const { toggleOpen, setTab, isOpen, tab } = usePopup()
  const { activeFrame } = useStore.use.frame()

  const [cheatSheetVisible, setCheatSheetVisible] = useState(false)

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === '?' && !e.ctrlKey && !e.altKey && !e.metaKey) {
        const target = e.target as HTMLElement
        const tagName = target.tagName?.toLowerCase()
        if (
          tagName === 'input' ||
          tagName === 'textarea' ||
          tagName === 'select' ||
          target.isContentEditable
        ) {
          return
        }
        setCheatSheetVisible(true)
      }
    }

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === '?' || e.key === '/') {
        setCheatSheetVisible(false)
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    document.addEventListener('keyup', handleKeyUp)

    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.removeEventListener('keyup', handleKeyUp)
    }
  }, [])

  const adjustOpacity = useEventCallback((delta: number) => {
    const updated = produce(danmakuOptions, (draft) => {
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
    const updated = produce(danmakuOptions, (draft) => {
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
    const updated = produce(danmakuOptions, (draft) => {
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
    const updated = produce(danmakuOptions, (draft) => {
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
    const updated = produce(danmakuOptions, (draft) => {
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

  const adjustSpeed = useEventCallback((delta: number) => {
    const updated = produce(danmakuOptions, (draft) => {
      const current = draft.speed
      draft.speed =
        Math.round(Math.min(3, Math.max(0.25, current + delta)) * 100) / 100
    })
    partialUpdate(updated)
    toast.info(
      t('optionsPage.hotkeys.speedChanged', {
        defaultValue: 'Danmaku speed: {{value}}x',
        value: updated.speed,
      })
    )
  })

  const adjustOffset = useEventCallback((delta: number) => {
    const updated = produce(danmakuOptions, (draft) => {
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

  const toggleDensityPlot = useEventCallback(() => {
    const current = extensionOptions.playerOptions.showDanmakuTimeline
    void updateExtensionOptions((prev) => ({
      playerOptions: {
        ...prev.playerOptions,
        showDanmakuTimeline: !current,
      },
    }))
    toast.info(
      t('optionsPage.hotkeys.densityPlotChanged', {
        defaultValue: 'Density plot: {{value}}',
        value: !current
          ? t('common.enable', 'Enable')
          : t('danmaku.disable', 'Disable'),
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

  useHotkeys(
    getKeyCombo('increaseSpeed') || '',
    () => adjustSpeed(SPEED_STEP),
    { enabled: !!getKeyCombo('increaseSpeed'), preventDefault: true }
  )

  useHotkeys(
    getKeyCombo('decreaseSpeed') || '',
    () => adjustSpeed(-SPEED_STEP),
    { enabled: !!getKeyCombo('decreaseSpeed'), preventDefault: true }
  )

  useHotkeys(
    getKeyCombo('increaseOffset') || '',
    () => adjustOffset(OFFSET_STEP),
    { enabled: !!getKeyCombo('increaseOffset'), preventDefault: true }
  )

  useHotkeys(
    getKeyCombo('decreaseOffset') || '',
    () => adjustOffset(-OFFSET_STEP),
    { enabled: !!getKeyCombo('decreaseOffset'), preventDefault: true }
  )

  useHotkeys(
    getKeyCombo('toggleDensityPlot') || '',
    () => toggleDensityPlot(),
    {
      enabled: !!getKeyCombo('toggleDensityPlot'),
      preventDefault: true,
    }
  )

  return <HotkeyCheatSheet visible={cheatSheetVisible} />
}

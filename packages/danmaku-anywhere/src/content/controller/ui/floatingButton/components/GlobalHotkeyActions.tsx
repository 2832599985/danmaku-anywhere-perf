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

export const GlobalHotkeyActions = () => {
  const { t } = useTranslation()
  const { getKeyCombo } = useHotkeyOptions()
  const { data: danmakuOptions, partialUpdate } = useDanmakuOptions()
  const { toast } = useToast()
  const { toggleOpen, setTab, isOpen, tab } = usePopup()
  const { activeFrame } = useStore.use.frame()

  const adjustOpacity = (delta: number) => {
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
  }

  const adjustFontSize = (delta: number) => {
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
  }

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

  return null
}

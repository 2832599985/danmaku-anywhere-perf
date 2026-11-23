import { useTranslation } from 'react-i18next'
import { useExtensionOptions } from '@/common/options/extensionOptions/useExtensionOptions'
import { settingConfigs } from '@/common/settings/settingConfigs'
import { OptionsPageToolBar } from '@/popup/component/OptionsPageToolbar'
import { OptionsPageLayout } from '@/popup/layout/OptionsPageLayout'
import { DeclarativeToggleSetting } from '@/popup/pages/options/components/DeclarativeToggleSetting'
import { FixedSkipSecondsInput } from '@/popup/pages/options/pages/player/components/FixedSkipSecondsInput'
import { UpscaleSettings } from '@/popup/pages/options/pages/player/components/UpscaleSettings'

export const PlayerOptions = () => {
  const { t } = useTranslation()
  const { data, partialUpdate, isLoading } = useExtensionOptions()

  return (
    <OptionsPageLayout>
      <OptionsPageToolBar
        title={t('optionsPage.pages.player', 'Player Settings')}
      />
      <UpscaleSettings />
      {settingConfigs.player.map((config) => (
        <DeclarativeToggleSetting
          key={config.id}
          config={config}
          state={data}
          onUpdate={partialUpdate}
          isLoading={isLoading}
        />
      ))}
      {data.playerOptions.enableFixedSkip && <FixedSkipSecondsInput />}
    </OptionsPageLayout>
  )
}

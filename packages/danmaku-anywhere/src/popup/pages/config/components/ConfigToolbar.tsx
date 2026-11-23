import { AddCircle, Edit, Language, Upload } from '@mui/icons-material'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { TabToolbar } from '@/common/components/layout/TabToolbar'
import { DrilldownMenu } from '@/common/components/Menu/DrilldownMenu'
import { useImportShareCodeDialog } from '@/common/options/combinedPolicy/useImportShareCodeDialog'
import { TemplatePickerDialog } from './TemplatePickerDialog'

type ConfigToolbarProps = {
  onAdd: () => void
  onShowIntegration: () => void
}

export const ConfigToolbar = ({
  onAdd,
  onShowIntegration,
}: ConfigToolbarProps) => {
  const { t } = useTranslation()
  const [templateDialogOpen, setTemplateDialogOpen] = useState(false)

  const handleImportConfigs = useImportShareCodeDialog()

  return (
    <>
      <TabToolbar title={t('configPage.name', 'Configs')}>
        <DrilldownMenu
          icon={<AddCircle />}
          ButtonProps={{ color: 'primary', size: 'small' }}
          dense
          items={[
            {
              id: 'add',
              label: t('configPage.createConfig', 'Create Config'),
              onClick: onAdd,
              icon: <Edit />,
            },
            {
              id: 'templates',
              label: t('configPage.templates.browse', 'Browse Templates'),
              icon: <Language />,
              onClick: () => setTemplateDialogOpen(true),
            },
            {
              id: 'import',
              label: t('configPage.importShareCode', 'Import Share Code'),
              icon: <Upload />,
              onClick: handleImportConfigs,
            },
          ]}
        />
      </TabToolbar>
      <TemplatePickerDialog
        open={templateDialogOpen}
        onClose={() => setTemplateDialogOpen(false)}
      />
    </>
  )
}

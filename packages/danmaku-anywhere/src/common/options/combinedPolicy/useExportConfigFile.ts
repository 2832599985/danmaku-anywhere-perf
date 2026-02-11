import { useTranslation } from 'react-i18next'
import { useToast } from '@/common/components/Toast/toastStore'
import { useInjectService } from '@/common/hooks/useInjectService'
import { CombinedPolicyService } from '@/common/options/combinedPolicy/index'
import { serializeError } from '@/common/utils/serializeError'
import type { MountConfig } from '../mountConfig/schema'

export function useExportConfigFile() {
  const { t } = useTranslation()
  const toast = useToast.use.toast()
  const combinedPolicyService = useInjectService(CombinedPolicyService)

  const handleExport = async (config: MountConfig) => {
    try {
      const data = await combinedPolicyService.exportSingle(config.id)
      const json = JSON.stringify(data, null, 2)
      const blob = new Blob([json], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${config.name}.json`
      a.click()
      URL.revokeObjectURL(url)
      toast.success(t('configPage.exportConfig.success'))
    } catch (e) {
      toast.error(
        t('configPage.exportConfig.error', {
          message: serializeError(e).message,
        })
      )
    }
  }

  return handleExport
}

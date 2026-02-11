import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useToast } from '@/common/components/Toast/toastStore'
import { useInjectService } from '@/common/hooks/useInjectService'
import { CombinedPolicyService } from '@/common/options/combinedPolicy/index'
import { serializeError } from '@/common/utils/serializeError'

export function useImportConfigFile() {
  const { t } = useTranslation()
  const toast = useToast.use.toast()
  const combinedPolicyService = useInjectService(CombinedPolicyService)
  const inputRef = useRef<HTMLInputElement | null>(null)

  const handleImport = () => {
    if (!inputRef.current) {
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = '.json'
      input.style.display = 'none'
      inputRef.current = input
    }

    const input = inputRef.current

    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) return

      try {
        const text = await file.text()
        const data: unknown = JSON.parse(text)
        await combinedPolicyService.importFromFile(data)
        toast.success(t('configPage.importConfig.success'))
      } catch (e) {
        toast.error(
          t('configPage.importConfig.error', {
            message: serializeError(e).message,
          })
        )
      } finally {
        // Reset so the same file can be selected again
        input.value = ''
      }
    }

    input.click()
  }

  return handleImport
}

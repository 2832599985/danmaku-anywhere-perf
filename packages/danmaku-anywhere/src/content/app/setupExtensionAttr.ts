import { setExtensionAttr } from '@danmaku-anywhere/web-scraper'
import { EXTENSION_VERSION } from '@/common/constants'
import { Logger } from '@/common/Logger'
import { tryCatch } from '@/common/utils/tryCatch'

type ExtensionOptionLike = {
  id?: string
}

export const setupExtensionAttr = async (
  getOptions: () => Promise<ExtensionOptionLike | null | undefined>
) => {
  const [options, error] = await tryCatch(getOptions)

  if (error) {
    Logger.warn('Failed to read extension options while setting extension attr')
    Logger.warn(error)
  }

  try {
    setExtensionAttr({
      version: EXTENSION_VERSION,
      id: options?.id,
    })
  } catch (setError) {
    Logger.warn('Failed to set extension attribute')
    Logger.warn(setError)
  }
}

import type { ILogger } from '@/common/Logger'
import type {
  Options,
  OptionsSchema,
  UpgradeContext,
  Version,
} from '@/common/options/OptionsService/types'

export function migrateOptions<T extends OptionsSchema>(
  fromOption: Options<T>,
  versions: Version[],
  logger: ILogger,
  context: UpgradeContext
): Options<T> {
  const getNextVersion = (version: number): Version | undefined => {
    const biggerVersions = versions.filter((v) => v.version > version)

    return biggerVersions.length > 0
      ? biggerVersions.reduce((acc, v) => (acc.version > v.version ? v : acc))
      : undefined
  }

  /**
   * Options live in chrome.storage.sync, so a profile running a newer build
   * can push a future-versioned blob down to an older one. There is no
   * downgrade path; use the data as-is and leave storage alone rather than
   * writing it back under a version this build doesn't understand.
   */
  const latestVersion = versions.reduce(
    (acc, v) => (v.version > acc ? v.version : acc),
    0
  )

  if (fromOption.version > latestVersion) {
    logger.warn(
      `Stored options are at version ${fromOption.version}, newer than the latest known version ${latestVersion}. Using them as-is without migrating.`
    )
    return fromOption
  }

  let currentOptions = fromOption
  let nextVersion = getNextVersion(currentOptions.version)

  while (nextVersion) {
    logger.debug(
      `Upgrading from version ${currentOptions.version} to ${nextVersion.version}`
    )

    currentOptions = {
      data: nextVersion.upgrade(currentOptions.data, context) as T, // only the last upgrade will be of type T
      version: nextVersion.version,
    }

    nextVersion = getNextVersion(currentOptions.version)
  }

  logger.debug(`At latest version ${currentOptions.version}`)
  return currentOptions
}

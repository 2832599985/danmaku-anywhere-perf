import { inject, injectable } from 'inversify'
import { type ILogger, LoggerSymbol } from '@/common/Logger'
import type { MountConfig } from '@/common/options/mountConfig/schema'
import { MountConfigService } from '@/common/options/mountConfig/service'
import { createTaskQueue } from '@/common/utils/taskQueue'
import { tryCatch } from '@/common/utils/tryCatch'
// the ?script query is used to get the file path for the script after bundling
// @ts-expect-error
import contentScript from '@/content/controller?script'

const contentScriptId = 'main-content'

const mainScript: chrome.scripting.RegisteredContentScript = {
  id: contentScriptId,
  js: [contentScript],
  matches: [],
  persistAcrossSessions: true,
  allFrames: false, // only run in top frame
  runAt: 'document_idle',
  world: 'ISOLATED',
}

const q = createTaskQueue()

@injectable('Singleton')
export class ScriptingManager {
  private logger: ILogger

  constructor(
    @inject(MountConfigService)
    private mountConfigService: MountConfigService,
    @inject(LoggerSymbol) logger: ILogger
  ) {
    this.logger = logger.sub('[ScriptingManager]')
  }

  setup() {
    // Register unconditionally on every worker start. Nothing else guarantees
    // it: onStartup fires only on browser launch (not on an extension
    // reload/update, and not when the worker is revived by an event), and the
    // registration used to ride along on the storage write inside
    // `options.upgrade()` — which is skipped once the stored options are
    // already at the latest version. Relying on that side effect meant a
    // reloaded extension kept zero registered scripts: no controller, so no
    // floating button and no video detection on any page.
    void this.registerFromStoredConfigs()

    chrome.runtime.onStartup.addListener(async () => {
      await this.registerFromStoredConfigs()
    })

    this.mountConfigService.options.onChange(async (configs) => {
      if (!configs) return

      await q.run(() => this.handleContentScriptRegistration(configs))
    })
  }

  private async registerFromStoredConfigs() {
    const [, error] = await tryCatch(async () => {
      const configs = await this.mountConfigService.getAll()

      // ensure the handler doesn't run in parallel. This can happen because options.onChange can get called at startup
      await q.run(() => this.handleContentScriptRegistration(configs))
    })

    if (error) {
      this.logger.error('Failed to register content scripts', error)
    }
  }

  private async handleContentScriptRegistration(mountConfigs: MountConfig[]) {
    const patterns = mountConfigs
      // only register enabled configs
      .filter((configs) => configs.enabled)
      .map((config) => config.patterns)
      .flat()

    const registeredScript = await chrome.scripting.getRegisteredContentScripts(
      {
        ids: [contentScriptId],
      }
    )

    if (patterns.length === 0 && registeredScript.length > 0) {
      this.logger.debug('Unregistering content scripts', { patterns })
      return chrome.scripting.unregisterContentScripts({
        ids: [contentScriptId],
      })
    }

    if (patterns.length > 0 && registeredScript.length === 0) {
      this.logger.debug('Registering content scripts', { patterns })
      return chrome.scripting.registerContentScripts([
        {
          ...mainScript,
          matches: patterns,
        },
      ])
    }

    if (patterns.length > 0 && registeredScript.length > 0) {
      this.logger.debug('Updating content scripts', { patterns })
      return chrome.scripting.updateContentScripts([
        {
          id: contentScriptId,
          matches: patterns,
        },
      ])
    }
  }
}

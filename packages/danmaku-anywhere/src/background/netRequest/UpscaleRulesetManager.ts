import { inject, injectable } from 'inversify'
import { type ILogger, LoggerSymbol } from '@/common/Logger'
import { ExtensionOptionsService } from '@/common/options/extensionOptions/service'

const UPSCALE_RULESET_ID = 'anime4k-cors'

@injectable('Singleton')
export class UpscaleRulesetManager {
  private readonly logger: ILogger

  constructor(
    @inject(ExtensionOptionsService)
    private readonly extensionOptions: ExtensionOptionsService,
    @inject(LoggerSymbol) logger: ILogger
  ) {
    this.logger = logger.sub('[UpscaleRulesetManager]')
  }

  setup() {
    void this.extensionOptions
      .get()
      .then((options) =>
        this.apply(options.playerOptions.upscale.enableCrossOriginFix)
      )
    this.extensionOptions.onChange((options) => {
      void this.apply(options.playerOptions.upscale.enableCrossOriginFix)
    })
  }

  private async apply(enabled: boolean) {
    try {
      await chrome.declarativeNetRequest.updateEnabledRulesets({
        enableRulesetIds: enabled ? [UPSCALE_RULESET_ID] : [],
        disableRulesetIds: enabled ? [] : [UPSCALE_RULESET_ID],
      })
    } catch (error) {
      this.logger.warn('Failed to update Anime4K CORS ruleset', error)
    }
  }
}

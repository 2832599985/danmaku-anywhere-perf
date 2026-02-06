import { inject, injectable } from 'inversify'
import { type ILogger, LoggerSymbol } from '@/common/Logger'
import { getSelfDomain } from './getSelfDomain'

// these enums are not defined in Firefox, so we need to define them ourselves
enum RuleActionType {
  BLOCK = 'block',
  REDIRECT = 'redirect',
  ALLOW = 'allow',
  UPGRADE_SCHEME = 'upgradeScheme',
  MODIFY_HEADERS = 'modifyHeaders',
  ALLOW_ALL_REQUESTS = 'allowAllRequests',
}

enum HeaderOperation {
  APPEND = 'append',
  SET = 'set',
  REMOVE = 'remove',
}

enum ResourceType {
  MAIN_FRAME = 'main_frame',
  SUB_FRAME = 'sub_frame',
  STYLESHEET = 'stylesheet',
  SCRIPT = 'script',
  IMAGE = 'image',
  FONT = 'font',
  OBJECT = 'object',
  XMLHTTPREQUEST = 'xmlhttprequest',
  PING = 'ping',
  CSP_REPORT = 'csp_report',
  MEDIA = 'media',
  WEBSOCKET = 'websocket',
  OTHER = 'other',
}

const selfDomain = getSelfDomain()

const proxyEnv = import.meta.env as unknown as {
  VITE_PROXY_URL?: unknown
  VITE_PROXY_ORIGIN?: unknown
}

const proxyUrl =
  typeof proxyEnv.VITE_PROXY_URL === 'string' &&
  proxyEnv.VITE_PROXY_URL.trim().length > 0
    ? proxyEnv.VITE_PROXY_URL.trim()
    : null

const proxyOrigin =
  typeof proxyEnv.VITE_PROXY_ORIGIN === 'string' &&
  proxyEnv.VITE_PROXY_ORIGIN.trim().length > 0
    ? proxyEnv.VITE_PROXY_ORIGIN.trim()
    : null

// VITE_PROXY_URL/VITE_PROXY_ORIGIN are optional. When unset, do not install proxy header rules.
const rules: chrome.declarativeNetRequest.Rule[] =
  proxyUrl && proxyOrigin
    ? [
        {
          id: 3, // keep old id
          action: {
            type: RuleActionType.MODIFY_HEADERS,
            requestHeaders: [
              {
                header: 'Origin',
                operation: HeaderOperation.SET,
                value: proxyOrigin,
              },
              {
                header: 'Referer',
                operation: HeaderOperation.SET,
                value: selfDomain,
              },
            ],
          },
          condition: {
            urlFilter: `|${proxyUrl}`,
            resourceTypes: [ResourceType.XMLHTTPREQUEST],
          },
        },
      ]
    : []

@injectable('Singleton')
export class NetRequestManager {
  private logger: ILogger

  constructor(@inject(LoggerSymbol) logger: ILogger) {
    this.logger = logger.sub('[NetRequestManager]')
  }

  setup() {
    chrome.runtime.onInstalled.addListener(async () => {
      try {
        await chrome.declarativeNetRequest.updateDynamicRules({
          removeRuleIds: rules.map((r) => r.id),
          addRules: rules,
        })
        this.logger.debug('Updated net request dynamic rules')
      } catch (e) {
        this.logger.error('Failed to update net request dynamic rules', e)
      }
    })
  }

  async getRules() {
    return rules
  }

  async getEnabledStaticRulesets() {
    return chrome.declarativeNetRequest.getEnabledRulesets()
  }
}

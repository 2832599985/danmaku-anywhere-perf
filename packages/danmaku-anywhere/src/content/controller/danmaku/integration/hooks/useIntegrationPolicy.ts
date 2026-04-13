import type {
  EpisodeMeta,
  WithSeason,
} from '@danmaku-anywhere/danmaku-converter'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useToast } from '@/common/components/Toast/toastStore'
import { Logger } from '@/common/Logger'
import { useExtensionOptions } from '@/common/options/extensionOptions/useExtensionOptions'
import { isConfigPermissive } from '@/common/options/mountConfig/isPermissive'
import { chromeRpcClient } from '@/common/rpcClient/background/client'
import { getTrackingService } from '@/common/telemetry/getTrackingService'
import { useActiveConfig } from '@/content/controller/common/context/useActiveConfig'
import { useActiveIntegration } from '@/content/controller/common/context/useActiveIntegration'
import { useLoadDanmaku } from '@/content/controller/common/hooks/useLoadDanmaku'
import { useUnmountDanmaku } from '@/content/controller/common/hooks/useUnmountDanmaku'
import { useMatchEpisode } from '@/content/controller/danmaku/integration/hooks/useMatchEpisode'
import type { MediaInfo } from '@/content/controller/danmaku/integration/models/MediaInfo'
import type { MediaObserver } from '@/content/controller/danmaku/integration/observers/MediaObserver'
import { ObserverFactory } from '@/content/controller/danmaku/integration/observers/ObserverFactory'
import { useStore } from '@/content/controller/store/store'
import { useSyncIntegrationManualMode } from './useSyncIntegrationManualMode'
import { useWarnIncompleteConfig } from './useWarnIncompleteConfig'

export const useIntegrationPolicy = () => {
  const { t } = useTranslation()

  const { toast } = useToast()

  const [observer, setObserver] = useState<MediaObserver | null>(null)

  const activeFrameVideoKey = useStore((s) => {
    const af = s.frame.activeFrame
    if (!af?.hasVideo) {
      return undefined
    }
    return `${af.frameId}:${af.videoChangeCount}`
  })
  const unmountDanmaku = useUnmountDanmaku()
  const {
    setMediaInfo,
    setErrorMessage,
    activate,
    deactivate,
    setFoundElements,
    resetIntegration,
  } = useStore.use.integration()

  const matchEpisode = useMatchEpisode()
  const { loadMutation, mergeDanmaku } = useLoadDanmaku()

  const integrationPolicy = useActiveIntegration()
  const activeConfig = useActiveConfig()

  const { data: extensionOptions } = useExtensionOptions()

  const isManual = useSyncIntegrationManualMode()
  const isConfigIncomplete = useWarnIncompleteConfig()

  useEffect(() => {
    if (isManual || isConfigIncomplete) {
      if (observer) {
        Logger.debug(
          'Destroying integration observer because manual mode or config is incomplete'
        )
        observer.destroy()
        setObserver(null)
        deactivate()
        resetIntegration()
      }
      return
    }

    if (isConfigPermissive(activeConfig) && activeConfig.mode === 'ai') {
      toast.warn(
        t(
          'integration.alert.aiDisabledTooPermissive',
          'AI is disabled because the mount config is too permissive'
        )
      )
      return
    }

    const newObserver = ObserverFactory.create(
      activeConfig,
      integrationPolicy?.policy ?? null
    )
    Logger.debug('Created integration observer', newObserver.name)

    activate()

    newObserver.on({
      statusChange: (status: string) => {
        if (status === 'Extracting video info using AI...') {
          toast.info(
            t('integration.alert.usingAI', 'Using AI to parse show information')
          )
        }
      },
      mediaChange: (state: MediaInfo) => {
        getTrackingService().track('integrationPolicyMediaChange', {
          mediaInfo: state.toJSON(),
          policy: integrationPolicy,
        })
        if (activeConfig.mode === 'ai') {
          toast.success(
            t('integration.alert.AIResult', 'AI Parsing Result: {{title}}', {
              title: state.toString(),
            })
          )
        }
        if (useStore.getState().danmaku.isMounted) {
          unmountDanmaku.mutate()
        }

        setMediaInfo(state)
        setErrorMessage()

        const episodeMatchPayload = {
          mapKey: state.getKey(),
          title: state.title,
          episodeNumber: state.episode,
          originalTitle: state.originalTitle,
          preferredProviders: activeConfig.preferredProviders,
        }

        toast.info(
          t('integration.alert.search', 'Searching for anime: {{title}}', {
            title: state.toString(),
          })
        )

        matchEpisode.mutate(episodeMatchPayload, {
          onSuccess: (result) => {
            if (result.data.status !== 'success') {
              return
            }
            const matchedMeta = result.data.data as WithSeason<EpisodeMeta>
            loadMutation.mutate(
              {
                type: 'by-meta',
                meta: matchedMeta,
                options: {
                  forceUpdate: false,
                },
              },
              {
                onSuccess: () => {
                  // After primary load, trigger multi-source merge if enabled
                  if (extensionOptions?.enableMultiSourceMerge) {
                    const providerConfigId = matchedMeta.season.providerConfigId
                    chromeRpcClient
                      .episodeFetchMultiSource({
                        primaryMeta: matchedMeta,
                        excludeProviderConfigId: providerConfigId,
                      })
                      .then((res) => {
                        const fetchResult = res.data
                        if (
                          fetchResult.comments.length > 0 &&
                          fetchResult.sources.length > 0
                        ) {
                          const sourceNames = fetchResult.sources
                            .map((s) => `${s.provider}(${s.commentCount})`)
                            .join(', ')
                          // Create a synthetic episode to use with mergeDanmaku
                          const syntheticEpisode = {
                            ...matchedMeta,
                            comments: fetchResult.comments,
                            commentCount: fetchResult.comments.length,
                            id: -1,
                          }
                          mergeDanmaku([
                            syntheticEpisode as unknown as Parameters<
                              typeof mergeDanmaku
                            >[0][0],
                          ])
                          toast.info(
                            t(
                              'danmaku.alert.multiSourceMerged',
                              'Merged danmaku from {{sources}}',
                              { sources: sourceNames }
                            )
                          )
                        }
                        if (fetchResult.failures.length > 0) {
                          Logger.debug(
                            'Multi-source fetch failures:',
                            fetchResult.failures
                          )
                        }
                      })
                      .catch((err: unknown) => {
                        Logger.debug('Multi-source merge failed:', err)
                      })
                  }
                },
                onError: () => {
                  toast.error(
                    t(
                      'danmaku.alert.fetchError',
                      'Failed to fetch danmaku: {{message}}',
                      {
                        message: episodeMatchPayload.title,
                      }
                    )
                  )
                },
              }
            )
          },
        })
      },
      mediaElementsChange: () => {
        setFoundElements(true)
      },
      error: (error: Error) => {
        getTrackingService().track('integrationPolicyError', { error })
        toast.error(error.message)
        setErrorMessage(error.message)
      },
    })

    newObserver.setup()
    setObserver(newObserver)

    return () => {
      newObserver.destroy()
      setObserver(null)
    }
  }, [activeConfig, integrationPolicy, isManual, isConfigIncomplete])

  useEffect(() => {
    if (!observer) {
      return
    }
    if (activeFrameVideoKey !== undefined) {
      observer.run()
    } else {
      observer.reset()
      resetIntegration()
    }
  }, [activeFrameVideoKey, observer])
}

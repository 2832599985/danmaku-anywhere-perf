import {
  type CustomSeason,
  DanmakuSourceType,
  type EpisodeMeta,
  type Season,
  type WithSeason,
} from '@danmaku-anywhere/danmaku-converter'
import { Suspense } from 'react'
import { ErrorBoundary } from 'react-error-boundary'
import { BaseEpisodeListItem } from '@/common/components/EpisodeList/BaseEpisodeListItem'
import { EpisodeSearchList } from '@/common/components/EpisodeList/EpisodeSearchList'
import { MacCmsEpisodeListItem } from '@/common/components/EpisodeList/MacCmsEpisodeListItem'
import { ErrorMessage } from '@/common/components/ErrorMessage'
import { TabLayout } from '@/common/components/layout/TabLayout'
import { TabToolbar } from '@/common/components/layout/TabToolbar'
import type { ProviderConfig } from '@/common/options/providerConfig/schema'
import { assertProviderConfigImpl } from '@/common/options/providerConfig/utils'
import { useLoadDanmaku } from '@/content/controller/common/hooks/useLoadDanmaku'

type SeasonDetailsPageProps = {
  season: Season | CustomSeason
  onGoBack: () => void
  provider: ProviderConfig
}

export const SeasonDetailsPage = ({
  season,
  onGoBack,
  provider,
}: SeasonDetailsPageProps) => {
  const { loadMutation, loadGenericMutation } = useLoadDanmaku()

  return (
    <TabLayout>
      <TabToolbar showBackButton onGoBack={onGoBack} title={season.title} />
      <ErrorBoundary
        fallbackRender={({ error }) => <ErrorMessage message={error.message} />}
      >
        <Suspense fallback={null}>
          <EpisodeSearchList
            season={season}
            renderEpisode={(data) => {
              const handleFetchDanmaku = async (
                meta: WithSeason<EpisodeMeta>
              ) => {
                await loadMutation.mutateAsync({
                  type: 'by-meta',
                  meta,
                  options: {
                    forceUpdate: true,
                  },
                })
              }

              const isLoadingThisEpisode =
                loadMutation.isPending &&
                loadMutation.variables?.type === 'by-meta' &&
                loadMutation.variables.meta.indexedId ===
                  data.episode.indexedId &&
                loadMutation.variables.meta.provider ===
                  data.episode.provider &&
                loadMutation.variables.meta.seasonId === data.episode.seasonId

              return (
                <BaseEpisodeListItem
                  episode={data.danmaku ?? data.episode}
                  isLoading={isLoadingThisEpisode || data.isLoading}
                  onClick={handleFetchDanmaku}
                  disabled={loadMutation.isPending}
                />
              )
            }}
            renderCustomEpisode={(data) => {
              assertProviderConfigImpl(provider, DanmakuSourceType.MacCMS)

              return (
                <MacCmsEpisodeListItem
                  episode={data.episode}
                  onClick={() =>
                    loadGenericMutation.mutate({
                      ...data.episode,
                      providerConfigId: provider.id,
                    })
                  }
                  isLoading={loadGenericMutation.isPending}
                  disabled={loadGenericMutation.isPending}
                  danmaku={loadGenericMutation.data}
                />
              )
            }}
          />
        </Suspense>
      </ErrorBoundary>
    </TabLayout>
  )
}

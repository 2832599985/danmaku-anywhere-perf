import type {
  EpisodeMeta,
  WithSeason,
} from '@danmaku-anywhere/danmaku-converter'
import { useTranslation } from 'react-i18next'
import { useToast } from '@/common/components/Toast/toastStore'
import { useFetchDanmakuLite } from '@/common/danmaku/queries/useFetchDanmakuLite'

export const useRefreshDanmaku = () => {
  const { t } = useTranslation()
  const { toast } = useToast()

  const mutation = useFetchDanmakuLite()

  const refreshDanmaku = async (episode: WithSeason<EpisodeMeta>) => {
    return await mutation.mutateAsync(
      {
        type: 'by-meta',
        meta: episode,
        options: {
          forceUpdate: true,
        },
      },
      {
        onSuccess: (result) => {
          toast.success(
            t(
              'danmaku.alert.refreshed',
              'Danmaku Refreshed: {{name}} ({{count}})',
              {
                name: `${episode.season.title} - ${episode.title}`,
                count: result.commentCount,
              }
            )
          )
        },
      }
    )
  }

  return {
    ...mutation,
    refreshDanmaku,
  }
}

import { Download } from '@mui/icons-material'
import { useTranslation } from 'react-i18next'
import { DrilldownMenu } from '@/common/components/Menu/DrilldownMenu'
import { useEpisodesLiteSuspense } from '@/common/danmaku/queries/useEpisodes'
import { useExportAss } from '@/popup/hooks/useExportAss'
import { useExportDanmaku } from '@/popup/hooks/useExportDanmaku'
import { useExportXml } from '@/popup/hooks/useExportXml'

export const ExportAllDanmakuButton = () => {
  const exportDanmaku = useExportDanmaku()
  const exportXml = useExportXml()
  const exportAss = useExportAss()
  const { data, isFetching } = useEpisodesLiteSuspense()
  const { t } = useTranslation()

  const isDisabled = data.length === 0 || isFetching

  return (
    <DrilldownMenu
      ButtonProps={{
        edge: 'end',
      }}
      items={[
        {
          id: 'backup',
          label: t('danmakuPage.backupAll', 'Export All as Backup'),
          icon: <Download />,
          onClick: () =>
            exportDanmaku.mutate({
              filter: { all: true },
              customFilter: { all: true },
            }),
          disabled: isDisabled || exportDanmaku.isPending,
          loading: isFetching || exportDanmaku.isPending,
        },
        {
          id: 'exportXml',
          label: t('danmakuPage.exportAllXml', 'Export All as XML'),
          icon: <Download />,
          onClick: () =>
            exportXml.mutate({
              filter: { all: true },
              customFilter: { all: true },
            }),
          disabled: isDisabled || exportXml.isPending,
          loading: isFetching || exportXml.isPending,
        },
        {
          id: 'exportAss',
          label: t('danmakuPage.exportAllAss', 'Export All as ASS'),
          icon: <Download />,
          onClick: () =>
            exportAss.mutate({
              filter: { all: true },
              customFilter: { all: true },
            }),
          disabled: isDisabled || exportAss.isPending,
          loading: isFetching || exportAss.isPending,
        },
      ]}
    />
  )
}

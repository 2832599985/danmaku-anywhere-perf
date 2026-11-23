import { commentsToAss } from '@danmaku-anywhere/danmaku-converter'
import { i18n } from '@/common/localization/i18n'
import { type ExportFormatter, useExportWithFormat } from './useExportBase'

const assFormatter: ExportFormatter = {
  formatEpisode: (episode) => {
    const assContent = commentsToAss(episode.comments, {
      title: episode.title,
    })
    return {
      name: `${episode.title}.ass`,
      data: assContent,
    }
  },
  fileExtension: 'ass',
  successMessage: () =>
    i18n.t('danmaku.alert.assExported', 'Export ASS successful'),
  errorMessage: (errorMessage: string) =>
    i18n.t(
      'danmaku.alert.assExportError',
      'Failed to export ASS: {{message}}',
      {
        message: errorMessage,
      }
    ),
}

export const useExportAss = () => {
  return useExportWithFormat(assFormatter)
}

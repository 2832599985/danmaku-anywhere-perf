import { Chip } from '@mui/material'

import type { DanmakuSourceType } from '@/common/danmaku/enums'
import { localizedDanmakuSourceType } from '@/common/danmaku/enums'

export const DanmakuProviderChip = ({
  provider,
}: {
  provider: DanmakuSourceType
}) => {
  // localizedDanmakuSourceType already resolves through i18n.
  return <Chip label={localizedDanmakuSourceType(provider)} size="small" />
}

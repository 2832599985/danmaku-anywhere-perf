import { useEventCallback } from '@mui/material'
import { useMutation } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { useToast } from '@/common/components/Toast/toastStore'
import { playerRpcClient } from '@/common/rpcClient/background/client'
import type { AutoOffsetResultDto } from '@/common/rpcClient/background/types'
import { useStore } from '@/content/controller/store/store'

export const useAutoCalibrate = () => {
  const { t } = useTranslation()
  const { toast } = useToast()
  const { mustGetActiveFrame } = useStore.use.frame()

  const calibrateMutation = useMutation({
    mutationFn: async (): Promise<AutoOffsetResultDto | null> => {
      const res = await playerRpcClient.player['relay:command:autoCalibrate']({
        frameId: mustGetActiveFrame().frameId,
      })
      return res.data ?? null
    },
  })

  const applyMutation = useMutation({
    mutationFn: async (offsetMs: number) => {
      await playerRpcClient.player['relay:command:applyAutoOffset']({
        frameId: mustGetActiveFrame().frameId,
        data: offsetMs,
      })
    },
  })

  const calibrateAndApply = useEventCallback(async () => {
    try {
      const result = await calibrateMutation.mutateAsync()

      if (!result) {
        toast.info(
          t('autoOffset.noCalibrationNeeded', 'No offset calibration needed')
        )
        return
      }

      await applyMutation.mutateAsync(result.offsetMs)
      toast.success(
        t('autoOffset.applied', 'Auto offset applied: {{offset}}ms', {
          offset: result.offsetMs > 0 ? `+${result.offsetMs}` : result.offsetMs,
        })
      )
    } catch {
      toast.error(t('autoOffset.error', 'Auto calibration failed'))
    }
  })

  return {
    calibrateAndApply,
    isPending: calibrateMutation.isPending || applyMutation.isPending,
  }
}

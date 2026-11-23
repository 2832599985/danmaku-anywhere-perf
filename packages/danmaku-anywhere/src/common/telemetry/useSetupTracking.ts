import { useEffect, useRef } from 'react'
import { useEnvironmentContext } from '@/common/environment/context'
import { useExtensionOptions } from '@/common/options/extensionOptions/useExtensionOptions'
import {
  createTrackingService,
  getTrackingService,
} from '@/common/telemetry/getTrackingService'
import type { TrackingService } from './TrackingService'

export const useSetupTracking = () => {
  const { data } = useExtensionOptions()
  const { environment, type } = useEnvironmentContext()
  const trackingServiceRef = useRef<TrackingService>(
    createTrackingService(environment, type)
  )
  const analyticsEnabled = !!data?.enableAnalytics
  const extId = data?.id

  useEffect(() => {
    if (analyticsEnabled) {
      getTrackingService().init()
    }
  }, [analyticsEnabled])

  useEffect(() => {
    if (extId) {
      getTrackingService().identify(extId)
    }
  }, [extId])

  return trackingServiceRef.current
}

import { useEffect } from 'react'
import { connectRuntimePort } from '@/common/environment/chromeRuntime'
import { portNames } from '@/common/ports/portNames'
import { useStore } from '@/content/controller/store/store'

const port = connectRuntimePort(portNames.contentPing)

export const usePort = () => {
  const setDisconnected = useStore.use.setIsDisconnected()

  useEffect(() => {
    const handleDisconnect = () => {
      setDisconnected(true)
    }

    if (!port) {
      return
    }

    port.onDisconnect.addListener(handleDisconnect)

    return () => {
      port.onDisconnect.removeListener(handleDisconnect)
    }
  }, [setDisconnected])
}

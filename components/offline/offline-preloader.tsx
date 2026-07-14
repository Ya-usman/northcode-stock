'use client'

import { useOfflinePreload } from '@/lib/offline/use-offline-preload'
import { useOffline } from '@/lib/offline/use-offline'

export function OfflinePreloader() {
  const { isOnline } = useOffline()
  useOfflinePreload(isOnline)
  return null
}

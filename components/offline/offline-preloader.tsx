'use client'

import { useOfflinePreload } from '@/lib/offline/use-offline-preload'

export function OfflinePreloader() {
  useOfflinePreload()
  return null
}

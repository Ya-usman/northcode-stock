'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useAuthContext as useAuth } from '@/lib/contexts/auth-context'
import { getPendingCount } from './db'
import { syncPendingSales, type SyncResult } from './sync'

export function useOffline() {
  const { shop } = useAuth()
  const [isOnline, setIsOnline] = useState(true)
  const [pendingCount, setPendingCount] = useState(0)
  const [syncing, setSyncing] = useState(false)
  const shopId = shop?.id
  const syncingRef = useRef(false)

  const refreshPendingCount = useCallback(async () => {
    if (!shopId) return
    const count = await getPendingCount(shopId)
    setPendingCount(count)
  }, [shopId])

  const sync = useCallback(async (): Promise<SyncResult | null> => {
    if (!shopId || syncingRef.current) return null
    syncingRef.current = true
    setSyncing(true)
    try {
      const result = await syncPendingSales(shopId)
      await refreshPendingCount()
      return result
    } finally {
      syncingRef.current = false
      setSyncing(false)
    }
  }, [shopId, refreshPendingCount])

  useEffect(() => {
    if (typeof window === 'undefined') return
    setIsOnline(navigator.onLine)

    const handleOnline = async () => {
      setIsOnline(true)
      await sync()
    }
    const handleOffline = () => setIsOnline(false)

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [sync])

  useEffect(() => {
    refreshPendingCount()
  }, [refreshPendingCount])

  return { isOnline, pendingCount, syncing, sync, refreshPendingCount }
}

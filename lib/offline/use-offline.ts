'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useAuthContext as useAuth } from '@/lib/contexts/auth-context'
import { getPendingCount } from './db'
import { syncPendingSales, type SyncResult } from './sync'

// navigator.onLine is unreliable in Capacitor WebViews.
// Do a real HEAD request to confirm actual connectivity.
async function checkRealConnectivity(): Promise<boolean> {
  try {
    const res = await fetch('/api/health', {
      method: 'HEAD',
      cache: 'no-store',
      signal: AbortSignal.timeout(4000),
    })
    return res.ok
  } catch {
    return false
  }
}

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

  // Real connectivity check — called on mount and on browser online/offline events
  const verifyAndSetOnline = useCallback(async (triggerSync = false) => {
    const online = await checkRealConnectivity()
    setIsOnline(online)
    if (online && triggerSync) await sync()
  }, [sync])

  useEffect(() => {
    if (typeof window === 'undefined') return

    // Initial check
    verifyAndSetOnline()

    const handleOnline = () => verifyAndSetOnline(true)
    const handleOffline = () => setIsOnline(false)

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)

    // Re-check every 30s in case the device regained connectivity silently
    const interval = setInterval(() => verifyAndSetOnline(), 30_000)

    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
      clearInterval(interval)
    }
  }, [verifyAndSetOnline])

  useEffect(() => {
    refreshPendingCount()
  }, [refreshPendingCount])

  return { isOnline, pendingCount, syncing, sync, refreshPendingCount }
}

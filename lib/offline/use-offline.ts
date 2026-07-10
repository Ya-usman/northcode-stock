'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useAuthContext as useAuth } from '@/lib/contexts/auth-context'
import { getPendingCount, getPendingMovementCount, getPendingExpenseCount } from './db'
import { syncAllPending, type SyncResult } from './sync'

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
  // Start true (matches server); real check in useEffect avoids SSR/client hydration mismatch
  const [isOnline, setIsOnline] = useState(true)
  const [pendingCount, setPendingCount] = useState(0)
  const [syncing, setSyncing] = useState(false)
  const [lastSyncResult, setLastSyncResult] = useState<SyncResult | null>(null)
  const shopId = shop?.id
  const pendingCountRef = useRef(0)

  const refreshPendingCount = useCallback(async () => {
    if (!shopId) return
    const [sales, movements, expenses] = await Promise.all([
      getPendingCount(shopId),
      getPendingMovementCount(shopId),
      getPendingExpenseCount(shopId),
    ])
    const total = sales + movements + expenses
    setPendingCount(total)
    pendingCountRef.current = total
  }, [shopId])

  const sync = useCallback(async (): Promise<SyncResult | null> => {
    if (!shopId) return null
    setSyncing(true)
    try {
      // syncAllPending() is shared process-wide — concurrent callers (this hook
      // is mounted independently in several components at once) join the same
      // in-flight sync instead of each starting their own pass over the same
      // pending queue, which used to insert offline sales more than once.
      const combined = await syncAllPending(shopId)
      setLastSyncResult(combined)
      await refreshPendingCount()
      return combined
    } finally {
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

    // Re-check every 30s — trigger sync only if there are pending operations
    const interval = setInterval(() => verifyAndSetOnline(pendingCountRef.current > 0), 30_000)

    // Listen for Background Sync message from service worker
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'BACKGROUND_SYNC_SALES') {
        sync()
      }
    }
    navigator.serviceWorker?.addEventListener('message', handleMessage)

    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
      clearInterval(interval)
      navigator.serviceWorker?.removeEventListener('message', handleMessage)
    }
  }, [verifyAndSetOnline, sync])

  useEffect(() => {
    refreshPendingCount()
  }, [refreshPendingCount])

  return { isOnline, pendingCount, syncing, sync, refreshPendingCount, lastSyncResult }
}

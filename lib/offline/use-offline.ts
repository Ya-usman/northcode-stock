'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useAuthContext as useAuth } from '@/lib/contexts/auth-context'
import { getPendingCount, getPendingMovementCount, getPendingExpenseCount } from './db'
import { syncPendingSales, syncPendingMovements, syncPendingExpenses, type SyncResult } from './sync'

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
  // Use navigator.onLine as fast initial guess; real check updates it immediately
  const [isOnline, setIsOnline] = useState(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true
  )
  const [pendingCount, setPendingCount] = useState(0)
  const [syncing, setSyncing] = useState(false)
  const [lastSyncResult, setLastSyncResult] = useState<SyncResult | null>(null)
  const shopId = shop?.id
  const syncingRef = useRef(false)

  const refreshPendingCount = useCallback(async () => {
    if (!shopId) return
    const [sales, movements, expenses] = await Promise.all([
      getPendingCount(shopId),
      getPendingMovementCount(shopId),
      getPendingExpenseCount(shopId),
    ])
    setPendingCount(sales + movements + expenses)
  }, [shopId])

  const sync = useCallback(async (): Promise<SyncResult | null> => {
    if (!shopId || syncingRef.current) return null
    syncingRef.current = true
    setSyncing(true)
    try {
      const [salesResult, movResult, expResult] = await Promise.all([
        syncPendingSales(shopId),
        syncPendingMovements(shopId),
        syncPendingExpenses(shopId),
      ])
      const combined: SyncResult = {
        synced: salesResult.synced + movResult.synced + expResult.synced,
        failed: salesResult.failed + movResult.failed + expResult.failed,
        errors: [...salesResult.errors, ...movResult.errors, ...expResult.errors],
      }
      setLastSyncResult(combined)
      await refreshPendingCount()
      return combined
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

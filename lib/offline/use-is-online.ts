'use client'

import { useState, useEffect } from 'react'

// navigator.onLine is unreliable in Capacitor WebViews (returns true even when
// the device has no real internet connectivity). This hook verifies with a real
// HEAD request so the offline banner reflects actual network state.
async function checkConnectivity(): Promise<boolean> {
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

/**
 * Lightweight hook for pages that only need to know online/offline status.
 * Uses a real HEAD request instead of navigator.onLine. Starts optimistic (true)
 * to avoid SSR/hydration mismatch, then verifies on mount.
 */
export function useIsOnline(): boolean {
  const [isOnline, setIsOnline] = useState(true)

  useEffect(() => {
    if (typeof window === 'undefined') return

    checkConnectivity().then(setIsOnline)

    const handleOnline = () => checkConnectivity().then(setIsOnline)
    const handleOffline = () => setIsOnline(false)

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)

    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  return isOnline
}

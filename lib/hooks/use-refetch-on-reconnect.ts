'use client'

import { useEffect, useRef } from 'react'

// navigator.onLine / the browser 'online' event are unreliable in Capacitor
// WebViews (see lib/offline/use-offline.ts) — this reacts to the verified
// `isOnline` from useOffline() instead, which is confirmed via a real network
// request and re-checked on a timer, so it still catches reconnects on
// Android even when the WebView never fires a native 'online' event.
export function useRefetchOnReconnect(fetchFn: () => void, isOnline: boolean) {
  const mounted = useRef(false)
  useEffect(() => {
    if (!mounted.current) { mounted.current = true; return }
    if (isOnline) fetchFn()
  }, [isOnline])
}

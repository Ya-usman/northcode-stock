'use client'

import { useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { ensureFreshSession } from '@/lib/session-refresh'

const supabase = createClient()

// navigator.onLine / the browser 'online' event are unreliable in Capacitor
// WebViews (see lib/offline/use-offline.ts) — this reacts to the verified
// `isOnline` from useOffline() instead, which is confirmed via a real network
// request and re-checked on a timer, so it still catches reconnects on
// Android even when the WebView never fires a native 'online' event.
//
// Time spent offline is exactly the kind of gap where the background JWT
// refresh timer can't run either — ensureFreshSession() (shared/deduplicated
// across every caller, see lib/session-refresh.ts) runs before fetchFn so
// the refetch doesn't hit RLS with a stale session right as connectivity
// comes back.
export function useRefetchOnReconnect(fetchFn: () => void, isOnline: boolean) {
  const mounted = useRef(false)
  const fetchRef = useRef(fetchFn)
  fetchRef.current = fetchFn
  useEffect(() => {
    if (!mounted.current) { mounted.current = true; return }
    if (isOnline) ensureFreshSession(supabase).then(() => fetchRef.current())
  }, [isOnline])
}

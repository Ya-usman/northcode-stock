'use client'

import { useEffect } from 'react'

export function SWUpdater() {
  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return

    function triggerUpdate() {
      navigator.serviceWorker.ready.then(reg => reg.update()).catch(() => {})
    }

    // Check on mount (in case the inline script ran before SW was ready)
    triggerUpdate()

    // Re-check every time the device comes back online.
    // Critical: if the user was offline when the app opened, the inline script
    // skipped the update. When they reconnect, we trigger it here.
    window.addEventListener('online', triggerUpdate)

    // When a new SW takes over (skipWaiting activated), reload to apply it.
    // Guard: never reload while offline — hard navigate with no network
    // would trigger ERR_INTERNET_DISCONNECTED on Android WebView.
    let reloading = false
    const onControllerChange = () => {
      if (!reloading && navigator.onLine) {
        reloading = true
        window.location.reload()
      }
    }
    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange)

    return () => {
      window.removeEventListener('online', triggerUpdate)
      navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange)
    }
  }, [])

  return null
}

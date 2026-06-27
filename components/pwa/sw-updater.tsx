'use client'

import { useEffect } from 'react'

export function SWUpdater() {
  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return

    function triggerUpdate() {
      navigator.serviceWorker.ready.then(reg => reg.update()).catch(() => {})
    }

    // Check on mount
    triggerUpdate()

    // Re-check every time the device comes back online.
    window.addEventListener('online', triggerUpdate)

    // Re-check every 30 s for the first 3 minutes after mount.
    // Handles the case where the Vercel build finished after the first
    // reg.update() call (e.g. deploy in progress when app opened).
    let checks = 0
    const interval = setInterval(() => {
      if (++checks >= 6) clearInterval(interval) // stop after 3 min
      if (navigator.onLine) triggerUpdate()
    }, 30_000)

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
      clearInterval(interval)
      navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange)
    }
  }, [])

  return null
}

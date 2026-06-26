'use client'

import { useEffect } from 'react'

/**
 * Forces the service worker to update on every app launch and reloads the page
 * when a new SW takes control. Without this, next-pwa's skipWaiting installs the
 * new SW but the old one stays active for the current page session — meaning the
 * offline cache fix never kicks in until the user manually refreshes.
 */
export function SWUpdater() {
  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return

    // Check for a new SW on every app open
    navigator.serviceWorker.ready.then(reg => reg.update()).catch(() => {})

    // When a new SW takes over (skipWaiting activated), reload immediately
    let reloading = false
    const onControllerChange = () => {
      if (!reloading) {
        reloading = true
        window.location.reload()
      }
    }
    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange)
    return () => {
      navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange)
    }
  }, [])

  return null
}

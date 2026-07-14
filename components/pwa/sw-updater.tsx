'use client'

import { useEffect, useRef, useState } from 'react'
import { RefreshCw, X } from 'lucide-react'

// Ignore controllerchange events firing just after mount — almost always
// this tab's own service worker registration settling (first activation /
// claiming this client), not a new version deployed mid-session. Reloading
// unconditionally on every controllerchange is what causes rapid successive
// refreshes to collide: the forced reload can interrupt a JS chunk fetch
// mid-flight, leaving a corrupted entry in the CacheFirst cache (next.config.js)
// that then serves broken JS forever and freezes the app on the initial skeleton.
const RELOAD_GRACE_MS = 4000

const CHUNK_ERROR_KEY = 'sw_chunk_reload_at'
const CHUNK_ERROR_COOLDOWN_MS = 30_000

function isChunkLoadError(text: string): boolean {
  return /ChunkLoadError|Loading chunk [\w-]+ failed|Failed to fetch dynamically imported module/i.test(text)
}

export function SWUpdater() {
  const [updateAvailable, setUpdateAvailable] = useState(false)
  const mountedAtRef = useRef(Date.now())

  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return

    // Explicit registration — next-pwa's auto-injected register.js (via a
    // webpack main.js entry patch) turned out to silently never call
    // navigator.serviceWorker.register() in this build (confirmed live:
    // /sw.js served fine with a 200, but getRegistrations() always returned
    // an empty array, no console error either). Rather than keep depending
    // on that fragile auto-injection, register.js is disabled (register:
    // false in next.config.js) and this is now the single source of truth.
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {})

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

    // When a new SW takes over (skipWaiting activated), surface a dismissible
    // prompt instead of reloading immediately — the reload only happens when
    // the user explicitly clicks it, so it can never collide with a manual
    // refresh the user is doing at the same time.
    const onControllerChange = () => {
      if (Date.now() - mountedAtRef.current < RELOAD_GRACE_MS) return
      setUpdateAvailable(true)
    }
    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange)

    return () => {
      window.removeEventListener('online', triggerUpdate)
      clearInterval(interval)
      navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange)
    }
  }, [])

  // Recovery net: a stale/corrupted cached JS chunk (e.g. from a refresh
  // interrupted mid-download) leaves the app frozen on the initial skeleton
  // with no code left running to recover — catch it globally and force a
  // single guarded reload instead of stranding the user.
  useEffect(() => {
    const recover = (text: string) => {
      if (!isChunkLoadError(text)) return
      const lastReload = Number(sessionStorage.getItem(CHUNK_ERROR_KEY) || 0)
      if (Date.now() - lastReload < CHUNK_ERROR_COOLDOWN_MS) return // already tried recently — avoid a reload loop
      sessionStorage.setItem(CHUNK_ERROR_KEY, String(Date.now()))
      window.location.reload()
    }
    const onError = (e: ErrorEvent) => recover(`${(e.error as any)?.name || ''} ${e.message || ''}`)
    const onRejection = (e: PromiseRejectionEvent) => recover(String((e.reason as any)?.message || e.reason || ''))
    window.addEventListener('error', onError)
    window.addEventListener('unhandledrejection', onRejection)
    return () => {
      window.removeEventListener('error', onError)
      window.removeEventListener('unhandledrejection', onRejection)
    }
  }, [])

  if (!updateAvailable) return null

  return (
    <div className="fixed bottom-4 inset-x-4 sm:inset-x-auto sm:right-4 sm:left-auto z-[9998] max-w-sm rounded-xl border bg-card shadow-lg p-3 flex items-center gap-3">
      <RefreshCw className="h-4 w-4 text-stockshop-blue flex-shrink-0" />
      <p className="text-sm flex-1">Nouvelle version disponible.</p>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="text-sm font-semibold text-stockshop-blue hover:underline flex-shrink-0"
      >
        Actualiser
      </button>
      <button
        type="button"
        onClick={() => setUpdateAvailable(false)}
        className="text-muted-foreground hover:text-foreground flex-shrink-0"
        aria-label="Fermer"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  )
}

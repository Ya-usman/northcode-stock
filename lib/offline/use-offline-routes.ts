'use client'

import { useState, useEffect, useCallback } from 'react'

/**
 * Retourne l'état hors ligne, les slugs de routes disponibles en cache,
 * et l'âge en ms du dernier sync de données (pour CacheBanner global).
 */
export function useOfflineRoutes() {
  const [isOffline, setIsOffline] = useState(false)
  const [cachedSlugs, setCachedSlugs] = useState<Set<string>>(new Set())
  const [cacheAgeMs, setCacheAgeMs] = useState<number | null>(null)

  const readCache = useCallback(() => {
    try {
      const slugs = Object.keys(localStorage)
        .filter(k => k.startsWith('pc_route_'))
        .map(k => k.replace('pc_route_', ''))
      setCachedSlugs(new Set(slugs))

      // Âge du dernier sync de données (pc_data_* = timestamp posé par useOfflinePreload)
      const dataKeys = Object.keys(localStorage).filter(k => k.startsWith('pc_data_'))
      if (dataKeys.length) {
        const latest = Math.max(...dataKeys.map(k => Number(localStorage.getItem(k)) || 0))
        setCacheAgeMs(latest > 0 ? Date.now() - latest : null)
      }
    } catch {
      setCachedSlugs(new Set())
    }
  }, [])

  useEffect(() => {
    const online = typeof navigator !== 'undefined' ? navigator.onLine : true
    setIsOffline(!online)
    if (!online) readCache()

    const handleOffline = () => { setIsOffline(true); readCache() }
    const handleOnline = () => { setIsOffline(false); setCacheAgeMs(null) }

    window.addEventListener('offline', handleOffline)
    window.addEventListener('online', handleOnline)
    return () => {
      window.removeEventListener('offline', handleOffline)
      window.removeEventListener('online', handleOnline)
    }
  }, [readCache])

  /** Renvoie true si la route est disponible (en ligne ou en cache hors ligne) */
  const isAvailable = useCallback((href: string) => {
    if (!isOffline) return true
    const slug = href.replace(/^\/[a-z]{2}\//, '')
    return cachedSlugs.has(slug)
  }, [isOffline, cachedSlugs])

  return { isOffline, isAvailable, cacheAgeMs }
}

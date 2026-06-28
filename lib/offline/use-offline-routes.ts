'use client'

import { useState, useEffect, useCallback } from 'react'

/**
 * Retourne l'état hors ligne et les slugs de routes disponibles en cache.
 * Les slugs correspondent aux clés `pc_route_*` écrites par useOfflinePreload.
 * Ex: 'dashboard', 'sales/new', 'stock', etc.
 */
export function useOfflineRoutes() {
  const [isOffline, setIsOffline] = useState(false)
  const [cachedSlugs, setCachedSlugs] = useState<Set<string>>(new Set())

  const readCache = useCallback(() => {
    try {
      const slugs = Object.keys(localStorage)
        .filter(k => k.startsWith('pc_route_'))
        .map(k => k.replace('pc_route_', ''))
      setCachedSlugs(new Set(slugs))
    } catch {
      setCachedSlugs(new Set())
    }
  }, [])

  useEffect(() => {
    const online = typeof navigator !== 'undefined' ? navigator.onLine : true
    setIsOffline(!online)
    if (!online) readCache()

    const handleOffline = () => { setIsOffline(true); readCache() }
    const handleOnline = () => { setIsOffline(false) }

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
    // Extraire le slug depuis un href complet (ex: /fr/sales/new → sales/new)
    const slug = href.replace(/^\/[a-z]{2}\//, '')
    return cachedSlugs.has(slug)
  }, [isOffline, cachedSlugs])

  return { isOffline, isAvailable }
}

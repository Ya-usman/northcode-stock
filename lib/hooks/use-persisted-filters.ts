import { useState, useCallback, useEffect, useRef } from 'react'

/**
 * Persists filters in localStorage keyed by page + shop.
 * - Survives navigation and page reload.
 * - Auto-resets when the active shop changes (different data context).
 * - resetFilters() lets the user manually clear all filters for a page.
 */
export function usePersistedFilters<T extends Record<string, unknown>>(
  pageKey: string,
  shopId: string | null | undefined,
  defaults: T
): readonly [T, (updates: Partial<T>) => void, () => void] {
  const defaultsRef = useRef(defaults)

  const makeKey = (sid: string | null | undefined) =>
    sid ? `filters_v1_${pageKey}_${sid}` : null

  const read = (key: string | null): T => {
    if (!key || typeof window === 'undefined') return defaultsRef.current
    try {
      const raw = localStorage.getItem(key)
      if (!raw) return defaultsRef.current
      // Spread defaults first so new filter keys added later get their default value
      return { ...defaultsRef.current, ...JSON.parse(raw) }
    } catch {
      return defaultsRef.current
    }
  }

  const [filters, setFiltersState] = useState<T>(() => read(makeKey(shopId)))

  // When shop changes: load filters for the new shop (or reset if none saved)
  const prevShopId = useRef(shopId)
  useEffect(() => {
    if (prevShopId.current !== shopId) {
      prevShopId.current = shopId
      setFiltersState(read(makeKey(shopId)))
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shopId])

  const setFilter = useCallback((updates: Partial<T>) => {
    setFiltersState(prev => {
      const next = { ...prev, ...updates }
      const key = makeKey(prevShopId.current)
      if (key) {
        try { localStorage.setItem(key, JSON.stringify(next)) } catch { /* storage full */ }
      }
      return next
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageKey])

  const resetFilters = useCallback(() => {
    const key = makeKey(prevShopId.current)
    if (key) {
      try { localStorage.removeItem(key) } catch { /* ignore */ }
    }
    setFiltersState(defaultsRef.current)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageKey])

  return [filters, setFilter, resetFilters] as const
}

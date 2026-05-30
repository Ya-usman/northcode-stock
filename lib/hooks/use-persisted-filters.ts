import { useState, useCallback, useEffect, useRef } from 'react'

/**
 * Manages page filters using sessionStorage (within a tab session only).
 * - Resets automatically when navigating away (unmount clears storage key).
 * - Also resets when the active shop changes (different data context).
 * - resetFilters() lets the user manually clear all filters.
 */
export function usePersistedFilters<T extends Record<string, unknown>>(
  pageKey: string,
  shopId: string | null | undefined,
  defaults: T
): readonly [T, (updates: Partial<T>) => void, () => void] {
  const defaultsRef = useRef(defaults)

  const makeKey = (sid: string | null | undefined) =>
    sid ? `filters_session_${pageKey}_${sid}` : null

  const read = (key: string | null): T => {
    if (!key || typeof window === 'undefined') return defaultsRef.current
    try {
      const raw = sessionStorage.getItem(key)
      if (!raw) return defaultsRef.current
      return { ...defaultsRef.current, ...JSON.parse(raw) }
    } catch {
      return defaultsRef.current
    }
  }

  const [filters, setFiltersState] = useState<T>(defaultsRef.current)

  // When shop changes: reset filters for the new shop
  const prevShopId = useRef(shopId)
  useEffect(() => {
    if (prevShopId.current !== shopId) {
      prevShopId.current = shopId
      setFiltersState(defaultsRef.current)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shopId])

  // Clear filters from sessionStorage when navigating away (unmount)
  useEffect(() => {
    return () => {
      const key = makeKey(prevShopId.current)
      if (key) {
        try { sessionStorage.removeItem(key) } catch { /* ignore */ }
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageKey])

  const setFilter = useCallback((updates: Partial<T>) => {
    setFiltersState(prev => {
      const next = { ...prev, ...updates }
      return next
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageKey])

  const resetFilters = useCallback(() => {
    setFiltersState(defaultsRef.current)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageKey])

  return [filters, setFilter, resetFilters] as const
}

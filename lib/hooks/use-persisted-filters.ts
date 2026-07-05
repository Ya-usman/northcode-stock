import { useState, useCallback, useEffect, useRef } from 'react'

/**
 * Manages page filters with sessionStorage persistence (within a tab session).
 * - Filters survive navigation: leaving and returning to a page restores the
 *   last active filters — no reload or re-selection needed.
 * - Resets automatically when the active shop changes (different data context).
 * - Resets when a new calendar day starts (stale date ranges won't carry over).
 * - Clears when the browser tab is closed (sessionStorage is tab-scoped).
 * - resetFilters() lets the user manually clear all filters back to defaults.
 */

interface StoredEntry<T> {
  filters: T
  date: string // 'YYYY-MM-DD'
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

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
      const parsed = JSON.parse(raw)

      // New format: { filters, date } — reject if from a previous calendar day.
      if (parsed && typeof parsed === 'object' && 'filters' in parsed && 'date' in parsed) {
        const entry = parsed as StoredEntry<T>
        if (entry.date !== today()) {
          sessionStorage.removeItem(key)
          return defaultsRef.current
        }
        return { ...defaultsRef.current, ...entry.filters }
      }

      // Old format (plain object, no date) — treat as expired and migrate.
      sessionStorage.removeItem(key)
      return defaultsRef.current
    } catch {
      return defaultsRef.current
    }
  }

  // Lazy initializer: read persisted filters from sessionStorage on first mount.
  // If shopId is not yet known (auth still loading), defaults are used and the
  // shop-change effect below re-reads once shopId resolves.
  const [filters, setFiltersState] = useState<T>(() => read(makeKey(shopId)))

  const prevShopId = useRef(shopId)
  useEffect(() => {
    if (prevShopId.current === shopId) return
    // Shop changed: discard old shop's persisted filters and load the new shop's.
    const oldKey = makeKey(prevShopId.current)
    prevShopId.current = shopId
    if (oldKey) { try { sessionStorage.removeItem(oldKey) } catch {} }
    setFiltersState(read(makeKey(shopId)))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shopId])

  const setFilter = useCallback((updates: Partial<T>) => {
    setFiltersState(prev => {
      const next = { ...prev, ...updates }
      const key = makeKey(prevShopId.current)
      if (key) {
        try {
          const entry: StoredEntry<T> = { filters: next, date: today() }
          sessionStorage.setItem(key, JSON.stringify(entry))
        } catch {}
      }
      return next
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageKey])

  const resetFilters = useCallback(() => {
    setFiltersState(defaultsRef.current)
    const key = makeKey(prevShopId.current)
    if (key) { try { sessionStorage.removeItem(key) } catch {} }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageKey])

  return [filters, setFilter, resetFilters] as const
}

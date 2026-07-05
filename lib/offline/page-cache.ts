// localStorage cache for page-level data — used as fallback when offline

interface CacheEntry<T> {
  data: T
  cached_at: number
}

// 7-day hard limit: prevents serving arbitrarily stale data (deactivated
// members, outdated reports, old inventory) when the user is persistently offline.
// Pages that implement stale-while-revalidate still show the cache instantly
// on load and refresh silently in the background while online.
const PAGE_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

export function setPageCache<T>(key: string, data: T): void {
  try {
    const entry: CacheEntry<T> = { data, cached_at: Date.now() }
    localStorage.setItem(`pc_${key}`, JSON.stringify(entry))
  } catch {}
}

export function getPageCache<T>(key: string, maxAgeMs = PAGE_CACHE_MAX_AGE_MS): T | null {
  try {
    const raw = localStorage.getItem(`pc_${key}`)
    if (!raw) return null
    const entry = JSON.parse(raw) as CacheEntry<T> | T
    if (entry && typeof entry === 'object' && 'cached_at' in entry && 'data' in entry) {
      const e = entry as CacheEntry<T>
      // Reject entries older than maxAgeMs
      if (Date.now() - e.cached_at > maxAgeMs) return null
      return e.data
    }
    // Old format (no cached_at) — return as-is; next write will use new format
    return entry as T
  } catch {
    return null
  }
}

export function getPageCacheAge(key: string): number | null {
  try {
    const raw = localStorage.getItem(`pc_${key}`)
    if (!raw) return null
    const entry = JSON.parse(raw)
    if (entry && typeof entry === 'object' && 'cached_at' in entry) {
      return Date.now() - entry.cached_at
    }
    return null
  } catch {
    return null
  }
}

export function clearPageCache(key: string): void {
  try { localStorage.removeItem(`pc_${key}`) } catch {}
}

/** Remove all page-cache entries whose key starts with `prefix`. */
export function clearPageCacheByPrefix(prefix: string): void {
  try {
    const fullPrefix = `pc_${prefix}`
    const keys: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k && k.startsWith(fullPrefix)) keys.push(k)
    }
    keys.forEach(k => localStorage.removeItem(k))
  } catch {}
}

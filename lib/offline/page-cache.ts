// localStorage cache for page-level data — used as fallback when offline.
// This is the default, standard caching mechanism: every page's read cache
// (dashboard included, since it was migrated onto this) should use
// getPageCache/setPageCache unless it has a specific reason not to. Two
// pages deliberately don't, for reasons that don't apply anywhere else:
//   - sales/new/page.tsx uses IndexedDB (lib/offline/db.ts) instead, because
//     it needs to keep SELLING while offline (not just viewing stale data),
//     which needs a real write-queue-and-sync-later store, not a read cache
//     — and IndexedDB's much higher storage ceiling matters for a shop with
//     a large catalog. Its product/customer cache mirrors this module's
//     shape (image_url and category color/name included precisely so the
//     instant-paint-from-cache never looks visually incomplete — see the
//     git history for the bug this fixed).
//   - reports/page.tsx uses react-query + a persister instead, for its own
//     multi-query invalidation needs (lib/query-client.ts has the details).
//     A couple of the sales pages also import queryClient, but only to
//     broadcast "a sale just happened, refetch" signals across open tabs
//     (lib/data-refresh.ts) — that's a cross-page invalidation bus, not a
//     second data cache competing with this one.

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

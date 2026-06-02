// localStorage cache for page-level data — used as fallback when offline

interface CacheEntry<T> {
  data: T
  cached_at: number
}

export function setPageCache<T>(key: string, data: T): void {
  try {
    const entry: CacheEntry<T> = { data, cached_at: Date.now() }
    localStorage.setItem(`pc_${key}`, JSON.stringify(entry))
  } catch {}
}

export function getPageCache<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(`pc_${key}`)
    if (!raw) return null
    const entry = JSON.parse(raw) as CacheEntry<T> | T
    // Support old format (no cached_at)
    if (entry && typeof entry === 'object' && 'cached_at' in entry && 'data' in entry) {
      return (entry as CacheEntry<T>).data
    }
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

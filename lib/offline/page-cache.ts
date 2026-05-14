// Simple localStorage cache for page-level data — used as fallback when offline

export function setPageCache(key: string, data: unknown): void {
  try {
    localStorage.setItem(`pc_${key}`, JSON.stringify(data))
  } catch {}
}

export function getPageCache<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(`pc_${key}`)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

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

// Prix d'achat : JAMAIS sur l'appareil (localStorage), même pour une personne autorisée — l'écran l'affiche à partir
// de la réponse du serveur, sans le garder. Coûts reconnus : `buying_price` (produits, lots, lignes de vente, lignes
// de transfert) et le prix des lignes de bons de commande (`purchase_order_items[].unit_price`). Le `unit_price`
// d'une vente est un prix de VENTE : conservé.
function costFreeReplacer(this: unknown, k: string, v: unknown): unknown {
  if (k === 'buying_price') return undefined
  if (k === 'purchase_order_items' && Array.isArray(v))
    return v.map(line => (line && typeof line === 'object' ? (({ unit_price: _price, ...rest }: any) => rest)(line) : line))
  return v
}

/** Vrai si la valeur contient un coût (même règle que costFreeReplacer) */
export function containsCost(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  if (Array.isArray(value)) return value.some(containsCost)
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (k === 'buying_price') return true
    if (k === 'purchase_order_items' && Array.isArray(v) && v.some(l => !!l && typeof l === 'object' && 'unit_price' in (l as object))) return true
    if (containsCost(v)) return true
  }
  return false
}

export function setPageCache<T>(key: string, data: T): void {
  try {
    const entry: CacheEntry<T> = { data, cached_at: Date.now() }
    localStorage.setItem(`pc_${key}`, JSON.stringify(entry, costFreeReplacer))
  } catch {}
}

export function getPageCache<T>(key: string, maxAgeMs = PAGE_CACHE_MAX_AGE_MS): T | null {
  try {
    const raw = localStorage.getItem(`pc_${key}`)
    if (!raw) return null
    const entry = JSON.parse(raw) as CacheEntry<T> | T
    // Ancienne entrée écrite avec un coût : supprimée, jamais servie
    if (containsCost(entry)) { localStorage.removeItem(`pc_${key}`); return null }
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

/**
 * Retire de l'appareil les données mises en cache AVANT la protection du prix
 * d'achat (oct. 2026) : toute entrée de page, et le cache des Rapports, qui
 * contient encore un « buying_price ». Les écrans ne rangent plus de coût dans
 * ce cache — appelée à chaque ouverture de l'application, elle ne trouve donc
 * plus rien après le premier passage.
 */
export function purgeCostCaches(): number {
  let removed = 0
  try {
    const keys: string[] = []
    // Ancien cache des Rapports (marge, prix d'achat) : retiré sans condition
    if (localStorage.getItem('rq_cache_v1') !== null) { localStorage.removeItem('rq_cache_v1'); removed++ }
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && (k.startsWith('pc_') || k === 'rq_cache_v2')) keys.push(k) }
    for (const k of keys) {
      const v = localStorage.getItem(k)
      if (!v) continue
      let withCost = v.includes('"buying_price"')
      // Option A de la C3 (25 oct. 2026) : les dettes fournisseurs restent en cache pour qui a le droit de les voir
      // (écran Crédits, hors ligne) — mais une liste de fournisseurs ordinaire ne doit plus contenir de solde dû :
      // une telle entrée date d'avant l'étape C0 (13 oct.) et est supprimée.
      const debtCache = k.startsWith('pc_supplier_debtors_') || k.startsWith('pc_supplier_payments_hist_')
      if (!withCost && !debtCache && v.includes('"total_owed"')) withCost = true
      if (!withCost && v.includes('"purchase_order_items"')) { try { withCost = containsCost(JSON.parse(v)) } catch { withCost = true } }
      if (withCost) { localStorage.removeItem(k); removed++ }
    }
  } catch {}
  return removed
}

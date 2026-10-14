import { withTimeout } from '@/lib/utils/with-timeout'

// Côté écran de la source unique des prix d'achat (/api/costs).
//
// Un écran lit ses produits SANS leur coût (lib/products/columns), puis — si
// useRolePermissions().canViewCost est vrai — demande les coûts ici et les pose
// sur ses lignes avec `withCosts`. Sans le droit, il ne demande rien : la
// donnée n'arrive jamais dans le navigateur. Les coûts ne sont pas rangés dans
// le cache local des pages (lib/offline/page-cache) : un appareil partagé ne
// les garde pas pour la personne suivante.

export interface Costs {
  /** Boutiques pour lesquelles le serveur a accordé les coûts */
  shops: string[]
  products: Record<string, number>
  /** Coût de chaque lot ; null = inconnu (lot créé sans prix d’achat connu) */
  batches: Record<string, number | null>
}

export const NO_COSTS: Costs = { shops: [], products: {}, batches: {} }

/** Coûts des boutiques demandées ; null si la personne n'y a pas droit (403) — jamais une erreur bloquante pour l'écran. */
export async function fetchCosts(shopIds: string[], opts: { batches?: boolean } = {}): Promise<Costs | null> {
  if (!shopIds.length) return null
  const res = await withTimeout(fetch(`/api/costs?shop_ids=${shopIds.join(',')}${opts.batches ? '&batches=1' : ''}`), 20_000)
  if (res.status === 403) return null
  if (!res.ok) throw new Error(`costs ${res.status}`)
  const json = await res.json()
  return { shops: json.shops || [], products: json.products || {}, batches: json.batches || {} }
}

/** Pose le prix d'achat sur chaque ligne dont le coût est connu ; les autres restent sans (jamais 0 inventé). */
export function withCosts<T extends { id: string }>(rows: T[], costs: Record<string, number> | null | undefined): T[] {
  if (!costs) return rows
  return rows.map(r => (r.id in costs ? { ...r, buying_price: costs[r.id] } : r))
}

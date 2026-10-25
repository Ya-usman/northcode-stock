// Champs de coût dans les réponses et les écritures des routes serveur — à utiliser AVEC canViewCost
// (lib/api/role-permissions), jamais à sa place. Sans le droit au coût, le champ est ABSENT de la réponse
// (ni null ni 0), et une valeur envoyée par l'appareil est ignorée (jamais écrite).
//
// Module sans dépendance (testé par tests/e2e/cost-permission-pure.mjs).

/** Clés qui portent un prix d'achat ou une valeur qui en dérive directement */
export const COST_KEYS = ['buying_price', 'price_from', 'price_to', 'value_delta'] as const

/** Copie de la valeur sans aucune clé de coût, à toute profondeur (lignes, lots, métadonnées de journal…) */
export function omitCost<T>(value: T): T {
  if (Array.isArray(value)) return value.map(omitCost) as unknown as T
  if (!value || typeof value !== 'object' || value instanceof Date) return value
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if ((COST_KEYS as readonly string[]).includes(k)) continue
    out[k] = omitCost(v)
  }
  return out as T
}

/** La valeur telle quelle avec le droit au coût, sinon sans aucune clé de coût */
export function costVisible<T>(value: T, canSeeCost: boolean): T {
  return canSeeCost ? value : omitCost(value)
}

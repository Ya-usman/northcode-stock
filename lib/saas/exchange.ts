// Conversion de devises pour le REPORTING agrégé — fonctions PURES.
//
// Ne modifie JAMAIS un montant stocké (wallets, paiements, retraits,
// transactions) : sert à afficher un total unique dans une « devise de
// reporting » choisie par l'admin, à partir de montants qui restent, en
// base, dans leur devise d'origine.
//
// Ce module est sûr côté client (aucun import de fournisseur / de Supabase).
// La récupération et le stockage des taux vivent dans `exchange-service.ts`
// (serveur uniquement).

export const PIVOT_CURRENCY = 'USD'

// Fraîcheur d'un taux (en jours depuis effective_date / fetched_at).
export const RATE_FRESH_DAYS = 2
export const RATE_STALE_DAYS = 8
export type Freshness = 'fresh' | 'stale' | 'very_stale' | 'unknown'

export interface RateInfo {
  /** 1 <devise> = rate USD */
  rate: number
  as_of: string
  source: string
  provider: string | null
  effective_date: string | null
  fetched_at: string | null
  is_manual_override: boolean
}
export type RateMap = Record<string, RateInfo>

export function rateFreshness(
  info: Pick<RateInfo, 'effective_date' | 'fetched_at' | 'is_manual_override'> | undefined,
): Freshness {
  if (!info) return 'unknown'
  if (info.is_manual_override) return 'fresh' // un override est « voulu », pas périmé
  const ref = info.effective_date || info.fetched_at
  if (!ref) return 'unknown'
  const days = (Date.now() - new Date(ref).getTime()) / 86_400_000
  if (days <= RATE_FRESH_DAYS) return 'fresh'
  if (days <= RATE_STALE_DAYS) return 'stale'
  return 'very_stale'
}

/**
 * Convertit `amount` de `from` vers `to`. Renvoie `null` si un taux manque
 * (jamais d'approximation silencieuse).
 */
export function convertAmount(
  amount: number,
  from: string,
  to: string,
  rates: RateMap,
): number | null {
  if (!Number.isFinite(amount)) return null
  if (from === to) return amount
  const rFrom = from === PIVOT_CURRENCY ? 1 : rates[from]?.rate
  const rTo = to === PIVOT_CURRENCY ? 1 : rates[to]?.rate
  if (!rFrom || !rTo) return null
  return (amount * rFrom) / rTo
}

/**
 * Agrège une ventilation `{ devise: montant }` en UN total dans `target`.
 *   - `value` : total converti (des seules devises convertibles)
 *   - `missing` : devises sans taux, exclues du total
 *   - `oldest_as_of` : effective_date la plus ancienne utilisée (tooltip)
 *   - `worst_freshness` : pire fraîcheur parmi les taux utilisés
 */
export function convertByCurrency(
  amounts: Record<string, number> | null | undefined,
  target: string,
  rates: RateMap,
): { value: number; missing: string[]; oldest_as_of: string | null; worst_freshness: Freshness } {
  let value = 0
  const missing: string[] = []
  let oldest: string | null = null
  const order: Freshness[] = ['fresh', 'stale', 'very_stale', 'unknown']
  let worst: Freshness = 'fresh'

  for (const [cur, amt] of Object.entries(amounts ?? {})) {
    const n = Number(amt) || 0
    if (n === 0) continue
    const converted = convertAmount(n, cur, target, rates)
    if (converted === null) {
      missing.push(cur)
      continue
    }
    value += converted
    for (const c of [cur, target]) {
      if (c === PIVOT_CURRENCY) continue
      const info = rates[c]
      if (!info) continue
      const eff = info.effective_date || info.fetched_at || info.as_of
      if (eff && (!oldest || eff < oldest)) oldest = eff
      const f = rateFreshness(info)
      if (order.indexOf(f) > order.indexOf(worst)) worst = f
    }
  }

  return { value: Math.round(value * 100) / 100, missing, oldest_as_of: oldest, worst_freshness: worst }
}

/**
 * Convertit une SÉRIE (ex. un point par mois) vers `target` — même règle
 * que `convertByCurrency`, appliquée point par point : chaque devise
 * d'origine est convertie individuellement PUIS additionnée (jamais
 * `XAF + NGN` avant conversion). Utilisé par les graphiques admin
 * (Command Center, Analytics) pour que les KPI consolidés et les
 * graphiques utilisent exactement la même logique.
 *
 * Limite documentée : un seul jeu de taux « courant » (`rates`), pas de
 * taux historique par mois — l'architecture FX actuelle
 * (lib/saas/exchange-service.ts) ne conserve que le dernier taux connu par
 * devise, pas une série temporelle interrogeable par date. Un point de
 * janvier et un point d'août sont donc convertis avec le MÊME taux
 * (celui d'aujourd'hui). À revoir si une vraie table de taux historiques
 * est introduite un jour.
 */
export function convertChartSeries<T extends { byCurrency: Record<string, number> }>(
  points: T[],
  target: string,
  rates: RateMap,
): Array<T & { value: number; missingCurrencies: string[] }> {
  return points.map((p) => {
    const { value, missing } = convertByCurrency(p.byCurrency, target, rates)
    return { ...p, value, missingCurrencies: missing }
  })
}

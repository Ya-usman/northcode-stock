// Paliers de prix de gros (migration 202, 2 nov. 2026) : UNE règle de saisie, partagée par le formulaire, la revue des
// prix à la réception et le serveur (lib/api/new-product checkPriceTiers). Module pur.
//   jusqu'à 3 paliers { min_qty, price } ; lignes entièrement vides ignorées ; quantités entières de 2 à 100 000,
//   toutes différentes ; chaque palier moins cher que le précédent ; le premier sous le prix de détail.
// Base de données : même contrôle (public.valid_price_tiers), sauf la comparaison au prix de détail.

export interface PriceTierInput { min_qty?: unknown; price?: unknown }
export interface PriceTier { min_qty: number; price: number }
export type TierProblem = 'invalid' | 'too_many' | 'incomplete' | 'price' | 'min' | 'order' | 'not_below'
export const MAX_TIERS = 3

const num = (v: unknown) => (v === null || v === undefined || v === '' ? null : Number(v))

/** Paliers saisis → liste propre triée (null = aucun palier), ou le problème à corriger */
export function normalizeTiers(raw: unknown, retail: number): { ok: true; tiers: PriceTier[] | null } | { ok: false; problem: TierProblem } {
  if (raw === null || raw === undefined || raw === '') return { ok: true, tiers: null }
  if (!Array.isArray(raw)) return { ok: false, problem: 'invalid' }
  const rows = raw.map((r: PriceTierInput) => ({ min: num(r?.min_qty), price: num(r?.price) })).filter(r => r.min !== null || r.price !== null)
  if (!rows.length) return { ok: true, tiers: null }
  if (rows.length > MAX_TIERS) return { ok: false, problem: 'too_many' }
  for (const r of rows) {
    if (r.min === null || r.price === null) return { ok: false, problem: 'incomplete' }
    if (!Number.isFinite(r.price) || !(r.price > 0)) return { ok: false, problem: 'price' }
    if (!Number.isInteger(r.min) || r.min < 2 || r.min > 100000) return { ok: false, problem: 'min' }
  }
  const sorted = [...rows].sort((x, y) => (x.min as number) - (y.min as number))
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].min === sorted[i - 1].min || !((sorted[i].price as number) < (sorted[i - 1].price as number))) return { ok: false, problem: 'order' }
  }
  if (!((sorted[0].price as number) < retail)) return { ok: false, problem: 'not_below' }
  return { ok: true, tiers: sorted.map(r => ({ min_qty: r.min as number, price: r.price as number })) }
}

/** Quantités proposées en un geste : dizaine, douzaine, et le colis du produit (demi et entier) s'il y en a un */
export function tierPresets(packUnits?: number | null): { key: 'ten' | 'dozen' | 'half_pack' | 'pack'; qty: number }[] {
  const out: { key: 'ten' | 'dozen' | 'half_pack' | 'pack'; qty: number }[] = [{ key: 'ten', qty: 10 }, { key: 'dozen', qty: 12 }]
  const n = Number(packUnits) || 0
  if (n >= 4 && n % 2 === 0 && n / 2 !== 10 && n / 2 !== 12) out.push({ key: 'half_pack', qty: n / 2 })
  if (n >= 2 && n !== 10 && n !== 12) out.push({ key: 'pack', qty: n })
  return out
}

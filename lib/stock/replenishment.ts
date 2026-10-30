// Réapprovisionnement (étape 12 du Stock, décisions du 30 oct. 2026) : règle UNIQUE, pure, partagée par le serveur
// (/api/stock/replenishment) et les écrans (onglet Réapprovisionnement, bons de commande de Fournisseurs).
//
//   Stock prévu      = disponible (physique − périmé − réservé) + en commande + en transit + déjà en brouillon
//   À commander      si stock prévu ≤ seuil, ou s'il couvre moins de (délai fournisseur + 7) jours de ventes
//   Quantité suggérée = de quoi couvrir (délai + N) jours de ventes, au moins 2 × seuil, moins le stock prévu ;
//                      N = horizon choisi dans l'écran (15 / 30 / 60, 30 par défaut). Jamais moins de 1.
//   Peu de ventes    (moins de 3 sur 30 jours) : le rythme n'est pas fiable, seule la règle du seuil s'applique.
// Les brouillons de bons de commande comptent dans le stock prévu : un produit déjà mis dans un brouillon n'est pas
// proposé une seconde fois (pas de double commande).

export const REPLENISH_HORIZONS = [15, 30, 60] as const
export type ReplenishHorizon = (typeof REPLENISH_HORIZONS)[number]
export const DEFAULT_REPLENISH_HORIZON: ReplenishHorizon = 30
/** Marge de couverture en plus du délai fournisseur (même seuil que l'alerte « couverture ≤ 7 jours ») */
export const REPLENISH_ALERT_DAYS = 7
/** Délai constaté : seulement à partir de ce nombre de bons reçus chez le fournisseur */
export const OBSERVED_LEAD_MIN_ORDERS = 2
export const LEAD_TIME_MAX_DAYS = 180
/** En dessous de ce nombre d'unités vendues sur 30 jours, pas de rythme fiable (même valeur que COVERAGE_LOW_VOLUME de
 *  lib/stock/signals, non importée pour garder cette règle pure, sans dépendance au navigateur) */
export const REPLENISH_MIN_SALES = 3

export function normalizeHorizon(v: unknown): ReplenishHorizon {
  const n = Number(v)
  return (REPLENISH_HORIZONS as readonly number[]).includes(n) ? (n as ReplenishHorizon) : DEFAULT_REPLENISH_HORIZON
}

/** Ce qu'il faut savoir d'un produit pour décider (quantités déjà calculées par les règles du Stock) */
export interface ReplenishFacts {
  available: number
  onOrder: number
  inTransit: number
  drafted: number
  threshold: number
  /** Unités vendues sur 30 jours ; null = inconnu */
  sold30: number | null
}

export const projectedStock = (f: ReplenishFacts): number =>
  Math.max(0, f.available) + Math.max(0, f.onOrder) + Math.max(0, f.inTransit) + Math.max(0, f.drafted)

/** Ventes par jour, ou null quand le volume est trop faible pour en tirer un rythme */
export function dailySales(sold30: number | null | undefined): number | null {
  if (sold30 == null || !Number.isFinite(sold30) || sold30 < REPLENISH_MIN_SALES) return null
  return sold30 / 30
}

export type ReplenishReason = 'out' | 'low' | 'coverage'
export interface ReplenishNeed {
  needed: boolean
  reason: ReplenishReason | null
  projected: number
  daily: number | null
  /** Jours couverts par le stock prévu (null sans rythme de ventes) */
  coverageDays: number | null
}

const cleanLead = (d: number | null | undefined): number =>
  d != null && Number.isFinite(d) && d > 0 ? Math.min(Math.round(d), LEAD_TIME_MAX_DAYS) : 0

export function replenishNeed(f: ReplenishFacts, leadDays: number | null = null): ReplenishNeed {
  const projected = projectedStock(f)
  const daily = dailySales(f.sold30)
  const coverageDays = daily ? Math.floor(projected / daily) : null
  const lead = cleanLead(leadDays)
  const needed = projected <= f.threshold || (daily != null && projected / daily < lead + REPLENISH_ALERT_DAYS)
  const reason: ReplenishReason | null = !needed ? null : f.available <= 0 ? 'out' : projected <= f.threshold ? 'low' : 'coverage'
  return { needed, reason, projected, daily, coverageDays }
}

/** Quantité suggérée (≥ 1) pour couvrir le délai du fournisseur + l'horizon choisi */
export function suggestedQty(f: ReplenishFacts, opts: { horizon: number; leadDays?: number | null }): number {
  const daily = dailySales(f.sold30)
  const days = cleanLead(opts.leadDays) + Math.max(1, Math.round(opts.horizon))
  const target = Math.max(2 * Math.max(0, f.threshold), daily ? Math.ceil(daily * days) : 0)
  return Math.max(1, target - projectedStock(f))
}

/**
 * Base de la quantité suggérée, pour l'expliquer à l'écran (30 oct. 2026 : « la durée ne change rien » sans
 * explication semblait être une panne) :
 *  - few_sales : moins de REPLENISH_MIN_SALES ventes en 30 jours, pas de rythme fiable → seuil d'alerte × 2, la durée
 *    choisie n'a aucun effet ;
 *  - threshold : le rythme existe, mais le seuil × 2 dépasse les ventes prévues sur la période (durée + délai) ;
 *  - rhythm : ventes prévues sur la période (days = durée + délai fournisseur, lead = délai).
 */
export type SuggestionBasis = { kind: 'few_sales' } | { kind: 'threshold'; days: number } | { kind: 'rhythm'; days: number; lead: number }
export function suggestionBasis(f: Pick<ReplenishFacts, 'threshold' | 'sold30'>, opts: { horizon: number; leadDays?: number | null }): SuggestionBasis {
  const daily = dailySales(f.sold30)
  if (!daily) return { kind: 'few_sales' }
  const lead = cleanLead(opts.leadDays)
  const days = lead + Math.max(1, Math.round(opts.horizon))
  return 2 * Math.max(0, f.threshold) >= Math.ceil(daily * days) ? { kind: 'threshold', days } : { kind: 'rhythm', days, lead }
}

// ── Fournisseurs : délai et meilleures offres ─────────────────────────────────────────────────────────────────

export interface LeadTime { days: number; source: 'declared' | 'observed' }

/** Délai constaté par fournisseur : médiane (jours, arrondie au supérieur) entre envoi et réception des bons reçus */
export function observedLeadDays(orders: { supplier_id: string | null; sent_at: string | null; received_at: string | null }[]): Record<string, number> {
  const bySupplier: Record<string, number[]> = {}
  for (const o of orders) {
    if (!o.supplier_id || !o.sent_at || !o.received_at) continue
    const ms = Date.parse(o.received_at) - Date.parse(o.sent_at)
    if (!Number.isFinite(ms) || ms < 0) continue
    ;(bySupplier[o.supplier_id] ||= []).push(ms / 86_400_000)
  }
  const out: Record<string, number> = {}
  for (const [id, days] of Object.entries(bySupplier)) {
    if (days.length < OBSERVED_LEAD_MIN_ORDERS) continue
    const s = [...days].sort((a, b) => a - b)
    const mid = s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2
    out[id] = Math.min(LEAD_TIME_MAX_DAYS, Math.max(0, Math.ceil(mid - 1e-9)))
  }
  return out
}

/** Délai retenu : déclaré dans la fiche, sinon constaté, sinon inconnu */
export function leadTimeOf(declared: number | null | undefined, observed: number | null | undefined): LeadTime | null {
  if (declared != null && Number.isFinite(declared) && declared >= 0) return { days: Math.min(Math.round(declared), LEAD_TIME_MAX_DAYS), source: 'declared' }
  if (observed != null && Number.isFinite(observed) && observed >= 0) return { days: observed, source: 'observed' }
  return null
}

export interface SupplierOffer {
  supplierId: string
  /** Prix d'achat connu chez ce fournisseur (null = inconnu ou non visible) */
  price: number | null
  priceAt: string | null
  leadDays: number | null
}

/**
 * Alternatives au fournisseur habituel, à PROPOSER (jamais appliquées d'office) :
 *   cheaper : prix strictement plus bas que celui du fournisseur habituel (les deux prix connus) ;
 *   faster  : délai strictement plus court (les deux délais connus).
 * Sans fournisseur habituel : la meilleure offre connue de chaque sorte.
 */
export function bestOffers(offers: SupplierOffer[], usualId: string | null | undefined): { cheaper: SupplierOffer | null; faster: SupplierOffer | null } {
  const usual = usualId ? offers.find(o => o.supplierId === usualId) ?? null : null
  const others = offers.filter(o => o.supplierId !== usualId)
  const priced = others.filter(o => o.price != null && o.price > 0).sort((a, b) => (a.price as number) - (b.price as number) || a.supplierId.localeCompare(b.supplierId))
  const timed = others.filter(o => o.leadDays != null).sort((a, b) => (a.leadDays as number) - (b.leadDays as number) || a.supplierId.localeCompare(b.supplierId))
  let cheaper: SupplierOffer | null = priced[0] ?? null
  let faster: SupplierOffer | null = timed[0] ?? null
  if (usualId) {
    if (!cheaper || usual?.price == null || !(usual.price > 0) || !((cheaper.price as number) < usual.price)) cheaper = null
    if (!faster || usual?.leadDays == null || !((faster.leadDays as number) < usual.leadDays)) faster = null
  }
  return { cheaper, faster }
}

/** Fournisseur au prix le plus bas pour chaque ligne (bouton « Tout au moins cher ») ; inchangé sans mieux */
export function cheapestChoice(lines: { key: string; supplierId: string | null; offers: SupplierOffer[] }[]): Record<string, string | null> {
  const out: Record<string, string | null> = {}
  for (const l of lines) {
    const priced = l.offers.filter(o => o.price != null && o.price > 0).sort((a, b) => (a.price as number) - (b.price as number) || a.supplierId.localeCompare(b.supplierId))
    const current = l.offers.find(o => o.supplierId === l.supplierId)
    const best = priced[0]
    out[l.key] = best && (current?.price == null || (best.price as number) < (current.price as number)) ? best.supplierId : l.supplierId
  }
  return out
}

/** Date de livraison prévue d'un bon : aujourd'hui (date de la boutique) + délai, au format AAAA-MM-JJ */
export function expectedDeliveryDate(today: string, leadDays: number | null | undefined): string | null {
  if (leadDays == null || !Number.isFinite(leadDays) || leadDays <= 0) return null
  const d = new Date(`${today}T12:00:00Z`)
  if (Number.isNaN(d.getTime())) return null
  d.setUTCDate(d.getUTCDate() + Math.min(Math.round(leadDays), LEAD_TIME_MAX_DAYS))
  return d.toISOString().slice(0, 10)
}

// Consolidation multi-devises des rapports d'une entreprise (lot 5, décision D1) — fonctions PURES.
//
// Règles validées le 23 oct. 2026 :
//   • La ventilation par devise d'origine est TOUJOURS la valeur de référence ; le consolidé « ≈ » ne vient
//     qu'en complément, dans la devise de consolidation de l'ENTREPRISE (entities.consolidation_currency),
//     déterminée par le serveur (boutique → entity_id → devise), jamais par le navigateur.
//   • Une seule devise dans le périmètre → aucune conversion, aucun « ≈ », aucun taux.
//   • Boutiques de PLUSIEURS entreprises dans le périmètre → aucun consolidé (jamais la devise d'une
//     entreprise appliquée à une autre, jamais d'addition entre entreprises).
//   • FLUX (ventes, encaissements, dépenses, marge, graphiques, classements) : chaque opération est convertie
//     au taux de SA date (date UTC de l'opération), puis additionnée — jamais XAF + NGN avant conversion.
//   • SOLDES (crédits, valeur du stock, positions) : taux de clôture à la date de situation du rapport.
//   • Choix du taux d'une date : taux exact ; sinon dernier taux publié AVANT (jamais après, jamais de moyenne
//     ni d'interpolation), au plus 5 jours calendaires ; au-delà : indisponible. Chaque repli est enregistré
//     (devise, date demandée, date du taux, source) pour les exports détaillés, l'audit et le diagnostic.
//   • À date égale : taux manuel VALIDE > Frankfurter > er-api. Taux manuel valide = override posé par un
//     super_admin (is_manual_override ET provider 'manual', /api/admin/exchange-rates). Toute autre source
//     (ex. anciens « manual_seed ») est IGNORÉE.
//   • Parité fixe officielle : 1 EUR = 655,957 XAF = 655,957 XOF, exacte, jamais triangulée par l'USD, jamais
//     lue dans les taux du marché, jamais soumise au repli (la base arrondit les taux à 10 décimales).
//   • Taux indisponible : rien n'est inventé ; le montant reste dans sa devise, exclu du consolidé, qui devient
//     « ≈ Total partiel » avec la liste (devise, date) des taux indisponibles.
//
// Aucun import de Supabase ni de fournisseur : utilisable côté serveur comme côté client.

import { PIVOT_CURRENCY } from '@/lib/saas/exchange'

/** Parités fixes officielles vis-à-vis de l'euro : 1 EUR = N unités. */
export const EUR_FIXED_PARITIES: Record<string, number> = { XAF: 655.957, XOF: 655.957 }
const EURO_ZONE = (c: string) => c === 'EUR' || c in EUR_FIXED_PARITIES
/** Nombre d'unités de `c` pour 1 EUR (EUR = 1). Uniquement pour EUR / XAF / XOF. */
const perEuro = (c: string) => (c === 'EUR' ? 1 : EUR_FIXED_PARITIES[c])

/** Repli maximal (jours calendaires) vers le dernier taux publié AVANT la date demandée. Au-delà : indisponible. */
export const MAX_FALLBACK_DAYS = 5

export type RateSource = 'fixed_parity' | 'manual' | 'frankfurter' | 'er-api'

export interface RateRow {
  currency: string
  /** YYYY-MM-DD */
  effective_date: string
  /** 1 <currency> = rate USD */
  rate: number
  provider: string
  is_manual_override: boolean
}

export interface ResolvedRate { rate: number; effectiveDate: string; source: RateSource }

/** Source d'une ligne de taux, ou null si elle ne doit jamais être utilisée (source inconnue / non validée). */
function sourceOf(r: RateRow): Exclude<RateSource, 'fixed_parity'> | null {
  if (r.is_manual_override) return r.provider === 'manual' ? 'manual' : null
  return r.provider === 'frankfurter' || r.provider === 'er-api' ? r.provider : null
}
const PRIORITY: Record<string, number> = { manual: 3, frankfurter: 2, 'er-api': 1 }

const dayDiff = (a: string, b: string) =>
  Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000)

/** Index en mémoire des taux <devise>→USD : une seule ligne retenue par (devise, date), selon la priorité. */
export interface RateIndex {
  /** Taux <currency>→USD applicable à `date` : exact, sinon dernier avant (≤ MAX_FALLBACK_DAYS), sinon null. */
  usd(currency: string, date: string): ResolvedRate | null
}

export function buildRateIndex(rows: RateRow[], maxFallbackDays = MAX_FALLBACK_DAYS): RateIndex {
  const best = new Map<string, Map<string, ResolvedRate>>()
  for (const r of rows) {
    const source = sourceOf(r)
    if (!source || !Number.isFinite(r.rate) || r.rate <= 0) continue
    const byDate = best.get(r.currency) ?? new Map<string, ResolvedRate>()
    const cur = byDate.get(r.effective_date)
    if (!cur || PRIORITY[source] > PRIORITY[cur.source]) byDate.set(r.effective_date, { rate: r.rate, effectiveDate: r.effective_date, source })
    best.set(r.currency, byDate)
  }
  const sorted = new Map<string, ResolvedRate[]>()
  best.forEach((byDate, c) => sorted.set(c, Array.from(byDate.values()).sort((a, b) => (a.effectiveDate < b.effectiveDate ? -1 : 1))))

  return {
    usd(currency, date) {
      if (currency === PIVOT_CURRENCY) return { rate: 1, effectiveDate: date, source: 'fixed_parity' }
      const arr = sorted.get(currency)
      if (!arr) return null
      let found: ResolvedRate | null = null
      for (const r of arr) { if (r.effectiveDate > date) break; found = r }
      if (!found || dayDiff(date, found.effectiveDate) > maxFallbackDays) return null
      return found
    },
  }
}

/** Taux réellement utilisé pour une jambe de conversion (traçabilité : exports détaillés, audit). */
export interface RateUse { currency: string; requestedDate: string; rateDate: string; source: RateSource }

export interface ConversionResult { value: number; sources: RateSource[]; uses: RateUse[] }

/**
 * Convertit `amount` de `from` vers `to` à la date `date` (YYYY-MM-DD). `null` si un taux manque.
 *   • EUR / XAF / XOF entre eux : parité fixe exacte, aucun taux du marché, aucun repli.
 *   • XAF / XOF ↔ autre devise : passage exact par l'euro, puis taux du marché EUR ↔ autre devise à cette date.
 *   • Autres paires : les deux jambes <devise>→USD résolues à la MÊME date.
 */
export function convertAt(amount: number, from: string, to: string, date: string, index: RateIndex): ConversionResult | null {
  if (!Number.isFinite(amount)) return null
  if (from === to) return { value: amount, sources: [], uses: [] }
  if (EURO_ZONE(from) && EURO_ZONE(to)) {
    // Même parité (XAF ↔ XOF) : 1:1 strict, sans aller-retour par l'euro (aucune erreur d'arrondi).
    const value = perEuro(from) === perEuro(to) ? amount : (amount / perEuro(from)) * perEuro(to)
    return { value, sources: ['fixed_parity'], uses: [] }
  }
  // Une jambe dans la zone euro à parité fixe : on se ramène à l'euro exactement, puis taux du marché de l'euro.
  const legFrom = EURO_ZONE(from) ? 'EUR' : from
  const legTo = EURO_ZONE(to) ? 'EUR' : to
  const amountIn = EURO_ZONE(from) ? amount / perEuro(from) : amount
  const rFrom = index.usd(legFrom, date)
  const rTo = index.usd(legTo, date)
  if (!rFrom || !rTo) return null
  let value = (amountIn * rFrom.rate) / rTo.rate
  if (EURO_ZONE(to)) value *= perEuro(to)
  const sources: RateSource[] = []
  const uses: RateUse[] = []
  for (const [leg, r] of [[legFrom, rFrom], [legTo, rTo]] as const) {
    if (leg === PIVOT_CURRENCY) continue
    sources.push(r.source)
    uses.push({ currency: leg, requestedDate: date, rateDate: r.effectiveDate, source: r.source })
  }
  if ((EURO_ZONE(from) && from !== 'EUR') || (EURO_ZONE(to) && to !== 'EUR')) sources.push('fixed_parity')
  return { value, sources, uses }
}

// ── Résultat consolidé ─────────────────────────────────────────────────────────────────────────────────────

export interface MissingRate { currency: string; date: string }

export interface Consolidated {
  /** Devise de consolidation de l'entreprise. */
  currency: string
  value: number
  /** Au moins un montant exclu faute de taux : afficher « ≈ Total partiel ». */
  partial: boolean
  /** Taux indisponibles (dédoublonnés, triés), pour « Taux indisponible pour NGN le 14/03/2026 ». */
  missing: MissingRate[]
  /** Sources réellement utilisées (fixed_parity, frankfurter, er-api, manual). */
  sources: RateSource[]
  /** Replis utilisés (date du taux ≠ date demandée) : pas affichés normalement, disponibles pour l'export / l'audit. */
  fallbacks: RateUse[]
  /** 'historical' = taux de la date de chaque opération ; 'closing' = taux de clôture à valuationDate. */
  method: 'historical' | 'closing'
  valuationDate?: string
}

/** Pourquoi il n'y a pas de consolidé : une seule devise (cas normal) ou boutiques de plusieurs entreprises. */
export type NoConsolidationReason = 'single_currency' | 'multiple_entities'

export interface MoneyTotal {
  /** Valeurs de RÉFÉRENCE : montant par devise d'origine (devises présentes dans le périmètre uniquement). */
  byCurrency: Record<string, number>
  /** null si aucune conversion ne s'applique (voir `reason`). */
  consolidated: Consolidated | null
  reason?: NoConsolidationReason
}

export interface ConsolidationScope {
  /** Devise de consolidation de l'entreprise du périmètre ; null si plusieurs entreprises (ou aucune connue). */
  target: string | null
  /** Devises des boutiques du périmètre (et non des seuls montants non nuls). */
  scopeCurrencies: string[]
  /** Le périmètre contient des boutiques de plusieurs entreprises : jamais de consolidé. */
  multipleEntities?: boolean
  index: RateIndex
}

const isMulti = (s: Pick<ConsolidationScope, 'scopeCurrencies'>) => new Set(s.scopeCurrencies).size > 1

/** Faut-il consolider ? Plusieurs devises, une seule entreprise, et sa devise de consolidation connue. */
export const needsConsolidation = (s: Pick<ConsolidationScope, 'target' | 'scopeCurrencies' | 'multipleEntities'>) =>
  !s.multipleEntities && !!s.target && isMulti(s)

/** Raison d'absence de consolidé à exposer (undefined si consolidé). */
export function noConsolidationReason(s: Pick<ConsolidationScope, 'target' | 'scopeCurrencies' | 'multipleEntities'>): NoConsolidationReason | undefined {
  if (needsConsolidation(s)) return undefined
  return s.multipleEntities && isMulti(s) ? 'multiple_entities' : 'single_currency'
}

const round2 = (n: number) => Math.round(n * 100) / 100

function byCurrencyOf(scope: ConsolidationScope, lines: { currency: string; amount: number }[]) {
  const out: Record<string, number> = {}
  for (const c of Array.from(new Set(scope.scopeCurrencies))) out[c] = 0
  for (const l of lines) out[l.currency] = (out[l.currency] ?? 0) + (Number(l.amount) || 0)
  for (const c of Object.keys(out)) out[c] = round2(out[c])
  return out
}

class Accumulator {
  value = 0
  missing = new Map<string, MissingRate>()
  sources = new Set<RateSource>()
  fallbacks = new Map<string, RateUse>()
  add(r: ConversionResult | null, currency: string, date: string) {
    if (!r) { this.missing.set(`${currency}|${date}`, { currency, date }); return }
    this.value += r.value
    r.sources.forEach(s => this.sources.add(s))
    for (const u of r.uses) if (u.rateDate !== u.requestedDate) this.fallbacks.set(`${u.currency}|${u.requestedDate}`, u)
  }
  finish(target: string, method: Consolidated['method'], valuationDate?: string): Consolidated {
    const byKey = <T extends { currency: string }>(k: (x: T) => string) => (a: T, b: T) => (k(a) < k(b) ? -1 : k(a) > k(b) ? 1 : 0)
    const missing = Array.from(this.missing.values()).sort(byKey<MissingRate>(m => m.currency + m.date))
    return {
      currency: target, value: round2(this.value), partial: missing.length > 0, missing,
      sources: Array.from(this.sources).sort(),
      fallbacks: Array.from(this.fallbacks.values()).sort(byKey<RateUse>(u => u.currency + u.requestedDate)),
      method, ...(valuationDate ? { valuationDate } : {}),
    }
  }
}

/** FLUX : chaque opération convertie au taux de SA date, puis additionnée. */
export function consolidateFlows(scope: ConsolidationScope, lines: { currency: string; date: string; amount: number }[]): MoneyTotal {
  const byCurrency = byCurrencyOf(scope, lines)
  if (!needsConsolidation(scope)) return { byCurrency, consolidated: null, reason: noConsolidationReason(scope) }
  const target = scope.target!
  const acc = new Accumulator()
  for (const l of lines) {
    const n = Number(l.amount) || 0
    if (n === 0) continue
    acc.add(convertAt(n, l.currency, target, l.date, scope.index), l.currency, l.date)
  }
  return { byCurrency, consolidated: acc.finish(target, 'historical') }
}

/** SOLDES : montants par devise convertis au taux de clôture de `valuationDate` (YYYY-MM-DD). */
export function consolidateBalances(scope: ConsolidationScope, balances: { currency: string; amount: number }[], valuationDate: string): MoneyTotal {
  const byCurrency = byCurrencyOf(scope, balances)
  if (!needsConsolidation(scope)) return { byCurrency, consolidated: null, reason: noConsolidationReason(scope) }
  const target = scope.target!
  const acc = new Accumulator()
  for (const [currency, amount] of Object.entries(byCurrency)) {
    if (!amount) continue
    acc.add(convertAt(amount, currency, target, valuationDate, scope.index), currency, valuationDate)
  }
  return { byCurrency, consolidated: acc.finish(target, 'closing', valuationDate) }
}

/**
 * Valeur d'UN élément de classement (produit, vendeur…) dans la devise de consolidation, pour trier des éléments
 * de devises différentes. `null` si une opération n'a pas de taux : l'élément reste visible, signalé, classé
 * après les éléments valorisables. Une seule devise : la valeur d'origine (aucune conversion). Plusieurs devises
 * sans consolidé (plusieurs entreprises) : null — l'appelant classe alors devise par devise, jamais XAF contre NGN.
 */
export function rankingValue(scope: ConsolidationScope, lines: { currency: string; date: string; amount: number }[]): number | null {
  if (!needsConsolidation(scope)) return isMulti(scope) ? null : round2(lines.reduce((n, l) => n + (Number(l.amount) || 0), 0))
  let v = 0
  for (const l of lines) {
    const n = Number(l.amount) || 0
    if (n === 0) continue
    const r = convertAt(n, l.currency, scope.target!, l.date, scope.index)
    if (!r) return null
    v += r.value
  }
  return round2(v)
}

/** Date YYYY-MM-DD (UTC) d'un horodatage ou d'une date — convention unique pour le choix du taux d'un flux. */
export const opDate = (ts: string) => (ts.length === 10 ? ts : new Date(ts).toISOString().slice(0, 10))

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
  /**
   * Historique uniquement (absent pour un taux « courant ») : `true` si la
   * date demandée n'avait pas de taux exact et qu'on est retombé sur le
   * dernier taux disponible AVANT cette date (week-end, jour férié, ou
   * simple absence de publication ce jour-là pour cette devise).
   */
  is_fallback?: boolean
  /** Historique uniquement : la date réellement demandée (YYYY-MM-DD),
   *  à comparer à `effective_date` pour savoir de combien de jours le
   *  repli remonte. */
  requested_date?: string | null
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
 * `rates` peut être le jeu COURANT (KPI temps réel) ou un jeu HISTORIQUE
 * déjà résolu pour la date de chaque point (voir `buildHistoricalRateIndex`
 * ci-dessous — c'est l'appelant qui choisit quel `RateMap` construire et
 * passer ici ; cette fonction reste le SEUL moteur de conversion, jamais
 * dupliqué entre le cas courant et le cas historique).
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

// ════════════════════════════════════════════════════════════════════════
// RÉSOLUTION HISTORIQUE — pure, sans DB ni réseau (migration 146+)
// ════════════════════════════════════════════════════════════════════════
// Politique de sélection d'un taux pour une date donnée (documentée §6 du
// rapport pré-migration) :
//   1. Taux MANUEL (is_manual_override) pour CETTE date exacte → priorité
//      absolue, quel que soit le provider automatique disponible ce jour-là.
//   2. Sinon, taux automatique EXACT pour cette date.
//   3. Sinon, le DERNIER taux disponible (manuel ou automatique) AVANT cette
//      date → `is_fallback: true`, signalé explicitement dans le résultat
//      (jamais un repli silencieux).
//   4. Rien trouvé (même en remontant) → absent du RateMap résultant, JAMAIS
//      0, JAMAIS 1, JAMAIS une conversion approximative.

export interface HistoricalRateRow {
  currency: string
  /** YYYY-MM-DD */
  effective_date: string
  /** 1 <currency> = rate USD */
  rate: number
  provider: string
  is_manual_override: boolean
}

export interface HistoricalRateIndex {
  /** Résout le taux <currency>→USD applicable à `date` (YYYY-MM-DD) selon
   *  la politique ci-dessus. `null` si rien d'utilisable (même en repli). */
  rateFor(currency: string, date: string): RateInfo | null
}

/**
 * Construit un index en mémoire à partir d'un lot de lignes historiques
 * (typiquement TOUTES les lignes d'une plage de dates, chargées en UNE
 * requête par l'appelant — voir `getHistoricalRatesRaw` côté serveur).
 * Résoudre ensuite `rateFor(devise, date)` pour chaque transaction est du
 * pur calcul en mémoire : zéro requête, zéro appel réseau supplémentaire
 * par transaction, même sur une série de centaines de points.
 */
export function buildHistoricalRateIndex(rows: HistoricalRateRow[]): HistoricalRateIndex {
  const byCurrency = new Map<string, HistoricalRateRow[]>()
  for (const r of rows) {
    if (!Number.isFinite(r.rate) || r.rate <= 0) continue
    if (!byCurrency.has(r.currency)) byCurrency.set(r.currency, [])
    byCurrency.get(r.currency)!.push(r)
  }
  // Tri ascendant par date ; à date égale, l'override manuel passe en
  // dernier (donc gagne face à un automatique de la même date, règle n°1).
  for (const arr of Array.from(byCurrency.values())) {
    arr.sort((a: HistoricalRateRow, b: HistoricalRateRow) => {
      if (a.effective_date !== b.effective_date) return a.effective_date < b.effective_date ? -1 : 1
      if (a.is_manual_override !== b.is_manual_override) return a.is_manual_override ? 1 : -1
      return 0
    })
  }

  return {
    rateFor(currency: string, date: string): RateInfo | null {
      const arr = byCurrency.get(currency)
      if (!arr || arr.length === 0) return null
      // arr est trié croissant par date -> on garde la dernière ligne
      // rencontrée dont la date est <= `date` (donc la plus proche/exacte).
      let best: HistoricalRateRow | null = null
      for (const r of arr) {
        if (r.effective_date > date) break
        best = r
      }
      if (!best) return null
      return {
        rate: best.rate,
        as_of: `${best.effective_date}T12:00:00.000Z`,
        source: best.provider,
        provider: best.provider,
        effective_date: best.effective_date,
        fetched_at: null,
        is_manual_override: best.is_manual_override,
        is_fallback: best.effective_date !== date,
        requested_date: date,
      }
    },
  }
}

/**
 * Construit un `RateMap` pour UNE date précise à partir des lignes
 * chargées — pratique quand on n'a qu'une seule date à résoudre (ex. un
 * export ponctuel), plutôt qu'une série. Pour une série de transactions sur
 * plusieurs dates, préférer `buildHistoricalRateIndex` + `rateFor` par
 * transaction (une seule construction d'index, résolution en mémoire).
 */
export function buildHistoricalRateMap(
  rows: HistoricalRateRow[],
  date: string,
  currencies: string[],
): RateMap {
  const index = buildHistoricalRateIndex(rows)
  const rates: RateMap = {}
  for (const c of currencies) {
    if (c === PIVOT_CURRENCY) continue
    const info = index.rateFor(c, date)
    if (info) rates[c] = info
  }
  return rates
}

// ── Conversion PAR TRANSACTION (phase 4 — KPI & graphiques historiques) ──
// Chaque transaction (montant + devise + SA PROPRE date) est convertie avec
// le taux de SA date, puis les montants convertis sont additionnés. Jamais
// l'inverse (sommer d'abord des devises différentes, convertir ensuite) —
// même principe que convertByCurrency, étendu à une date par transaction
// plutôt qu'un taux unique pour tout le lot.

export interface DatedAmount {
  /** YYYY-MM-DD — date de LA transaction (jamais modifiée a posteriori). */
  date: string
  currency: string
  amount: number
}

/**
 * Convertit `amount` (devise `from`, date `date`) vers `to`, en résolvant
 * les DEUX jambes (from→USD et to→USD) à CETTE MÊME date via `index` —
 * jamais en mélangeant un taux historique pour l'un et le taux du jour pour
 * l'autre. Délègue à `convertAmount` (le seul moteur de conversion, jamais
 * dupliqué) via un `RateMap` ad hoc construit pour cette date précise.
 */
export function convertAmountAt(
  amount: number,
  from: string,
  to: string,
  date: string,
  index: HistoricalRateIndex,
): { value: number | null; sourceInfo: RateInfo | null; targetInfo: RateInfo | null } {
  const sourceInfo = from === PIVOT_CURRENCY ? null : index.rateFor(from, date)
  const targetInfo = to === PIVOT_CURRENCY ? null : index.rateFor(to, date)
  const rates: RateMap = {}
  if (sourceInfo) rates[from] = sourceInfo
  if (targetInfo) rates[to] = targetInfo
  return { value: convertAmount(amount, from, to, rates), sourceInfo, targetInfo }
}

export interface HistoricalConversionResult {
  value: number
  /** Devises (dédupliquées) exclues faute de taux — même pour leur date de repli. */
  missing: string[]
  /** Au moins une transaction a utilisé un taux de repli (date ≠ date exacte demandée). */
  usedFallback: boolean
  /** La plus ancienne effective_date réellement utilisée (pour affichage). */
  oldestEffectiveDate: string | null
}

/**
 * Agrège une LISTE de transactions datées vers `target` — l'équivalent
 * historique de `convertByCurrency`, mais chaque transaction porte sa
 * propre date au lieu d'un unique jeu de taux pour tout le lot.
 */
export function convertTransactionsAt(
  transactions: DatedAmount[],
  target: string,
  index: HistoricalRateIndex,
): HistoricalConversionResult {
  let value = 0
  const missing = new Set<string>()
  let usedFallback = false
  let oldest: string | null = null

  for (const t of transactions) {
    const n = Number(t.amount) || 0
    if (n === 0) continue
    const { value: converted, sourceInfo, targetInfo } = convertAmountAt(n, t.currency, target, t.date, index)
    if (converted === null) { missing.add(t.currency); continue }
    value += converted
    for (const info of [sourceInfo, targetInfo]) {
      if (!info) continue
      if (info.is_fallback) usedFallback = true
      if (info.effective_date && (!oldest || info.effective_date < oldest)) oldest = info.effective_date
    }
  }

  return { value: Math.round(value * 100) / 100, missing: Array.from(missing), usedFallback, oldestEffectiveDate: oldest }
}

/**
 * Équivalent historique de `convertChartSeries` : chaque point porte une
 * liste de transactions (pas un `byCurrency` déjà sommé) — chaque
 * transaction est convertie avec le taux de SA date puis sommée par point.
 * C'est ce qui permet à un point de janvier et un point d'août d'utiliser
 * des taux réellement différents (voir le test explicite dans
 * coverage/test-historical-fx.ts, section 12).
 */
export function convertChartSeriesHistorical<T extends { transactions: DatedAmount[] }>(
  points: T[],
  target: string,
  index: HistoricalRateIndex,
): Array<T & { value: number; missingCurrencies: string[]; usedFallback: boolean }> {
  return points.map((p) => {
    const { value, missing, usedFallback } = convertTransactionsAt(p.transactions, target, index)
    return { ...p, value, missingCurrencies: missing, usedFallback }
  })
}

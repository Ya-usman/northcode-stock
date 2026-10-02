// Récupération et stockage des taux de change — SERVEUR UNIQUEMENT.
//
// Importe les fournisseurs (appels réseau) et le client admin Supabase.
// Ne jamais importer ce module depuis un composant client — la couche de
// conversion pure est dans `exchange.ts`.
//
// Sources : chaîne EXCHANGE_PROVIDERS (Frankfurter puis er-api). Un taux
// « manuel » (is_manual_override) prend priorité sur l'automatique tant
// qu'il est actif — le rafraîchissement automatique le laisse intact.

import { EXCHANGE_PROVIDERS } from './exchange-providers'
import { SUPPORTED_CURRENCY_CODES } from './currencies'
import {
  PIVOT_CURRENCY, type RateMap, type HistoricalRateRow,
  buildHistoricalRateIndex, buildHistoricalRateMap,
} from './exchange'

// Fenêtre de sécurité pour la lecture du taux COURANT : borne la requête à
// une fenêtre glissante plutôt que de scanner toute la table (qui contient
// désormais aussi l'historique backfillé — migration 146, des milliers de
// lignes vouées à grossir). 21 jours couvre largement une panne prolongée
// des deux fournisseurs (le cron tourne quotidiennement) sans dégrader la
// requête au fil des mois/années d'historique accumulé.
const CURRENT_RATE_LOOKBACK_DAYS = 21
// Fenêtre de repli pour une résolution HISTORIQUE ponctuelle (§ voir
// getHistoricalRatesRaw) : couvre largement un week-end + jours fériés
// consécutifs pour les devises à publication non quotidienne (XAF/XOF/GHS…).
const HISTORICAL_LOOKBACK_DAYS = 10

function daysAgoIso(days: number, fromDate?: string): string {
  const base = fromDate ? new Date(`${fromDate}T00:00:00Z`) : new Date()
  return new Date(base.getTime() - days * 86_400_000).toISOString().slice(0, 10)
}

/** Lit le taux courant (le plus récent par `as_of`) de chaque devise vers USD. */
export async function getExchangeRates(admin: any): Promise<{ pivot: string; rates: RateMap }> {
  const { data } = await admin
    .from('exchange_rates')
    .select('base_currency, quote_currency, rate, as_of, source, provider, effective_date, fetched_at, is_manual_override')
    .eq('quote_currency', PIVOT_CURRENCY)
    .gte('effective_date', daysAgoIso(CURRENT_RATE_LOOKBACK_DAYS))
    .order('as_of', { ascending: false })

  const rates: RateMap = {}
  for (const row of data || []) {
    if (rates[row.base_currency]) continue // 1re ligne = plus récente (order desc)
    rates[row.base_currency] = {
      rate: Number(row.rate),
      as_of: row.as_of,
      source: row.source,
      provider: row.provider ?? row.source ?? null,
      effective_date: row.effective_date ?? null,
      fetched_at: row.fetched_at ?? row.as_of ?? null,
      is_manual_override: !!row.is_manual_override,
    }
  }
  return { pivot: PIVOT_CURRENCY, rates }
}

/**
 * Lignes brutes de taux HISTORIQUES sur [from, to] (bornes incluses,
 * YYYY-MM-DD), avec une marge de recherche avant `from` pour pouvoir
 * résoudre « dernier taux ≤ from » même si `from` lui-même n'a pas de
 * cotation (week-end/jour férié). UNE seule requête, quel que soit le
 * nombre de dates/transactions à résoudre ensuite — jamais un appel par
 * transaction (voir `buildHistoricalRateIndex` dans exchange.ts pour la
 * résolution en mémoire côté appelant).
 */
export async function getHistoricalRatesRaw(
  admin: any,
  opts: { from: string; to: string; currencies?: string[] },
): Promise<HistoricalRateRow[]> {
  const currencies = (opts.currencies ?? SUPPORTED_CURRENCY_CODES).filter((c) => c !== PIVOT_CURRENCY)
  if (currencies.length === 0) return []

  const bufferedFrom = daysAgoIso(HISTORICAL_LOOKBACK_DAYS, opts.from)
  const { data, error } = await admin
    .from('exchange_rates')
    .select('base_currency, effective_date, rate, provider, is_manual_override')
    .eq('quote_currency', PIVOT_CURRENCY)
    .in('base_currency', currencies)
    .gte('effective_date', bufferedFrom)
    .lte('effective_date', opts.to)
    .order('effective_date', { ascending: true })
  if (error) throw new Error(error.message)

  return (data || []).map((r: any) => ({
    currency: r.base_currency,
    effective_date: r.effective_date,
    rate: Number(r.rate),
    provider: r.provider,
    is_manual_override: !!r.is_manual_override,
  }))
}

/**
 * `RateMap` résolu pour UNE date précise (pratique pour un export ponctuel
 * ou une conversion isolée). Pour une SÉRIE de transactions sur plusieurs
 * dates, préférer charger `getHistoricalRatesRaw` une seule fois pour toute
 * la plage puis résoudre chaque transaction en mémoire via
 * `buildHistoricalRateIndex` — cette fonction referait sinon une requête
 * par date appelée.
 */
export async function getHistoricalRateMap(
  admin: any,
  date: string,
  currencies?: string[],
): Promise<{ pivot: string; rates: RateMap }> {
  const wanted = (currencies ?? SUPPORTED_CURRENCY_CODES).filter((c) => c !== PIVOT_CURRENCY)
  const rows = await getHistoricalRatesRaw(admin, { from: date, to: date, currencies: wanted })
  return { pivot: PIVOT_CURRENCY, rates: buildHistoricalRateMap(rows, date, wanted) }
}

/** Ré-exporté pour les appelants qui construisent déjà `getHistoricalRatesRaw`
 *  et veulent l'index en mémoire directement (évite un import croisé). */
export { buildHistoricalRateIndex }

/**
 * Récupère les taux auprès des fournisseurs et les enregistre.
 *   - respecte les overrides manuels (sautés sauf `force`)
 *   - priorité aux fournisseurs dans l'ordre de EXCHANGE_PROVIDERS
 *   - validation : rate fini, > 0, dans une plage plausible
 *   - jamais bloquant : renvoie {updated, skipped, missing, errors}
 */
export async function refreshExchangeRates(
  admin: any,
  opts?: { onlyCurrencies?: string[]; force?: boolean; timeoutMs?: number },
): Promise<{ updated: number; skipped: number; missing: string[]; errors: string[] }> {
  const timeoutMs = opts?.timeoutMs ?? 8000
  const targets = (opts?.onlyCurrencies ?? SUPPORTED_CURRENCY_CODES).filter((c) => c !== PIVOT_CURRENCY)

  const { rates: current } = await getExchangeRates(admin)
  const skipped = opts?.force ? [] : targets.filter((c) => current[c]?.is_manual_override)
  const skipSet = new Set(skipped)
  const toFetch = targets.filter((c) => !skipSet.has(c))
  if (toFetch.length === 0) return { updated: 0, skipped: skipped.length, missing: [], errors: [] }

  const collected: Record<string, { rate: number; provider: string; effective_date: string; fetched_at: string }> = {}
  const errors: string[] = []

  for (const provider of EXCHANGE_PROVIDERS) {
    const need = toFetch.filter((c) => !collected[c] && provider.supports(c))
    if (need.length === 0) continue
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), timeoutMs)
    try {
      const result = await provider.fetchRatesToUsd(need, ctrl.signal)
      for (const r of result.rates) {
        if (r.currency === PIVOT_CURRENCY || collected[r.currency]) continue
        if (!Number.isFinite(r.rate) || r.rate <= 0) continue
        if (r.rate < 1e-9 || r.rate > 1e7) continue // garde-fou de plausibilité
        collected[r.currency] = {
          rate: r.rate, provider: result.provider,
          effective_date: result.effective_date, fetched_at: result.fetched_at,
        }
      }
    } catch (err: any) {
      errors.push(`${provider.name}: ${err?.name === 'AbortError' ? 'timeout' : err?.message || 'échec'}`)
    } finally {
      clearTimeout(timer)
    }
  }

  const rows = Object.entries(collected).map(([currency, v]) => ({
    base_currency: currency,
    quote_currency: PIVOT_CURRENCY,
    rate: v.rate,
    as_of: v.fetched_at,
    source: v.provider,
    provider: v.provider,
    fetched_at: v.fetched_at,
    effective_date: v.effective_date,
    is_manual_override: false,
  }))

  const missing = toFetch.filter((c) => !collected[c])

  if (rows.length === 0) {
    return { updated: 0, skipped: skipped.length, missing, errors: errors.length ? errors : ['aucun taux récupéré'] }
  }

  // onConflict cible la contrainte (base_currency, quote_currency,
  // effective_date, provider) — migration 146. Avant cette migration, la
  // contrainte ne portait que sur `as_of` (timestamp exact, toujours
  // différent à chaque appel) : chaque rafraîchissement créait de
  // nouvelles lignes au lieu de mettre à jour celle du jour.
  // ignoreDuplicates: false (défaut) => DO UPDATE : un 2e rafraîchissement
  // le même jour met à jour le taux existant au lieu de le figer sur la
  // 1re valeur de la journée (les lignes avec override manuel actif sont
  // déjà exclues plus haut, donc ceci ne touche jamais un override).
  const { error } = await admin
    .from('exchange_rates')
    .upsert(rows, { onConflict: 'base_currency,quote_currency,effective_date,provider' })
  if (error) throw new Error(error.message)

  return { updated: rows.length, skipped: skipped.length, missing, errors }
}

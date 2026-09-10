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
import { PIVOT_CURRENCY, type RateMap } from './exchange'

/** Lit le taux courant (le plus récent par `as_of`) de chaque devise vers USD. */
export async function getExchangeRates(admin: any): Promise<{ pivot: string; rates: RateMap }> {
  const { data } = await admin
    .from('exchange_rates')
    .select('base_currency, quote_currency, rate, as_of, source, provider, effective_date, fetched_at, is_manual_override')
    .eq('quote_currency', PIVOT_CURRENCY)
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

  const { error } = await admin
    .from('exchange_rates')
    .upsert(rows, { onConflict: 'base_currency,quote_currency,as_of', ignoreDuplicates: true })
  if (error) throw new Error(error.message)

  return { updated: rows.length, skipped: skipped.length, missing, errors }
}

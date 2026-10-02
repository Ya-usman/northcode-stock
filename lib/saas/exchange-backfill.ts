// Backfill des taux de change HISTORIQUES — SERVEUR UNIQUEMENT.
//
// Un seul appel réseau (fetchHistoricalRangeToUsd) couvre toute la plage de
// dates demandée pour toutes les devises demandées — jamais un appel par
// jour ni par devise. L'écriture en base est batchée (chunks) pour rester
// robuste sur un gros volume et journaliser la progression.
//
// Idempotent : upsert sur (base_currency, quote_currency, effective_date,
// provider) — relancer le backfill sur une plage déjà couverte ne crée
// aucun doublon, met juste à jour la valeur si elle a changé côté
// fournisseur (ce qui n'arrive normalement jamais pour une date passée).
//
// Ne touche JAMAIS une ligne is_manual_override=true — un override pour une
// (devise, date) donnée garde la priorité, filtré AVANT l'upsert plutôt que
// de compter sur l'upsert pour ne pas l'écraser.

import type { ExchangeRateProvider } from './exchange-providers'
import { EXCHANGE_PROVIDERS } from './exchange-providers'
import { SUPPORTED_CURRENCY_CODES } from './currencies'
import { PIVOT_CURRENCY } from './exchange'

const CHUNK_SIZE = 500

export interface BackfillGap {
  currency: string
  reason: string
}

export interface BackfillResult {
  provider: string | null
  from: string
  to: string
  currencies: string[]
  pointsFetched: number
  rowsWritten: number
  rowsSkippedOverride: number
  datesCovered: number
  chunks: number
  gaps: BackfillGap[]
  errors: string[]
}

function pickHistoricalProvider(currencies: string[]): ExchangeRateProvider | null {
  return (
    EXCHANGE_PROVIDERS.find(
      (p) => typeof p.fetchHistoricalRangeToUsd === 'function' && currencies.some((c) => p.supportsHistorical?.(c)),
    ) ?? null
  )
}

/**
 * Backfill des taux historiques sur [from, to] (YYYY-MM-DD, inclusif) pour
 * les devises demandées (par défaut : toutes les devises supportées).
 */
export async function backfillHistoricalRates(
  admin: any,
  opts: { from: string; to: string; currencies?: string[] },
): Promise<BackfillResult> {
  const currencies = (opts.currencies ?? SUPPORTED_CURRENCY_CODES).filter((c) => c !== PIVOT_CURRENCY)
  const errors: string[] = []
  const base: BackfillResult = {
    provider: null, from: opts.from, to: opts.to, currencies,
    pointsFetched: 0, rowsWritten: 0, rowsSkippedOverride: 0, datesCovered: 0, chunks: 0,
    gaps: [], errors,
  }

  if (!opts.from || !opts.to || opts.from > opts.to) {
    errors.push(`plage invalide : from=${opts.from} to=${opts.to}`)
    return base
  }

  const provider = pickHistoricalProvider(currencies)
  if (!provider || !provider.fetchHistoricalRangeToUsd) {
    return {
      ...base,
      gaps: currencies.map((c) => ({ currency: c, reason: 'aucun fournisseur de la chaîne ne supporte fetchHistoricalRangeToUsd' })),
      errors: [...errors, 'aucun fournisseur historique disponible'],
    }
  }
  base.provider = provider.name

  const supported = currencies.filter((c) => provider.supportsHistorical?.(c) ?? true)
  const unsupported = currencies.filter((c) => !supported.includes(c))

  let fetched
  try {
    fetched = await provider.fetchHistoricalRangeToUsd(supported, opts.from, opts.to)
  } catch (err: any) {
    return { ...base, errors: [...errors, `${provider.name}: ${err?.message || 'échec réseau'}`] }
  }

  const points = fetched.points.filter(
    (p) => Number.isFinite(p.rate) && p.rate > 1e-9 && p.rate < 1e7 && p.effective_date >= opts.from && p.effective_date <= opts.to,
  )
  base.pointsFetched = points.length
  base.datesCovered = new Set(points.map((p) => p.effective_date)).size

  const currenciesCovered = new Set(points.map((p) => p.currency))
  base.gaps = [
    ...supported.filter((c) => !currenciesCovered.has(c)).map((c) => ({ currency: c, reason: `${provider.name} n'a renvoyé aucun point pour cette devise sur la plage` })),
    ...unsupported.map((c) => ({ currency: c, reason: `${provider.name} ne supporte pas l'historique pour cette devise` })),
  ]

  if (points.length === 0) {
    errors.push('aucun point exploitable récupéré')
    return base
  }

  // Ne jamais écraser un override manuel actif pour (devise, date).
  const { data: overrides, error: ovErr } = await admin
    .from('exchange_rates')
    .select('base_currency, effective_date')
    .eq('is_manual_override', true)
    .in('base_currency', supported)
  if (ovErr) errors.push(`lecture overrides : ${ovErr.message}`)
  const overrideKeys = new Set((overrides ?? []).map((o: any) => `${o.base_currency}|${o.effective_date}`))

  const rows = points
    .filter((p) => !overrideKeys.has(`${p.currency}|${p.effective_date}`))
    .map((p) => ({
      base_currency: p.currency,
      quote_currency: PIVOT_CURRENCY,
      rate: p.rate,
      // Aligné sur effective_date (midi UTC), PAS sur l'instant du backfill —
      // sinon un taux d'avril écrit aujourd'hui aurait un as_of "maintenant"
      // et pourrait passer, à tort, pour LE taux courant dans
      // getExchangeRates() (qui trie par as_of DESC).
      as_of: `${p.effective_date}T12:00:00.000Z`,
      source: fetched.provider,
      provider: fetched.provider,
      fetched_at: fetched.fetched_at,
      effective_date: p.effective_date,
      is_manual_override: false,
    }))
  base.rowsSkippedOverride = points.length - rows.length

  let written = 0
  for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
    const chunk = rows.slice(i, i + CHUNK_SIZE)
    const { error } = await admin
      .from('exchange_rates')
      .upsert(chunk, { onConflict: 'base_currency,quote_currency,effective_date,provider' })
    base.chunks++
    if (error) {
      errors.push(`chunk ${base.chunks} (${chunk.length} lignes) : ${error.message}`)
      continue
    }
    written += chunk.length
    console.log(`[exchange-backfill] chunk ${base.chunks}/${Math.ceil(rows.length / CHUNK_SIZE)} — ${written}/${rows.length} lignes écrites`)
  }
  base.rowsWritten = written

  return base
}

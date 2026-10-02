'use client'

import { useEffect, useState } from 'react'
import { withTimeout } from '@/lib/utils/with-timeout'
import { buildHistoricalRateIndex, type HistoricalRateIndex, type HistoricalRateRow } from '@/lib/saas/exchange'

/**
 * Taux HISTORIQUES pour une plage de dates — UN SEUL fetch par plage
 * (pas par transaction ni par date), consommé par tout composant qui doit
 * convertir des transactions passées avec le taux de LEUR propre date
 * (graphiques mensuels, comparaison N vs N-1 — voir
 * lib/saas/exchange.ts:convertChartSeriesHistorical / convertTransactionsAt).
 *
 * `from`/`to` doivent être des chaînes STABLES (calculées une fois, pas
 * `new Date()` à chaque rendu) pour éviter un refetch en boucle.
 */
export function useHistoricalExchangeRates(from: string | null, to: string | null, currencies?: string[]) {
  const [index, setIndex] = useState<HistoricalRateIndex | null>(null)
  const [rows, setRows] = useState<HistoricalRateRow[]>([])
  const [loading, setLoading] = useState(true)
  const currenciesKey = currencies?.join(',') ?? ''

  useEffect(() => {
    if (!from || !to) { setLoading(false); return }
    setLoading(true)
    const qs = new URLSearchParams({ from, to })
    if (currenciesKey) qs.set('currencies', currenciesKey)
    withTimeout(fetch(`/api/admin/exchange-rates/historical?${qs.toString()}`))
      .then(async (r) => {
        if (!r.ok) return
        const j = await r.json()
        const fetchedRows: HistoricalRateRow[] = j.rows || []
        setRows(fetchedRows)
        setIndex(buildHistoricalRateIndex(fetchedRows))
      })
      .catch(() => { /* le composant appelant doit gérer index === null (pas de conversion possible) */ })
      .finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to, currenciesKey])

  return { index, rows, loading }
}

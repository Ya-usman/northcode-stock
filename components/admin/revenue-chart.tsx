'use client'

import { useMemo } from 'react'
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { chartTickFormatter, formatCurrency } from '@/lib/utils/currency'
import { convertChartSeriesHistorical, type DatedAmount } from '@/lib/saas/exchange'
import { useReportingCurrencyContext } from '@/components/admin/reporting-currency-context'
import { useHistoricalExchangeRates } from '@/lib/hooks/use-historical-exchange-rates'

interface DataPoint {
  month: string
  /** Transactions individuelles, chacune avec SA propre date — jamais
   *  pré-additionnées ni pré-groupées par devise (voir admin-charts.ts). */
  transactions: DatedAmount[]
  count: number
}

const CustomTooltip = ({ active, payload, label, currency }: any) => {
  if (!active || !payload?.length) return null
  const point = payload[0]?.payload
  const revenue = point?.value || 0
  return (
    <div className="rounded-lg border border-border bg-card p-3 shadow-xl text-xs">
      <p className="font-semibold text-foreground mb-1">{label}</p>
      <p className="text-green-400">≈ {formatCurrency(revenue, currency)}</p>
      <p className="text-muted-foreground">{payload[1]?.value || 0} paiements</p>
      {point?.usedFallback && (
        <p className="text-amber-500 mt-1">↺ taux de repli utilisé pour au moins une transaction de ce mois</p>
      )}
      {point?.missingCurrencies?.length > 0 && (
        <p className="text-amber-500 mt-1">
          ⚠ Taux manquant pour {point.missingCurrencies.join(', ')} — exclu(e) de ce point
        </p>
      )}
    </div>
  )
}

/**
 * Revenu des 6 derniers mois — CONVERTI vers la devise de reporting
 * partagée (voir ReportingCurrencyProvider). Chaque transaction est
 * convertie avec le taux HISTORIQUE de SA propre date (pas le taux
 * d'aujourd'hui appliqué à tout le graphique) — un point de janvier et un
 * point d'août peuvent donc utiliser des taux différents. Un seul fetch
 * batché pour toute la plage (useHistoricalExchangeRates), jamais un appel
 * par transaction.
 */
export function RevenueChart({ data }: { data: DataPoint[] }) {
  const { currency } = useReportingCurrencyContext()

  const { from, to } = useMemo(() => {
    const now = new Date()
    const start = new Date(now.getFullYear(), now.getMonth() - 5, 1)
    return { from: start.toISOString().slice(0, 10), to: now.toISOString().slice(0, 10) }
  }, [])
  const { index, loading } = useHistoricalExchangeRates(from, to)

  const converted = useMemo(() => {
    if (!index) return data.map((p) => ({ ...p, value: 0, missingCurrencies: [] as string[], usedFallback: false }))
    const series = convertChartSeriesHistorical(data, currency, index)
    const withMissing = series.filter((p) => p.missingCurrencies.length > 0)
    if (withMissing.length > 0 && typeof window !== 'undefined') {
      // eslint-disable-next-line no-console
      console.warn(
        '[RevenueChart] taux historique manquant pour au moins une devise sur certains mois — montant exclu, jamais traité comme 0 silencieusement :',
        withMissing.map((p) => ({ month: p.month, missing: p.missingCurrencies })),
      )
    }
    return series
  }, [data, currency, index])

  const anyMissing = converted.some((p) => p.missingCurrencies.length > 0)
  const anyFallback = converted.some((p) => p.usedFallback)

  return (
    <div>
      <ResponsiveContainer width="100%" height={180}>
        <AreaChart data={converted} margin={{ top: 5, right: 5, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="adminRevenueGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#16a34a" stopOpacity={0.3} />
              <stop offset="95%" stopColor="#16a34a" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
          <XAxis dataKey="month" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} tickLine={false} axisLine={false} />
          <YAxis
            tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
            tickLine={false}
            axisLine={false}
            tickFormatter={v => chartTickFormatter(v, currency, false)}
            width={48}
          />
          <Tooltip content={<CustomTooltip currency={currency} />} />
          <Area
            type="monotone"
            dataKey="value"
            stroke="#16a34a"
            strokeWidth={2}
            fill="url(#adminRevenueGrad)"
            dot={{ fill: '#16a34a', r: 3 }}
            activeDot={{ r: 5 }}
          />
          <Area
            type="monotone"
            dataKey="count"
            stroke="#3b82f6"
            strokeWidth={1.5}
            fill="none"
            strokeDasharray="4 2"
            dot={false}
          />
        </AreaChart>
      </ResponsiveContainer>
      {loading && <p className="text-[11px] text-muted-foreground mt-1">Chargement des taux historiques…</p>}
      {anyFallback && !loading && (
        <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-1">
          ↺ Certains mois utilisent un taux de repli (dernier taux connu avant la date de la transaction).
        </p>
      )}
      {anyMissing && (
        <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-1">
          ⚠ Certains mois excluent une devise sans taux disponible — jamais comptée comme 0.
        </p>
      )}
    </div>
  )
}

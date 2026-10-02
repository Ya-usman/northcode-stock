'use client'

import { useMemo } from 'react'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { formatCurrency } from '@/lib/utils/currency'
import { convertChartSeriesHistorical, type DatedAmount } from '@/lib/saas/exchange'
import { useReportingCurrencyContext } from '@/components/admin/reporting-currency-context'
import { useHistoricalExchangeRates } from '@/lib/hooks/use-historical-exchange-rates'

interface DataPoint {
  month: string
  newShops: number
  newPayments: number
  /** Transactions individuelles, chacune avec SA propre date. */
  transactions: DatedAmount[]
}

const CustomTooltip = ({ active, payload, label, currency }: any) => {
  if (!active || !payload?.length) return null
  const point = payload[0]?.payload
  const revenue = point?.value || 0
  return (
    <div className="rounded-lg border border-border bg-card p-3 shadow-xl text-xs space-y-1">
      <p className="font-semibold text-foreground capitalize">{label}</p>
      <p className="text-purple-400">+{payload[0]?.value || 0} nouvelle(s) boutique(s)</p>
      <p className="text-blue-400">{payload[1]?.value || 0} paiement(s)</p>
      <p className="text-green-400">≈ {formatCurrency(revenue, currency)}</p>
      {point?.usedFallback && (
        <p className="text-amber-500">↺ taux de repli utilisé pour au moins une transaction de ce mois</p>
      )}
      {point?.missingCurrencies?.length > 0 && (
        <p className="text-amber-500">
          ⚠ Taux manquant pour {point.missingCurrencies.join(', ')} — exclu(e) de ce point
        </p>
      )}
    </div>
  )
}

/**
 * Croissance 12 mois — le revenu affiché dans l'infobulle est CONVERTI vers
 * la devise de reporting partagée, chaque transaction avec le taux
 * HISTORIQUE de SA propre date (voir RevenueChart pour le détail de la
 * politique — même mécanisme ici, fenêtre de 12 mois).
 */
export function GrowthChart({ data }: { data: DataPoint[] }) {
  const { currency } = useReportingCurrencyContext()

  const { from, to } = useMemo(() => {
    const now = new Date()
    const start = new Date(now.getFullYear(), now.getMonth() - 11, 1)
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
        '[GrowthChart] taux historique manquant pour au moins une devise sur certains mois — montant exclu, jamais traité comme 0 silencieusement :',
        withMissing.map((p) => ({ month: p.month, missing: p.missingCurrencies })),
      )
    }
    return series
  }, [data, currency, index])

  const anyMissing = converted.some((p) => p.missingCurrencies.length > 0)
  const anyFallback = converted.some((p) => p.usedFallback)

  return (
    <div>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={converted} margin={{ top: 5, right: 5, left: 0, bottom: 0 }} barGap={4}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
          <XAxis dataKey="month" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} tickLine={false} axisLine={false} />
          <YAxis tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} tickLine={false} axisLine={false} width={28} />
          <Tooltip content={<CustomTooltip currency={currency} />} />
          <Bar dataKey="newShops" name="Nouvelles boutiques" fill="#8b5cf6" radius={[3, 3, 0, 0]} maxBarSize={18} />
          <Bar dataKey="newPayments" name="Paiements" fill="#3b82f6" radius={[3, 3, 0, 0]} maxBarSize={18} />
        </BarChart>
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

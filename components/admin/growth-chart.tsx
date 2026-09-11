'use client'

import { useMemo } from 'react'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { formatCurrency } from '@/lib/utils/currency'
import { convertChartSeries } from '@/lib/saas/exchange'
import { useReportingCurrencyContext } from '@/components/admin/reporting-currency-context'

interface DataPoint {
  month: string
  newShops: number
  newPayments: number
  /** Montants PAR DEVISE d'origine — jamais pré-additionnés entre devises. */
  byCurrency: Record<string, number>
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
 * la devise de reporting partagée (ReportingCurrencyProvider), même règle
 * que les KPI consolidés : chaque devise convertie individuellement puis
 * additionnée.
 */
export function GrowthChart({ data }: { data: DataPoint[] }) {
  const { currency, rates } = useReportingCurrencyContext()

  const converted = useMemo(() => {
    const series = convertChartSeries(data, currency, rates)
    const withMissing = series.filter((p) => p.missingCurrencies.length > 0)
    if (withMissing.length > 0 && typeof window !== 'undefined') {
      // eslint-disable-next-line no-console
      console.warn(
        '[GrowthChart] taux manquant pour au moins une devise sur certains mois — montant exclu, jamais traité comme 0 silencieusement :',
        withMissing.map((p) => ({ month: p.month, missing: p.missingCurrencies })),
      )
    }
    return series
  }, [data, currency, rates])

  const anyMissing = converted.some((p) => p.missingCurrencies.length > 0)

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
      {anyMissing && (
        <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-1">
          ⚠ Certains mois excluent une devise sans taux disponible — jamais comptée comme 0.
        </p>
      )}
    </div>
  )
}

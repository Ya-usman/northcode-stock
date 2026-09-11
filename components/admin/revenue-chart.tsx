'use client'

import { useMemo } from 'react'
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { chartTickFormatter, formatCurrency } from '@/lib/utils/currency'
import { convertChartSeries } from '@/lib/saas/exchange'
import { useReportingCurrencyContext } from '@/components/admin/reporting-currency-context'

interface DataPoint {
  month: string
  /** Montants PAR DEVISE d'origine — jamais pré-additionnés entre devises. */
  byCurrency: Record<string, number>
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
 * partagée (voir ReportingCurrencyProvider), même logique que les KPI
 * consolidés (ConsolidatedMoneyTile) : chaque devise d'origine est
 * convertie individuellement puis additionnée, jamais l'inverse.
 */
export function RevenueChart({ data }: { data: DataPoint[] }) {
  const { currency, rates } = useReportingCurrencyContext()

  const converted = useMemo(() => {
    const series = convertChartSeries(data, currency, rates)
    const withMissing = series.filter((p) => p.missingCurrencies.length > 0)
    if (withMissing.length > 0 && typeof window !== 'undefined') {
      // eslint-disable-next-line no-console
      console.warn(
        '[RevenueChart] taux manquant pour au moins une devise sur certains mois — montant exclu, jamais traité comme 0 silencieusement :',
        withMissing.map((p) => ({ month: p.month, missing: p.missingCurrencies })),
      )
    }
    return series
  }, [data, currency, rates])

  const anyMissing = converted.some((p) => p.missingCurrencies.length > 0)

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
      {anyMissing && (
        <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-1">
          ⚠ Certains mois excluent une devise sans taux disponible — jamais comptée comme 0.
        </p>
      )}
    </div>
  )
}

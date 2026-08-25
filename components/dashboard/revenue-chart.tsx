'use client'

import { useState } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import {
  XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Area, AreaChart,
} from 'recharts'
import { Loader2 } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils/cn'
import { useCurrency } from '@/lib/hooks/use-currency'
import { chartTickFormatter } from '@/lib/utils/currency'
import { withTimeout } from '@/lib/utils/with-timeout'
import type { RevenueDataPoint } from '@/lib/types/database'

type Period = 'week' | 'month' | 'year'

interface RevenueChartProps {
  data: RevenueDataPoint[]
  shopIds: string[]
  cashierId?: string
}

export function RevenueChart({ data, shopIds, cashierId }: RevenueChartProps) {
  const t = useTranslations('dashboard')
  const locale = useLocale()
  const { fmt, symbol } = useCurrency()
  const isFCFA = symbol.includes('CFA')

  const [period, setPeriod] = useState<Period>('week')
  const [monthData, setMonthData] = useState<RevenueDataPoint[] | null>(null)
  const [yearData, setYearData] = useState<RevenueDataPoint[] | null>(null)
  const [periodLoading, setPeriodLoading] = useState(false)
  const [periodError, setPeriodError] = useState(false)

  const selectPeriod = async (next: Period) => {
    setPeriod(next)
    if (next === 'week') return
    const [cache, setCache] = next === 'month' ? [monthData, setMonthData] : [yearData, setYearData]
    if (cache || periodLoading) return
    setPeriodLoading(true)
    setPeriodError(false)
    try {
      const params = new URLSearchParams({ shop_ids: shopIds.join(',') })
      if (cashierId) params.set('cashier_id', cashierId)
      const endpoint = next === 'month' ? 'revenue-monthly' : 'revenue-yearly'
      const res = await withTimeout(fetch(`/api/dashboard/${endpoint}?${params}`))
      if (!res.ok) throw new Error('fetch failed')
      const json = await res.json()
      setCache(json.data)
    } catch {
      setPeriodError(true)
    } finally {
      setPeriodLoading(false)
    }
  }

  const chartData = period === 'week' ? data : period === 'month' ? (monthData ?? []) : (yearData ?? [])

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null
    const point = payload[0]?.payload
    const salesCount = point?.sales || 0
    const repaymentsCount = point?.repayments || 0
    return (
      <div className="rounded-lg border bg-card p-3 shadow-lg text-sm">
        <p className="font-medium text-foreground mb-1">{label}</p>
        <p className="text-stockshop-blue dark:text-blue-400">{fmt(point?.revenue || 0)}</p>
        <p className="text-muted-foreground">{t('new_sales_count', { count: salesCount })}</p>
        {repaymentsCount > 0 && (
          <p className="text-muted-foreground">{t('repayments_count', { count: repaymentsCount })}</p>
        )}
        {repaymentsCount > 0 && (
          <p className="text-muted-foreground font-medium mt-1 pt-1 border-t">
            {t('total_transactions_count', { count: salesCount + repaymentsCount })}
          </p>
        )}
      </div>
    )
  }

  const tickFormatter = (v: number) => chartTickFormatter(v, symbol, isFCFA, locale)

  return (
    <Card className="border-0 shadow-sm">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            {t('revenue_chart')}
            {isFCFA && (
              <span className="text-[10px] font-normal text-muted-foreground bg-muted rounded px-1.5 py-0.5">
                F CFA
              </span>
            )}
          </CardTitle>
          <div className="flex items-center gap-0.5 p-0.5 bg-muted rounded-lg flex-shrink-0">
            {(['week', 'month', 'year'] as const).map(p => (
              <button
                key={p}
                type="button"
                onClick={() => selectPeriod(p)}
                className={cn(
                  'px-2 py-1 rounded-md text-[11px] font-medium transition-colors',
                  period === p
                    ? 'bg-card text-foreground shadow-sm border border-border'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {t(`period_${p}`)}
              </button>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent className="pb-2">
        {period !== 'week' && periodLoading ? (
          <div className="flex items-center justify-center" style={{ height: 180 }}>
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : period !== 'week' && periodError ? (
          <div className="flex items-center justify-center text-xs text-muted-foreground" style={{ height: 180 }}>
            {t('period_load_error')}
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={180}>
            <AreaChart data={chartData} margin={{ top: 5, right: 5, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="revenueGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#60a5fa" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#60a5fa" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 10, fill: '#9ca3af' }}
                tickLine={false}
                axisLine={false}
                interval={chartData.length > 15 ? 'preserveStartEnd' : 0}
              />
              <YAxis tick={{ fontSize: 10, fill: '#9ca3af' }} tickLine={false} axisLine={false} tickFormatter={tickFormatter} width={44} />
              <Tooltip content={<CustomTooltip />} />
              <Area type="monotone" dataKey="revenue" stroke="#60a5fa" strokeWidth={2.5} fill="url(#revenueGrad)" dot={{ fill: '#60a5fa', r: 3 }} activeDot={{ r: 5, fill: '#3b82f6' }} />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  )
}

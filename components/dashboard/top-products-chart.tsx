'use client'

import { useState } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from 'recharts'
import { Loader2 } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils/cn'
import { useCurrency } from '@/lib/hooks/use-currency'
import { chartTickFormatter } from '@/lib/utils/currency'
import { withTimeout } from '@/lib/utils/with-timeout'
import type { TopProduct } from '@/lib/types/database'

type Period = 'week' | 'month' | 'year'

interface TopProductsChartProps {
  data: TopProduct[]
  shopIds: string[]
  cashierId?: string
}

const COLORS = ['#60a5fa', '#34d399', '#f59e0b', '#f87171', '#a78bfa']

export function TopProductsChart({ data, shopIds, cashierId }: TopProductsChartProps) {
  const t = useTranslations('dashboard')
  const locale = useLocale()
  const { fmt, symbol } = useCurrency()
  const isFCFA = symbol.includes('CFA')

  const [period, setPeriod] = useState<Period>('week')
  const [monthData, setMonthData] = useState<TopProduct[] | null>(null)
  const [yearData, setYearData] = useState<TopProduct[] | null>(null)
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
      const params = new URLSearchParams({ period: next, shop_ids: shopIds.join(',') })
      if (cashierId) params.set('cashier_id', cashierId)
      const res = await withTimeout(fetch(`/api/dashboard/top-products?${params}`))
      if (!res.ok) throw new Error('fetch failed')
      const json = await res.json()
      setCache(json.data)
    } catch {
      setPeriodError(true)
    } finally {
      setPeriodLoading(false)
    }
  }

  const activeData = period === 'week' ? data : period === 'month' ? (monthData ?? []) : (yearData ?? [])

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null
    return (
      <div className="rounded-lg border bg-card p-3 shadow-lg text-sm">
        <p className="font-medium mb-1 max-w-[140px] truncate">{label}</p>
        <p className="text-stockshop-blue dark:text-blue-400">{fmt(payload[0]?.value || 0)}</p>
        <p className="text-muted-foreground">{t('units_sold_count', { count: payload[0]?.payload?.quantity || 0 })}</p>
      </div>
    )
  }

  const tickFormatter = (v: number) => chartTickFormatter(v, symbol, isFCFA, locale)

  const chartData = activeData.map(p => ({
    name: p.name.length > 14 ? p.name.slice(0, 14) + '…' : p.name,
    revenue: p.revenue,
    quantity: p.quantity,
  }))

  return (
    <Card className="border-0 shadow-sm">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            {t('top_products')}
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
        ) : activeData.length === 0 ? (
          <div className="flex h-[180px] items-center justify-center text-sm text-muted-foreground">
            {t('no_sales_today')}
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={chartData} margin={{ top: 5, right: 5, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="name" tick={{ fontSize: 9, fill: '#9ca3af' }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 10, fill: '#9ca3af' }} tickLine={false} axisLine={false} tickFormatter={tickFormatter} width={46} />
              <Tooltip content={<CustomTooltip />} />
              <Bar dataKey="revenue" radius={[3, 3, 0, 0]} maxBarSize={40}>
                {chartData.map((_, index) => (
                  <Cell key={index} fill={COLORS[index % COLORS.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  )
}

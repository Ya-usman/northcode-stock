'use client'

import { useState, useEffect } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer,
} from 'recharts'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { createClient } from '@/lib/supabase/client'
import { useAuthContext as useAuth } from '@/lib/contexts/auth-context'
import { useCurrency } from '@/lib/hooks/use-currency'
import { format, subMonths, startOfMonth, endOfMonth } from 'date-fns'
import { cn } from '@/lib/utils/cn'

const supabase = createClient() as any

interface MonthData {
  month: string
  revenue: number
  expenses: number
}

export function ExpenseRevenueChart() {
  const t = useTranslations('dashboard')
  const locale = useLocale()
  const { effectiveShopIds } = useAuth()
  const { fmt, symbol } = useCurrency()
  const isFCFA = symbol.includes('CFA')

  const [data, setData] = useState<MonthData[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!effectiveShopIds.length) return

    const fetchTrend = async () => {
      const today = new Date()
      const sixMonthsAgo = startOfMonth(subMonths(today, 5))
      const startStr = format(sixMonthsAgo, 'yyyy-MM-dd')
      const endStr   = format(endOfMonth(today), 'yyyy-MM-dd')

      const [{ data: expRaw }, { data: salesRaw }] = await Promise.all([
        supabase
          .from('expenses')
          .select('date, amount')
          .in('shop_id', effectiveShopIds)
          .eq('is_recurring', false)
          .gte('date', startStr)
          .lte('date', endStr),
        supabase
          .from('sales')
          .select('created_at, amount_paid')
          .in('shop_id', effectiveShopIds)
          .eq('sale_status', 'active')
          .gte('created_at', sixMonthsAgo.toISOString())
          .lte('created_at', endOfMonth(today).toISOString()),
      ])

      const months = Array.from({ length: 6 }, (_, i) => {
        const d = subMonths(today, 5 - i)
        return {
          key:   format(d, 'yyyy-MM'),
          label: d.toLocaleDateString(locale, { month: 'short' }),
        }
      })

      const revByMonth: Record<string, number> = {}
      const expByMonth: Record<string, number> = {}
      months.forEach(m => { revByMonth[m.key] = 0; expByMonth[m.key] = 0 })

      ;(salesRaw || []).forEach((s: any) => {
        const key = (s.created_at as string).slice(0, 7)
        if (revByMonth[key] !== undefined) revByMonth[key] += Number(s.amount_paid)
      })

      ;(expRaw || []).forEach((e: any) => {
        const key = (e.date as string).slice(0, 7)
        if (expByMonth[key] !== undefined) expByMonth[key] += Number(e.amount)
      })

      setData(months.map(m => ({
        month:    m.label,
        revenue:  revByMonth[m.key],
        expenses: expByMonth[m.key],
      })))
      setLoading(false)
    }

    fetchTrend()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveShopIds.join(','), locale])

  const tickFormatter = (v: number) => {
    if (v === 0) return '0'
    const k = (v / 1000).toFixed(0)
    return isFCFA ? `${k}K` : `${symbol}${k}K`
  }

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null
    const rev = payload.find((p: any) => p.dataKey === 'revenue')?.value ?? 0
    const exp = payload.find((p: any) => p.dataKey === 'expenses')?.value ?? 0
    const net = rev - exp
    return (
      <div className="rounded-xl border bg-card p-3 shadow-lg text-sm min-w-[160px]">
        <p className="font-semibold text-foreground mb-2">{label}</p>
        <p className="text-blue-500">{t('revenue_label')}: <span className="font-medium">{fmt(rev)}</span></p>
        <p className="text-red-400">{t('expenses_label')}: <span className="font-medium">{fmt(exp)}</span></p>
        <div className="mt-2 pt-2 border-t">
          <p className={cn('text-xs font-bold', net >= 0 ? 'text-green-600' : 'text-red-600')}>
            Net: {net >= 0 ? '+' : ''}{fmt(net)}
          </p>
        </div>
      </div>
    )
  }

  if (loading) {
    return (
      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold">{t('monthly_trend')}</CardTitle>
        </CardHeader>
        <CardContent className="pb-2">
          <div className="h-[180px] bg-muted/40 rounded-lg animate-pulse" />
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="border-0 shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          {t('monthly_trend')}
          {isFCFA && (
            <span className="text-[10px] font-normal text-muted-foreground bg-muted rounded px-1.5 py-0.5">
              F CFA
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="pb-2">
        <ResponsiveContainer width="100%" height={180}>
          <BarChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis
              dataKey="month"
              tick={{ fontSize: 10, fill: '#9ca3af' }}
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              tick={{ fontSize: 10, fill: '#9ca3af' }}
              tickLine={false}
              axisLine={false}
              tickFormatter={tickFormatter}
              width={44}
            />
            <Tooltip content={<CustomTooltip />} />
            <Legend
              iconSize={8}
              iconType="circle"
              wrapperStyle={{ fontSize: '10px', paddingTop: '8px' }}
              formatter={(value) =>
                value === 'revenue' ? t('revenue_label') : t('expenses_label')
              }
            />
            <Bar dataKey="revenue"  fill="#60a5fa" radius={[3, 3, 0, 0]} maxBarSize={22} />
            <Bar dataKey="expenses" fill="#f87171" radius={[3, 3, 0, 0]} maxBarSize={22} />
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  )
}

'use client'

import { useTranslations } from 'next-intl'
import {
  XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Area, AreaChart,
} from 'recharts'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useCurrency } from '@/lib/hooks/use-currency'
import type { RevenueDataPoint } from '@/lib/types/database'

interface RevenueChartProps {
  data: RevenueDataPoint[]
}

export function RevenueChart({ data }: RevenueChartProps) {
  const t = useTranslations('dashboard')
  const { fmt, symbol } = useCurrency()

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null
    return (
      <div className="rounded-lg border bg-card p-3 shadow-lg text-sm">
        <p className="font-medium text-foreground mb-1">{label}</p>
        <p className="text-northcode-blue dark:text-blue-400">{fmt(payload[0]?.value || 0)}</p>
        <p className="text-muted-foreground">{payload[1]?.value || 0} sales</p>
      </div>
    )
  }

  const tickFormatter = (v: number) =>
    symbol === 'FCFA'
      ? `${(v / 1000).toFixed(0)}K`
      : `₦${(v / 1000).toFixed(0)}k`

  return (
    <Card className="border-0 shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold">{t('revenue_chart')}</CardTitle>
      </CardHeader>
      <CardContent className="pb-2">
        <ResponsiveContainer width="100%" height={180}>
          <AreaChart data={data} margin={{ top: 5, right: 5, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="revenueGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#60a5fa" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#60a5fa" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#9ca3af' }} tickLine={false} axisLine={false} />
            <YAxis tick={{ fontSize: 10, fill: '#9ca3af' }} tickLine={false} axisLine={false} tickFormatter={tickFormatter} width={46} />
            <Tooltip content={<CustomTooltip />} />
            <Area type="monotone" dataKey="revenue" stroke="#60a5fa" strokeWidth={2.5} fill="url(#revenueGrad)" dot={{ fill: '#60a5fa', r: 3 }} activeDot={{ r: 5, fill: '#3b82f6' }} />
          </AreaChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  )
}

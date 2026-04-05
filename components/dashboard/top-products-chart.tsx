'use client'

import { useTranslations } from 'next-intl'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from 'recharts'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useCurrency } from '@/lib/hooks/use-currency'
import type { TopProduct } from '@/lib/types/database'

interface TopProductsChartProps {
  data: TopProduct[]
}

const COLORS = ['#0A2F6E', '#1A4F9E', '#2D6CC7', '#4B8FE0', '#7BB3F0']

export function TopProductsChart({ data }: TopProductsChartProps) {
  const t = useTranslations('dashboard')
  const { fmt, symbol } = useCurrency()

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null
    return (
      <div className="rounded-lg border bg-white p-3 shadow-lg text-sm">
        <p className="font-medium mb-1 max-w-[140px] truncate">{label}</p>
        <p className="text-northcode-blue">{fmt(payload[0]?.value || 0)}</p>
        <p className="text-muted-foreground">{payload[0]?.payload?.quantity || 0} units sold</p>
      </div>
    )
  }

  const tickFormatter = (v: number) =>
    symbol === 'FCFA'
      ? `${(v / 1000).toFixed(0)}K`
      : `₦${(v / 1000).toFixed(0)}k`

  const chartData = data.map(p => ({
    name: p.name.length > 14 ? p.name.slice(0, 14) + '…' : p.name,
    revenue: p.revenue,
    quantity: p.quantity,
  }))

  return (
    <Card className="border-0 shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold">{t('top_products')}</CardTitle>
      </CardHeader>
      <CardContent className="pb-2">
        {data.length === 0 ? (
          <div className="flex h-[180px] items-center justify-center text-sm text-muted-foreground">
            {t('no_sales_today')}
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={chartData} margin={{ top: 5, right: 5, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
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

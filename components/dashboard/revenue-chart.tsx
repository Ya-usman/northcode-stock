'use client'

import { useTranslations } from 'next-intl'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Area, AreaChart,
} from 'recharts'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { formatNaira } from '@/lib/utils/currency'
import type { RevenueDataPoint } from '@/lib/types/database'

interface RevenueChartProps {
  data: RevenueDataPoint[]
}

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-lg border bg-white p-3 shadow-lg text-sm">
      <p className="font-medium text-foreground mb-1">{label}</p>
      <p className="text-northcode-blue">{formatNaira(payload[0]?.value || 0)}</p>
      <p className="text-muted-foreground">{payload[1]?.value || 0} sales</p>
    </div>
  )
}

export function RevenueChart({ data }: RevenueChartProps) {
  const t = useTranslations('dashboard')

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
                <stop offset="5%" stopColor="#0A2F6E" stopOpacity={0.15} />
                <stop offset="95%" stopColor="#0A2F6E" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 10, fill: '#9ca3af' }}
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              tick={{ fontSize: 10, fill: '#9ca3af' }}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v) => `₦${(v / 1000).toFixed(0)}k`}
              width={42}
            />
            <Tooltip content={<CustomTooltip />} />
            <Area
              type="monotone"
              dataKey="revenue"
              stroke="#0A2F6E"
              strokeWidth={2}
              fill="url(#revenueGrad)"
              dot={{ fill: '#0A2F6E', r: 3 }}
              activeDot={{ r: 5 }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  )
}

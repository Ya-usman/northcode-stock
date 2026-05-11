'use client'

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'

interface DataPoint {
  month: string
  newShops: number
  newPayments: number
  revenue: number
}

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null
  const revenue = payload[2]?.value || 0
  const formatted = revenue >= 1_000_000
    ? `${(revenue / 1_000_000).toFixed(1)}M`
    : revenue >= 1_000
    ? `${(revenue / 1_000).toFixed(1)}K`
    : revenue.toLocaleString()
  return (
    <div className="rounded-lg border border-border bg-card p-3 shadow-xl text-xs space-y-1">
      <p className="font-semibold text-foreground capitalize">{label}</p>
      <p className="text-purple-400">+{payload[0]?.value || 0} nouvelle(s) boutique(s)</p>
      <p className="text-blue-400">{payload[1]?.value || 0} paiement(s)</p>
      <p className="text-green-400">{formatted} (devises locales)</p>
    </div>
  )
}

export function GrowthChart({ data }: { data: DataPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} margin={{ top: 5, right: 5, left: 0, bottom: 0 }} barGap={4}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
        <XAxis dataKey="month" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} tickLine={false} axisLine={false} />
        <YAxis tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} tickLine={false} axisLine={false} width={28} />
        <Tooltip content={<CustomTooltip />} />
        <Bar dataKey="newShops" name="Nouvelles boutiques" fill="#8b5cf6" radius={[3, 3, 0, 0]} maxBarSize={18} />
        <Bar dataKey="newPayments" name="Paiements" fill="#3b82f6" radius={[3, 3, 0, 0]} maxBarSize={18} />
      </BarChart>
    </ResponsiveContainer>
  )
}

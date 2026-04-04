'use client'

import { motion } from 'framer-motion'
import { TrendingUp, ShoppingCart, AlertTriangle, CreditCard } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { formatNaira, formatNairaCompact } from '@/lib/utils/currency'
import { useTranslations } from 'next-intl'

interface MetricCardsProps {
  todayRevenue: number
  todaySalesCount: number
  lowStockCount: number
  outstandingDebt: number
  role: string
}

const container = {
  hidden: {},
  show: { transition: { staggerChildren: 0.08 } },
}
const item = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0 },
}

export function MetricCards({ todayRevenue, todaySalesCount, lowStockCount, outstandingDebt, role }: MetricCardsProps) {
  const t = useTranslations('dashboard')

  const cards = [
    {
      title: t('today_revenue'),
      value: role === 'viewer' ? '—' : formatNairaCompact(todayRevenue),
      subValue: role !== 'viewer' ? formatNaira(todayRevenue) : undefined,
      icon: TrendingUp,
      color: 'text-green-600',
      bg: 'bg-green-50',
      show: true,
    },
    {
      title: t('sales_count'),
      value: todaySalesCount.toString(),
      subValue: `${todaySalesCount === 1 ? 'transaction' : 'transactions'} today`,
      icon: ShoppingCart,
      color: 'text-northcode-blue',
      bg: 'bg-northcode-blue-muted',
      show: true,
    },
    {
      title: t('stock_alerts'),
      value: lowStockCount.toString(),
      subValue: lowStockCount === 0 ? 'All stocked' : `item${lowStockCount !== 1 ? 's' : ''} low`,
      icon: AlertTriangle,
      color: lowStockCount > 0 ? 'text-amber-600' : 'text-green-600',
      bg: lowStockCount > 0 ? 'bg-amber-50' : 'bg-green-50',
      show: true,
    },
    {
      title: t('outstanding_debt'),
      value: role === 'viewer' ? '—' : formatNairaCompact(outstandingDebt),
      subValue: role !== 'viewer' ? formatNaira(outstandingDebt) : undefined,
      icon: CreditCard,
      color: outstandingDebt > 0 ? 'text-red-600' : 'text-green-600',
      bg: outstandingDebt > 0 ? 'bg-red-50' : 'bg-green-50',
      show: role !== 'viewer',
    },
  ].filter(c => c.show)

  return (
    <motion.div
      variants={container}
      initial="hidden"
      animate="show"
      className="grid grid-cols-2 gap-3 sm:grid-cols-4"
    >
      {cards.map((card) => {
        const Icon = card.icon
        return (
          <motion.div key={card.title} variants={item}>
            <Card className="border-0 shadow-sm overflow-hidden">
              <CardContent className="p-4">
                <div className="flex items-start justify-between">
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-muted-foreground truncate mb-1">
                      {card.title}
                    </p>
                    <p className="text-xl font-bold text-foreground leading-none mb-0.5">
                      {card.value}
                    </p>
                    {card.subValue && (
                      <p className="text-[10px] text-muted-foreground truncate">{card.subValue}</p>
                    )}
                  </div>
                  <div className={`flex-shrink-0 rounded-lg p-2 ${card.bg}`}>
                    <Icon className={`h-4 w-4 ${card.color}`} />
                  </div>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        )
      })}
    </motion.div>
  )
}

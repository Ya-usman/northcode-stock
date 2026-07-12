'use client'

import { motion } from 'framer-motion'
import { TrendingUp, ShoppingCart, AlertTriangle, CreditCard, Receipt, CalendarDays, BarChart2 } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { useTranslations, useLocale } from 'next-intl'
import { useCurrency } from '@/lib/hooks/use-currency'
import { useRolePermissions } from '@/lib/hooks/use-role-permissions'

interface MetricCardsProps {
  todayRevenue: number
  todaySalesCount: number
  lowStockCount: number
  outstandingDebt: number
  monthExpenses?: number
  monthRevenue?: number
  monthGlobalRevenue?: number
  role: string
  isCashier?: boolean
  canRevenueChart?: boolean
  canSeeExpenses?: boolean
  isLoading?: boolean
}

const container = {
  hidden: {},
  show: { transition: { staggerChildren: 0.08 } },
}
const item = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0 },
}

export function MetricCards({ todayRevenue, todaySalesCount, lowStockCount, outstandingDebt, monthExpenses = 0, monthRevenue = 0, monthGlobalRevenue = 0, role, isCashier, canRevenueChart = false, canSeeExpenses = false, isLoading = false }: MetricCardsProps) {
  const t = useTranslations('dashboard')
  const locale = useLocale()
  const { fmt, symbol } = useCurrency()
  const { canAccess } = useRolePermissions()
  const compact = (n: number) => {
    const isPrefix = symbol.length <= 2
    const sfx = isPrefix ? '' : ` ${symbol}`
    const pfx = isPrefix ? symbol : ''
    const loc = (v: number) => v.toLocaleString(locale, { maximumFractionDigits: 1, minimumFractionDigits: 0 })
    if (n >= 1_000_000_000) return `${pfx}${loc(n / 1_000_000_000)}Md${sfx}`
    if (n >= 1_000_000)     return `${pfx}${loc(n / 1_000_000)}M${sfx}`
    if (n >= 1_000)         return `${pfx}${loc(n / 1_000)}k${sfx}`
    return fmt(n)
  }

  const cards = [
    {
      title: isCashier ? t('my_sales_today') : t('today_revenue'),
      value: role === 'viewer' ? '—' : compact(todayRevenue),
      subValue: role !== 'viewer' ? fmt(todayRevenue) : undefined,
      label: role !== 'viewer' ? t('cash_received_label') : undefined,
      icon: TrendingUp,
      color: 'text-green-600',
      bg: 'bg-green-50',
      show: canAccess('widget_today_revenue'),
    },
    {
      title: t('sales_count'),
      value: todaySalesCount.toString(),
      subValue: t('transactions_today', { count: todaySalesCount }),
      icon: ShoppingCart,
      color: 'text-stockshop-blue dark:text-blue-400',
      bg: 'bg-blue-50 dark:bg-blue-950/40',
      show: canAccess('widget_sales_count'),
    },
    {
      title: t('stock_alerts'),
      value: lowStockCount.toString(),
      subValue: lowStockCount === 0 ? t('all_stocked') : t('items_low', { count: lowStockCount }),
      icon: AlertTriangle,
      color: lowStockCount > 0 ? 'text-amber-600' : 'text-green-600',
      bg: lowStockCount > 0 ? 'bg-amber-50' : 'bg-green-50',
      show: canAccess('widget_stock_alerts_card'),
    },
    {
      title: t('outstanding_debt'),
      value: role === 'viewer' ? '—' : compact(outstandingDebt),
      subValue: role !== 'viewer' ? fmt(outstandingDebt) : undefined,
      icon: CreditCard,
      color: outstandingDebt > 0 ? 'text-red-600' : 'text-green-600',
      bg: outstandingDebt > 0 ? 'bg-red-50' : 'bg-green-50',
      show: canAccess('widget_outstanding_debt'),
    },
    {
      title: t('month_expenses'),
      value: compact(monthExpenses),
      subValue: fmt(monthExpenses),
      icon: Receipt,
      color: monthExpenses > 0 ? 'text-red-500' : 'text-muted-foreground',
      bg: monthExpenses > 0 ? 'bg-red-50 dark:bg-red-950/30' : 'bg-muted',
      show: canSeeExpenses,
    },
    {
      title: t('net_result'),
      value: role === 'viewer' ? '—' : compact(monthRevenue),
      subValue: role !== 'viewer' ? fmt(monthRevenue) : undefined,
      icon: CalendarDays,
      color: 'text-violet-600 dark:text-violet-400',
      bg: 'bg-violet-50 dark:bg-violet-950/30',
      show: canAccess('widget_net_result'),
    },
    {
      title: t('global_month_sales'),
      value: compact(monthGlobalRevenue),
      subValue: fmt(monthGlobalRevenue),
      icon: BarChart2,
      color: 'text-sky-600 dark:text-sky-400',
      bg: 'bg-sky-50 dark:bg-sky-950/30',
      show: canRevenueChart,
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
                      {isLoading
                        ? <span className="inline-block h-6 w-20 rounded-md bg-muted animate-pulse" />
                        : card.value}
                    </p>
                    {isLoading
                      ? <span className="inline-block h-3 w-14 rounded bg-muted animate-pulse mt-0.5" />
                      : card.subValue && <p className="text-[10px] text-muted-foreground truncate">{card.subValue}</p>}
                    {(card as any).label && (
                      <p className="text-[10px] text-muted-foreground truncate">{(card as any).label}</p>
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

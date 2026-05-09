'use client'

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useTranslations, useLocale } from 'next-intl'
import { useCurrency } from '@/lib/hooks/use-currency'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils/cn'
import type { Sale } from '@/lib/types/database'

export interface RepaymentFeedItem {
  type: 'repayment'
  id: string
  amount: number
  paid_at: string
  method: string
  customerName: string
  totalDebt?: number
  remainingBalance?: number
}

export type FeedItem = (Sale & { type: 'sale' }) | RepaymentFeedItem

interface RecentSalesFeedProps {
  items: FeedItem[]
  role: string
}

const statusVariant: Record<string, 'success' | 'warning' | 'danger'> = {
  paid: 'success',
  partial: 'warning',
  pending: 'danger',
}

export function RecentSalesFeed({ items, role }: RecentSalesFeedProps) {
  const t = useTranslations()
  const locale = useLocale()
  const { fmt: formatNaira } = useCurrency()
  const [activeTab, setActiveTab] = useState<'sales' | 'repayments'>('sales')

  const salesItems = items.filter(i => i.type === 'sale' && Number((i as Sale).balance) === 0) as (Sale & { type: 'sale' })[]
  const debtItems = items.filter(i => i.type === 'repayment' || (i.type === 'sale' && Number((i as Sale).balance) > 0))
  const displayItems = activeTab === 'sales' ? salesItems : debtItems

  return (
    <Card className="border-0 shadow-sm">
      <CardHeader className="pb-0 flex flex-row items-center justify-between">
        <CardTitle className="text-sm font-semibold">{t('dashboard.recent_sales')}</CardTitle>
        <span className="flex items-center gap-1">
          <span className="h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse" />
          <span className="text-[10px] font-medium text-green-600">{t('dashboard.live_badge')}</span>
        </span>
      </CardHeader>

      {/* Tabs */}
      <div className="flex border-b mx-4 mt-3">
        <button
          onClick={() => setActiveTab('sales')}
          className={cn(
            'relative pb-2 px-1 mr-4 text-xs font-medium transition-colors',
            activeTab === 'sales'
              ? 'text-northcode-blue dark:text-blue-400'
              : 'text-muted-foreground hover:text-foreground'
          )}
        >
          {t('sales.sales_tab')}
          {salesItems.length > 0 && (
            <span className={cn(
              'ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-medium',
              activeTab === 'sales'
                ? 'bg-northcode-blue/10 text-northcode-blue dark:bg-blue-500/20 dark:text-blue-400'
                : 'bg-muted text-muted-foreground'
            )}>
              {salesItems.length}
            </span>
          )}
          {activeTab === 'sales' && (
            <span className="absolute bottom-0 left-0 right-0 h-0.5 rounded-full bg-northcode-blue dark:bg-blue-400" />
          )}
        </button>

        <button
          onClick={() => setActiveTab('repayments')}
          className={cn(
            'relative pb-2 px-1 text-xs font-medium transition-colors',
            activeTab === 'repayments'
              ? 'text-northcode-blue dark:text-blue-400'
              : 'text-muted-foreground hover:text-foreground'
          )}
        >
          {t('sales.debts_tab')}
          {debtItems.length > 0 && (
            <span className={cn(
              'ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-medium',
              activeTab === 'repayments'
                ? 'bg-northcode-blue/10 text-northcode-blue dark:bg-blue-500/20 dark:text-blue-400'
                : 'bg-muted text-muted-foreground'
            )}>
              {debtItems.length}
            </span>
          )}
          {activeTab === 'repayments' && (
            <span className="absolute bottom-0 left-0 right-0 h-0.5 rounded-full bg-northcode-blue dark:bg-blue-400" />
          )}
        </button>
      </div>

      <CardContent className="p-0">
        {displayItems.length === 0 ? (
          <div className="flex h-24 items-center justify-center text-sm text-muted-foreground px-4">
            {activeTab === 'sales' ? t('dashboard.no_sales_today') : t('sales.no_repayments')}
          </div>
        ) : (
          <div className="divide-y">
            <AnimatePresence initial={false}>
              {displayItems.slice(0, 12).map((item, idx) => {
                if (item.type === 'repayment') {
                  const isPartial = item.remainingBalance !== undefined && item.remainingBalance > 0
                  const isFullyPaid = item.totalDebt !== undefined && !isPartial
                  return (
                    <motion.div
                      key={`r-${item.id}`}
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ duration: 0.3, delay: idx * 0.03 }}
                      className="px-4 py-3 hover:bg-muted/30 transition-colors"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 flex-wrap min-w-0 flex-1">
                          <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">
                            ↩ {t('sales.repayment')}
                          </span>
                          {isPartial && (
                            <Badge variant="warning" className="text-[10px] px-1.5 py-0">
                              {t('status.partial')}
                            </Badge>
                          )}
                          {isFullyPaid && (
                            <Badge variant="success" className="text-[10px] px-1.5 py-0">
                              {t('status.paid')}
                            </Badge>
                          )}
                          <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-emerald-300 text-emerald-600 dark:text-emerald-400">
                            {t(`payment.${item.method}` as any) || item.method}
                          </Badge>
                        </div>
                        {role !== 'viewer' && (
                          <p className="text-sm font-semibold text-emerald-600 dark:text-emerald-400 flex-shrink-0">+{formatNaira(item.amount)}</p>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5 truncate">
                        {item.customerName} ·{' '}
                        {new Date(item.paid_at).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}
                      </p>
                      {role !== 'viewer' && item.totalDebt !== undefined && (
                        <div className="flex gap-4 mt-1.5 flex-wrap">
                          <p className="text-[10px]">
                            <span className="text-muted-foreground">{t('payments.total_debt')} : </span>
                            <span className="font-semibold text-orange-500">{formatNaira(item.totalDebt)}</span>
                          </p>
                          {isPartial && (
                            <p className="text-[10px]">
                              <span className="text-muted-foreground">{t('payments.remaining_due')} : </span>
                              <span className="font-semibold text-red-500">{formatNaira(item.remainingBalance!)}</span>
                            </p>
                          )}
                        </div>
                      )}
                    </motion.div>
                  )
                }

                const hasDebt = Number(item.balance) > 0
                return (
                  <motion.div
                    key={item.id}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.3, delay: idx * 0.03 }}
                    className="px-4 py-3 hover:bg-muted/30 transition-colors"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 flex-wrap min-w-0 flex-1">
                        <span className="text-xs font-mono font-medium text-northcode-blue dark:text-blue-400">
                          #{item.sale_number}
                        </span>
                        <Badge variant={statusVariant[item.payment_status] || 'secondary'} className="text-[10px] px-1.5 py-0">
                          {t(`status.${item.payment_status}`)}
                        </Badge>
                        <span className="text-[10px] text-muted-foreground">
                          {t(`payment.${item.payment_method}` as any)}
                        </span>
                      </div>
                      {role !== 'viewer' && (
                        <p className="text-sm font-semibold flex-shrink-0 text-emerald-600 dark:text-emerald-400">
                          {hasDebt ? `+${formatNaira(item.amount_paid)}` : formatNaira(item.total)}
                        </p>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5 truncate">
                      {item.customers?.name || t('sales.walk_in')} ·{' '}
                      {new Date(item.created_at).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}
                    </p>
                    {role !== 'viewer' && hasDebt && (
                      <div className="flex gap-4 mt-1.5 flex-wrap">
                        <p className="text-[10px]">
                          <span className="text-muted-foreground">{t('payments.total_debt')} : </span>
                          <span className="font-semibold text-orange-500">{formatNaira(item.total)}</span>
                        </p>
                        <p className="text-[10px]">
                          <span className="text-muted-foreground">{t('payments.remaining_due')} : </span>
                          <span className="font-semibold text-red-500">{formatNaira(item.balance)}</span>
                        </p>
                      </div>
                    )}
                  </motion.div>
                )
              })}
            </AnimatePresence>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

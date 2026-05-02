'use client'

import { motion, AnimatePresence } from 'framer-motion'
import { useTranslations, useLocale } from 'next-intl'
import { useCurrency } from '@/lib/hooks/use-currency'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { Sale } from '@/lib/types/database'

export interface RepaymentFeedItem {
  type: 'repayment'
  id: string
  amount: number
  paid_at: string
  method: string
  customerName: string
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

  return (
    <Card className="border-0 shadow-sm">
      <CardHeader className="pb-2 flex flex-row items-center justify-between">
        <CardTitle className="text-sm font-semibold">{t('dashboard.recent_sales')}</CardTitle>
        <span className="flex items-center gap-1">
          <span className="h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse" />
          <span className="text-[10px] font-medium text-green-600">{t('dashboard.live_badge')}</span>
        </span>
      </CardHeader>
      <CardContent className="p-0">
        {items.length === 0 ? (
          <div className="flex h-24 items-center justify-center text-sm text-muted-foreground px-4">
            {t('dashboard.no_sales_today')}
          </div>
        ) : (
          <div className="divide-y">
            <AnimatePresence initial={false}>
              {items.slice(0, 12).map((item, idx) => {
                if (item.type === 'repayment') {
                  return (
                    <motion.div
                      key={`r-${item.id}`}
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ duration: 0.3, delay: idx * 0.03 }}
                      className="flex items-center justify-between px-4 py-3 hover:bg-muted/30 transition-colors"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">
                            ↩ {t('sales.repayment')}
                          </span>
                          <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-emerald-300 text-emerald-600 dark:text-emerald-400">
                            {t(`payment.${item.method}` as any) || item.method}
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5 truncate">
                          {item.customerName} ·{' '}
                          {new Date(item.paid_at).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}
                        </p>
                      </div>
                      {role !== 'viewer' && (
                        <div className="text-right flex-shrink-0 ml-2">
                          <p className="text-sm font-semibold text-emerald-600 dark:text-emerald-400">+{formatNaira(item.amount)}</p>
                        </div>
                      )}
                    </motion.div>
                  )
                }

                // Regular sale row
                return (
                  <motion.div
                    key={item.id}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.3, delay: idx * 0.03 }}
                    className="flex items-center justify-between px-4 py-3 hover:bg-muted/30 transition-colors"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
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
                      <p className="text-xs text-muted-foreground mt-0.5 truncate">
                        {item.customers?.name || t('sales.walk_in')} ·{' '}
                        {new Date(item.created_at).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}
                      </p>
                    </div>
                    {role !== 'viewer' && (
                      <div className="text-right flex-shrink-0 ml-2">
                        <p className="text-sm font-semibold">{formatNaira(item.total)}</p>
                        {Number(item.balance) > 0 && (
                          <>
                            <p className="text-[10px] text-emerald-600 dark:text-emerald-400">+{formatNaira(item.amount_paid)}</p>
                            <p className="text-[10px] text-red-500">{t('payment.due')}: {formatNaira(item.balance)}</p>
                          </>
                        )}
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

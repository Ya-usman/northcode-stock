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
  sale_id: string
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

export function DebtGauge({ pct, remaining, fmt, t }: {
  pct: number
  remaining?: number
  fmt: (n: number) => string
  t: any
}) {
  const full = pct >= 99.9
  return (
    <div className="mt-2">
      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
        <div
          className={cn('h-full rounded-full transition-all duration-500', full ? 'bg-green-500' : 'bg-orange-400')}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="flex justify-between mt-0.5">
        <span className={cn('text-[9px]', full ? 'text-green-500 font-medium' : 'text-muted-foreground')}>
          {Math.round(pct)}% {t('payment.already_paid')}
        </span>
        {full
          ? <span className="text-[9px] text-green-500 font-medium">✓ {t('payments.paid_off')}</span>
          : remaining !== undefined && <span className="text-[9px] text-orange-500">{fmt(remaining)} {t('payments.remaining_due')}</span>
        }
      </div>
    </div>
  )
}

function methodLabel(method: string, t: any): string {
  const key = `payment.${method}` as any
  const result = t(key)
  if (result && result !== key) return result
  // fallback for unknown methods
  if (method === 'payment.pos' || method === 'pos') return 'Terminal POS'
  return method
}

export function RecentSalesFeed({ items, role }: RecentSalesFeedProps) {
  const t = useTranslations()
  const locale = useLocale()
  const { fmt: formatNaira } = useCurrency()
  const [activeTab, setActiveTab] = useState<'sales' | 'repayments'>('sales')

  // Sales tab: fully paid non-credit sales
  const salesItems = items.filter(i =>
    i.type === 'sale' &&
    Number((i as Sale).balance) === 0 &&
    (i as Sale).payment_method !== 'credit'
  ) as (Sale & { type: 'sale' })[]

  // Debts tab: credit/partial sales + repayments
  const debtSaleItems = items.filter(i =>
    i.type === 'sale' &&
    ((i as Sale).payment_method === 'credit' || Number((i as Sale).balance) > 0)
  ) as (Sale & { type: 'sale' })[]

  const repaymentItems = items.filter(i => i.type === 'repayment') as RepaymentFeedItem[]

  // Group repayments by sale_id
  const repaymentsBySaleId = new Map<string, RepaymentFeedItem[]>()
  for (const r of repaymentItems) {
    if (!repaymentsBySaleId.has(r.sale_id)) repaymentsBySaleId.set(r.sale_id, [])
    repaymentsBySaleId.get(r.sale_id)!.push(r)
  }
  const debtSaleIds = new Set(debtSaleItems.map(s => s.id))

  // Repayments for already-paid sales (not in debtSaleItems) — show standalone
  const standaloneRepayments = repaymentItems.filter(r => !debtSaleIds.has(r.sale_id))
  const latestByStandalone = new Map<string, RepaymentFeedItem>()
  for (const r of standaloneRepayments) {
    const ex = latestByStandalone.get(r.sale_id)
    if (!ex || r.paid_at > ex.paid_at) latestByStandalone.set(r.sale_id, r)
  }

  // Unified sorted list for Debts tab
  type DebtEntry =
    | { kind: 'sale'; sale: Sale & { type: 'sale' }; repayments: RepaymentFeedItem[]; lastAt: string }
    | { kind: 'repayment'; item: RepaymentFeedItem; lastAt: string }

  const debtEntries: DebtEntry[] = [
    ...debtSaleItems.map(sale => {
      const repayments = (repaymentsBySaleId.get(sale.id) || []).sort((a, b) => b.paid_at.localeCompare(a.paid_at))
      const lastAt = repayments.length > 0 ? repayments[0].paid_at : sale.created_at
      return { kind: 'sale' as const, sale, repayments, lastAt }
    }),
    ...Array.from(latestByStandalone.values()).map(item => ({
      kind: 'repayment' as const, item, lastAt: item.paid_at,
    })),
  ].sort((a, b) => b.lastAt.localeCompare(a.lastAt))

  const displayItems = activeTab === 'sales' ? salesItems : debtEntries

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
        {(['sales', 'repayments'] as const).map(tab => {
          const count = tab === 'sales' ? salesItems.length : debtEntries.length
          const active = activeTab === tab
          return (
            <button key={tab} onClick={() => setActiveTab(tab)}
              className={cn('relative pb-2 px-1 mr-4 text-xs font-medium transition-colors',
                active ? 'text-northcode-blue dark:text-blue-400' : 'text-muted-foreground hover:text-foreground'
              )}>
              {tab === 'sales' ? t('sales.sales_tab') : t('sales.debts_tab')}
              {count > 0 && (
                <span className={cn('ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-medium',
                  active ? 'bg-northcode-blue/10 text-northcode-blue dark:bg-blue-500/20 dark:text-blue-400' : 'bg-muted text-muted-foreground'
                )}>{count}</span>
              )}
              {active && <span className="absolute bottom-0 left-0 right-0 h-0.5 rounded-full bg-northcode-blue dark:bg-blue-400" />}
            </button>
          )
        })}
      </div>

      <CardContent className="p-0">
        {displayItems.length === 0 ? (
          <div className="flex h-24 items-center justify-center text-sm text-muted-foreground px-4">
            {activeTab === 'sales' ? t('dashboard.no_sales_today') : t('sales.no_repayments')}
          </div>
        ) : activeTab === 'sales' ? (
          /* ── Sales tab ── */
          <div className="divide-y">
            <AnimatePresence initial={false}>
              {(displayItems as (Sale & { type: 'sale' })[]).slice(0, 12).map((item, idx) => (
                <motion.div key={item.id}
                  initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.3, delay: idx * 0.03 }}
                  className="px-4 py-3 hover:bg-muted/30 transition-colors">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 flex-wrap min-w-0 flex-1">
                      <span className="text-xs font-mono font-semibold text-northcode-blue dark:text-blue-400">#{item.sale_number}</span>
                      <Badge variant="success" className="text-[10px] px-1.5 py-0">{t('status.paid')}</Badge>
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0">{methodLabel(item.payment_method, t)}</Badge>
                    </div>
                    {role !== 'viewer' && (
                      <p className="text-sm font-semibold flex-shrink-0 text-emerald-600 dark:text-emerald-400">
                        {formatNaira(item.total)}
                      </p>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5 truncate">
                    {item.customers?.name || t('sales.walk_in')} ·{' '}
                    {new Date(item.created_at).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}
                  </p>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        ) : (
          /* ── Debts tab ── */
          <div className="divide-y">
            <AnimatePresence initial={false}>
              {(displayItems as DebtEntry[]).slice(0, 12).map((entry, idx) => {
                if (entry.kind === 'sale') {
                  const sale = entry.sale
                  const repayments = entry.repayments
                  const pct = sale.total > 0 ? Math.min(100, (Number(sale.amount_paid) / Number(sale.total)) * 100) : 0
                  const hasDebt = Number(sale.balance) > 0
                  return (
                    <motion.div key={sale.id}
                      initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }}
                      transition={{ duration: 0.3, delay: idx * 0.03 }}
                      className="px-4 py-3 hover:bg-muted/30 transition-colors">

                      {/* Header row */}
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2 flex-wrap min-w-0 flex-1">
                          <span className="text-xs font-mono font-semibold text-northcode-blue dark:text-blue-400">
                            #{sale.sale_number}
                          </span>
                          <Badge variant={statusVariant[sale.payment_status] || 'secondary'} className="text-[10px] px-1.5 py-0">
                            {t(`status.${sale.payment_status}`)}
                          </Badge>
                          <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                            {methodLabel(sale.payment_method, t)}
                          </Badge>
                        </div>
                        {role !== 'viewer' && (
                          <div className="text-right flex-shrink-0">
                            <p className="text-sm font-bold">{formatNaira(sale.total)}</p>
                            {hasDebt && (
                              <p className="text-[10px] text-red-500">{t('payment.remaining')}: {formatNaira(sale.balance)}</p>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Customer + date */}
                      <p className="text-xs text-muted-foreground mt-0.5 truncate">
                        {sale.customers?.name || t('sales.walk_in')} ·{' '}
                        {new Date(sale.created_at).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}
                      </p>

                      {/* Progress bar */}
                      <DebtGauge pct={pct} remaining={hasDebt ? Number(sale.balance) : undefined} fmt={formatNaira} t={t} />

                      {/* Repayments nested */}
                      {repayments.length > 0 && (
                        <div className="mt-2 space-y-1 border-t pt-2">
                          {repayments.map(r => (
                            <div key={r.id} className="flex items-center justify-between gap-2 rounded-lg bg-green-50 dark:bg-green-950/20 px-2.5 py-1.5">
                              <div className="flex items-center gap-1.5 min-w-0">
                                <span className="text-green-600 text-xs">✓</span>
                                <Badge variant="outline" className="text-[10px] px-1.5 py-0 bg-card border-green-200">
                                  {methodLabel(r.method, t)}
                                </Badge>
                                <span className="text-[10px] text-muted-foreground truncate">
                                  {new Date(r.paid_at).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}
                                </span>
                              </div>
                              {role !== 'viewer' && (
                                <span className="text-xs font-bold text-green-600 flex-shrink-0">+{formatNaira(r.amount)}</span>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </motion.div>
                  )
                }

                /* Standalone repayment (fully-paid sale) */
                const r = entry.item
                const isPartial = r.remainingBalance !== undefined && r.remainingBalance > 0
                const paid = (r.totalDebt ?? 0) - (r.remainingBalance ?? 0)
                const pct = r.totalDebt ? Math.min(100, (paid / r.totalDebt) * 100) : 100
                return (
                  <motion.div key={`r-${r.id}`}
                    initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.3, delay: idx * 0.03 }}
                    className="px-4 py-3 hover:bg-muted/30 transition-colors">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2 flex-wrap min-w-0 flex-1">
                        <Badge variant={isPartial ? 'warning' : 'success'} className="text-[10px] px-1.5 py-0">
                          {isPartial ? t('status.partial') : t('status.paid')}
                        </Badge>
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                          {methodLabel(r.method, t)}
                        </Badge>
                      </div>
                      {role !== 'viewer' && (
                        <p className="text-sm font-semibold text-emerald-600 dark:text-emerald-400 flex-shrink-0">
                          +{formatNaira(r.amount)}
                        </p>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5 truncate">
                      {r.customerName} ·{' '}
                      {new Date(r.paid_at).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}
                    </p>
                    {r.totalDebt !== undefined && r.totalDebt > 0 && (
                      <DebtGauge pct={pct} remaining={r.remainingBalance} fmt={formatNaira} t={t} />
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

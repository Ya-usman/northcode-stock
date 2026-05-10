'use client'

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useTranslations, useLocale } from 'next-intl'
import { useCurrency } from '@/lib/hooks/use-currency'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils/cn'
import { ChevronDown } from 'lucide-react'
import type { Sale } from '@/lib/types/database'

export interface RepaymentFeedItem {
  type: 'repayment'
  id: string
  sale_id: string
  sale_number?: string
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
    <div className="mt-1.5 flex items-center gap-2">
      <div className="w-28 h-1 rounded-full bg-muted overflow-hidden flex-shrink-0">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{
            width: `${pct}%`,
            background: full
              ? '#22c55e'
              : `linear-gradient(to right, #ef4444, #f97316 50%, #22c55e)`,
            backgroundSize: '200% 100%',
            backgroundPositionX: `${100 - pct}%`,
          }}
        />
      </div>
      <span className={cn('text-[9px] tabular-nums', full ? 'text-green-500 font-medium' : 'text-muted-foreground')}>
        {full
          ? `✓ ${t('payments.paid_off')}`
          : remaining !== undefined
            ? `${Math.round(pct)}% · ${fmt(remaining)} ${t('payments.remaining_due')}`
            : `${Math.round(pct)}%`
        }
      </span>
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
  const [expandedSaleId, setExpandedSaleId] = useState<string | null>(null)

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
  // Exclude repayments whose sale now appears in salesItems (fully paid, shown in Ventes tab already)
  const salesItemIds = new Set(salesItems.map(s => s.id))
  const standaloneRepayments = repaymentItems.filter(r =>
    !debtSaleIds.has(r.sale_id) && !salesItemIds.has(r.sale_id)
  )
  // Show ALL standalone repayments (not just the latest), grouped by sale
  const standaloneGrouped = new Map<string, RepaymentFeedItem[]>()
  for (const r of standaloneRepayments) {
    if (!standaloneGrouped.has(r.sale_id)) standaloneGrouped.set(r.sale_id, [])
    standaloneGrouped.get(r.sale_id)!.push(r)
  }
  // One representative entry per sale (latest), carrying all repayments
  const latestByStandalone = new Map<string, RepaymentFeedItem & { allRepayments: RepaymentFeedItem[] }>()
  for (const [saleId, repays] of standaloneGrouped) {
    const sorted = repays.sort((a, b) => b.paid_at.localeCompare(a.paid_at))
    latestByStandalone.set(saleId, { ...sorted[0], allRepayments: sorted })
  }

  // Unified sorted list for Debts tab
  type DebtEntry =
    | { kind: 'sale'; sale: Sale & { type: 'sale' }; repayments: RepaymentFeedItem[]; lastAt: string }
    | { kind: 'repayment'; item: RepaymentFeedItem; allRepayments: RepaymentFeedItem[]; lastAt: string }

  const debtEntries: DebtEntry[] = [
    ...debtSaleItems.map(sale => {
      const repayments = (repaymentsBySaleId.get(sale.id) || []).sort((a, b) => b.paid_at.localeCompare(a.paid_at))
      const lastAt = repayments.length > 0 ? repayments[0].paid_at : sale.created_at
      return { kind: 'sale' as const, sale, repayments, lastAt }
    }),
    ...Array.from(latestByStandalone.values()).map(item => ({
      kind: 'repayment' as const, item, lastAt: item.paid_at,
      allRepayments: (item as any).allRepayments as RepaymentFeedItem[],
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
                active ? 'text-stockshop-blue dark:text-blue-400' : 'text-muted-foreground hover:text-foreground'
              )}>
              {tab === 'sales' ? t('sales.sales_tab') : t('sales.debts_tab')}
              {count > 0 && (
                <span className={cn('ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-medium',
                  active ? 'bg-stockshop-blue/10 text-stockshop-blue dark:bg-blue-500/20 dark:text-blue-400' : 'bg-muted text-muted-foreground'
                )}>{count}</span>
              )}
              {active && <span className="absolute bottom-0 left-0 right-0 h-0.5 rounded-full bg-stockshop-blue dark:bg-blue-400" />}
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
                      <span className="text-xs font-mono font-semibold text-stockshop-blue dark:text-blue-400">#{item.sale_number}</span>
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
                  const isExpanded = expandedSaleId === sale.id
                  const totalRepaid = repayments.reduce((s, r) => s + r.amount, 0)
                  return (
                    <motion.div key={sale.id}
                      initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }}
                      transition={{ duration: 0.3, delay: idx * 0.03 }}>

                      {/* Clickable header */}
                      <button
                        className="w-full px-4 py-3 hover:bg-muted/30 transition-colors text-left"
                        onClick={() => setExpandedSaleId(isExpanded ? null : sale.id)}>
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-center gap-2 flex-wrap min-w-0 flex-1">
                            <span className="text-xs font-mono font-semibold text-stockshop-blue dark:text-blue-400">
                              #{sale.sale_number}
                            </span>
                            <Badge variant={statusVariant[sale.payment_status] || 'secondary'} className="text-[10px] px-1.5 py-0">
                              {t(`status.${sale.payment_status}`)}
                            </Badge>
                            <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                              {methodLabel(sale.payment_method, t)}
                            </Badge>
                            {repayments.length > 0 && (
                              <span className="flex items-center gap-0.5 text-[9px] text-muted-foreground">
                                {repayments.length} paiement{repayments.length > 1 ? 's' : ''}
                                <ChevronDown className={cn('h-3 w-3 transition-transform duration-200', isExpanded && 'rotate-180')} />
                              </span>
                            )}
                          </div>
                          {role !== 'viewer' && (
                            <div className="text-right flex-shrink-0">
                              {repayments.length > 0 ? (
                                <p className="text-sm font-bold text-emerald-600 dark:text-emerald-400">+{formatNaira(totalRepaid)}</p>
                              ) : (
                                <p className="text-sm font-bold">{formatNaira(sale.total)}</p>
                              )}
                              {hasDebt && (
                                <p className="text-[10px] text-red-500">{t('payment.remaining')}: {formatNaira(sale.balance)}</p>
                              )}
                            </div>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5 truncate">
                          {sale.customers?.name || t('sales.walk_in')} ·{' '}
                          {new Date(sale.created_at).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}
                        </p>
                        <DebtGauge pct={pct} remaining={hasDebt ? Number(sale.balance) : undefined} fmt={formatNaira} t={t} />
                      </button>

                      {/* Repayments — visible on click */}
                      <AnimatePresence>
                        {isExpanded && repayments.length > 0 && (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ duration: 0.2 }}
                            className="overflow-hidden border-t bg-muted/20">
                            <div className="px-4 py-2 space-y-1.5">
                              {repayments.map(r => (
                                <div key={r.id} className="flex items-center justify-between gap-2 rounded-lg bg-green-50 dark:bg-green-950/20 px-2.5 py-1.5">
                                  <div className="flex items-center gap-1.5 min-w-0">
                                    <span className="text-green-600 text-xs">✓</span>
                                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 bg-card border-green-200">
                                      {methodLabel(r.method, t)}
                                    </Badge>
                                    <span className="text-[10px] text-muted-foreground">
                                      {new Date(r.paid_at).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}
                                    </span>
                                  </div>
                                  {role !== 'viewer' && (
                                    <span className="text-xs font-bold text-green-600 flex-shrink-0">+{formatNaira(r.amount)}</span>
                                  )}
                                </div>
                              ))}
                              {role !== 'viewer' && repayments.length > 1 && (
                                <div className="flex justify-between text-[10px] pt-1 border-t">
                                  <span className="text-muted-foreground">Total remboursé</span>
                                  <span className="font-semibold text-green-600">+{formatNaira(totalRepaid)}</span>
                                </div>
                              )}
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </motion.div>
                  )
                }

                /* Standalone repayment (fully-paid credit sale) */
                const r = entry.item
                const allR = entry.allRepayments
                const isPartial = r.remainingBalance !== undefined && r.remainingBalance > 0
                const paid = (r.totalDebt ?? 0) - (r.remainingBalance ?? 0)
                const pct = r.totalDebt ? Math.min(100, (paid / r.totalDebt) * 100) : 100
                const totalPaidToday = allR.reduce((s, x) => s + x.amount, 0)
                const isExpanded = expandedSaleId === r.sale_id
                return (
                  <motion.div key={`r-${r.id}`}
                    initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.3, delay: idx * 0.03 }}>

                    <button
                      className="w-full px-4 py-3 hover:bg-muted/30 transition-colors text-left"
                      onClick={() => setExpandedSaleId(isExpanded ? null : r.sale_id)}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2 flex-wrap min-w-0 flex-1">
                          {r.sale_number && (
                            <span className="text-xs font-mono font-semibold text-stockshop-blue dark:text-blue-400">
                              #{r.sale_number}
                            </span>
                          )}
                          <Badge variant={isPartial ? 'warning' : 'success'} className="text-[10px] px-1.5 py-0">
                            {isPartial ? t('status.partial') : t('status.paid')}
                          </Badge>
                          {allR.length > 0 && (
                            <span className="flex items-center gap-0.5 text-[9px] text-muted-foreground">
                              {allR.length} paiement{allR.length > 1 ? 's' : ''}
                              <ChevronDown className={cn('h-3 w-3 transition-transform duration-200', isExpanded && 'rotate-180')} />
                            </span>
                          )}
                        </div>
                        {role !== 'viewer' && (
                          <p className="text-sm font-semibold text-emerald-600 dark:text-emerald-400 flex-shrink-0">
                            +{formatNaira(totalPaidToday)}
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
                    </button>

                    <AnimatePresence>
                      {isExpanded && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.2 }}
                          className="overflow-hidden border-t bg-muted/20">
                          <div className="px-4 py-2 space-y-1.5">
                            {allR.map(x => (
                              <div key={x.id} className="flex items-center justify-between gap-2 rounded-lg bg-green-50 dark:bg-green-950/20 px-2.5 py-1.5">
                                <div className="flex items-center gap-1.5 min-w-0">
                                  <span className="text-green-600 text-xs">✓</span>
                                  <Badge variant="outline" className="text-[10px] px-1.5 py-0 bg-card border-green-200">
                                    {methodLabel(x.method, t)}
                                  </Badge>
                                  <span className="text-[10px] text-muted-foreground">
                                    {new Date(x.paid_at).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}
                                  </span>
                                </div>
                                {role !== 'viewer' && (
                                  <span className="text-xs font-bold text-green-600 flex-shrink-0">+{formatNaira(x.amount)}</span>
                                )}
                              </div>
                            ))}
                            {role !== 'viewer' && allR.length > 1 && (
                              <div className="flex justify-between text-[10px] pt-1 border-t">
                                <span className="text-muted-foreground">Total remboursé</span>
                                <span className="font-semibold text-green-600">+{formatNaira(totalPaidToday)}</span>
                              </div>
                            )}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
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

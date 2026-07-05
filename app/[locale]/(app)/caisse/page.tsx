'use client'

import { useState, useEffect, useCallback } from 'react'
import { format, startOfDay, endOfDay, addDays, isToday } from 'date-fns'
import { useTranslations } from 'next-intl'
import { createClient } from '@/lib/supabase/client'
import { useAuthContext } from '@/lib/contexts/auth-context'
import { useCurrency } from '@/lib/hooks/use-currency'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  ChevronLeft, ChevronRight, ClipboardList, ShoppingCart,
  TrendingUp, ChevronDown, ChevronUp, Table2, Users, RotateCcw,
} from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import { downloadOrShareCSV } from '@/lib/utils/native-share'

const supabase = createClient() as any

interface SaleRow {
  id: string
  sale_number: string
  cashier_id: string | null
  amount_paid: number
  created_at: string
}

interface RepaymentRow {
  id: string
  sale_number: string
  amount: number
  paid_at: string
  method: string
}

interface CashierSummary {
  cashierId: string
  name: string
  salesCount: number
  salesTotal: number
  repaymentsCount: number
  repaymentsTotal: number
  total: number
  sales: SaleRow[]
  repayments: RepaymentRow[]
}

const RANK_STYLES = [
  'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300',
  'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300',
  'bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300',
]
const DEFAULT_RANK = 'bg-blue-50 dark:bg-blue-950/30 text-blue-600 dark:text-blue-400'

export default function CaissePage() {
  const { effectiveShopIds, profile, roleInActiveShop } = useAuthContext()
  const t = useTranslations('caisse')
  const { fmt } = useCurrency()

  const role = roleInActiveShop ?? profile?.role
  const isAuthorized = role === 'owner' || role === 'super_admin' || role === 'manager' || role === 'shop_manager'

  const [selectedDate, setSelectedDate] = useState<Date>(() => new Date())
  const [loading, setLoading] = useState(true)
  const [cashierSummaries, setCashierSummaries] = useState<CashierSummary[]>([])
  const [expandedCashier, setExpandedCashier] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)

  const shopIdsKey = effectiveShopIds.join(',')

  const fetchData = useCallback(async () => {
    if (!effectiveShopIds.length || !isAuthorized) { setLoading(false); return }
    setLoading(true)
    try {
      const dayStart = startOfDay(selectedDate).toISOString()
      const dayEnd   = endOfDay(selectedDate).toISOString()

      // Fetch sales + repayments in parallel
      const [{ data: salesData }, { data: repaymentsRaw }] = await Promise.all([
        supabase
          .from('sales')
          .select('id, sale_number, cashier_id, amount_paid, created_at')
          .in('shop_id', effectiveShopIds)
          .eq('sale_status', 'active')
          .gte('created_at', dayStart)
          .lte('created_at', dayEnd)
          .order('created_at', { ascending: false }),

        supabase
          .from('payments')
          .select('id, amount, received_by, paid_at, method, sales!inner(shop_id, sale_number, sale_status)')
          .gte('paid_at', dayStart)
          .lte('paid_at', dayEnd)
          .order('paid_at', { ascending: false }),
      ])

      const sales: SaleRow[] = salesData || []

      // Filter repayments to this shop + non-cancelled sales
      const repayments = (repaymentsRaw || []).filter((p: any) =>
        effectiveShopIds.includes(p.sales?.shop_id) &&
        p.sales?.sale_status !== 'cancelled'
      )

      // Collect all profile IDs to look up (sales cashiers + repayment receivers)
      const saleIds = sales.map(s => s.cashier_id).filter((id): id is string => !!id)
      const repayIds = repayments.map((p: any) => p.received_by).filter((id: any): id is string => !!id)
      const allIds = Array.from(new Set([...saleIds, ...repayIds]))

      let profileMap: Record<string, string> = {}
      if (allIds.length) {
        const { data: profilesData } = await supabase
          .from('profiles')
          .select('id, full_name')
          .in('id', allIds)
        ;(profilesData || []).forEach((p: any) => { profileMap[p.id] = p.full_name })
      }

      // Build grouped cashier summaries
      const grouped: Record<string, CashierSummary> = {}

      const ensure = (cid: string) => {
        if (!grouped[cid]) {
          grouped[cid] = {
            cashierId: cid,
            name: profileMap[cid] ?? t('unknown'),
            salesCount: 0, salesTotal: 0,
            repaymentsCount: 0, repaymentsTotal: 0,
            total: 0,
            sales: [], repayments: [],
          }
        }
        return grouped[cid]
      }

      for (const sale of sales) {
        const entry = ensure(sale.cashier_id ?? 'unknown')
        entry.salesCount++
        entry.salesTotal += Number(sale.amount_paid)
        entry.total += Number(sale.amount_paid)
        entry.sales.push(sale)
      }

      for (const p of repayments) {
        const cid = (p.received_by as string | null) ?? 'unknown'
        const entry = ensure(cid)
        entry.repaymentsCount++
        entry.repaymentsTotal += Number(p.amount)
        entry.total += Number(p.amount)
        entry.repayments.push({
          id: p.id,
          sale_number: p.sales?.sale_number ?? '?',
          amount: Number(p.amount),
          paid_at: p.paid_at,
          method: p.method,
        })
      }

      setCashierSummaries(Object.values(grouped).sort((a, b) => b.total - a.total))
    } finally {
      setLoading(false)
    }
  }, [shopIdsKey, selectedDate.toDateString(), isAuthorized])

  useEffect(() => { fetchData() }, [fetchData])

  const grandTotal        = cashierSummaries.reduce((s, c) => s + c.total, 0)
  const grandSalesTotal   = cashierSummaries.reduce((s, c) => s + c.salesTotal, 0)
  const grandRepayTotal   = cashierSummaries.reduce((s, c) => s + c.repaymentsTotal, 0)
  const grandSalesCount   = cashierSummaries.reduce((s, c) => s + c.salesCount, 0)

  const dateLabel = isToday(selectedDate)
    ? t('today')
    : selectedDate.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })

  const exportCSV = async () => {
    setExporting(true)
    const header = [t('col_cashier'), t('col_sales_count'), t('col_sales_total'), t('col_repayments_count'), t('col_repayments_total'), t('col_total')]
    const rows = cashierSummaries.map(c => [
      c.name,
      String(c.salesCount), String(c.salesTotal),
      String(c.repaymentsCount), String(c.repaymentsTotal),
      String(c.total),
    ])
    rows.push([t('grand_total'), String(grandSalesCount), String(grandSalesTotal), '', String(grandRepayTotal), String(grandTotal)])
    const csv = [header, ...rows].map(r => r.join(';')).join('\n')
    try {
      await downloadOrShareCSV(csv, `caisse-${format(selectedDate, 'yyyy-MM-dd')}.csv`)
    } catch { /* ignore */ }
    setExporting(false)
  }

  if (!isAuthorized) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <ClipboardList className="h-12 w-12 text-muted-foreground/40 mb-4" />
        <p className="text-muted-foreground text-sm">{t('no_access')}</p>
      </div>
    )
  }

  const hasAny = cashierSummaries.length > 0

  return (
    <div className="space-y-4 max-w-2xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-lg font-bold">{t('title')}</h1>
        {hasAny && (
          <Button variant="outline" size="icon" className="h-9 w-9" onClick={exportCSV} disabled={exporting}>
            <Table2 className="h-4 w-4" />
          </Button>
        )}
      </div>

      {/* Date picker */}
      <div className="flex items-center justify-between gap-3">
        <Button variant="outline" size="icon" className="h-9 w-9 flex-shrink-0"
          onClick={() => setSelectedDate(d => addDays(d, -1))}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <p className="text-sm font-semibold capitalize text-center flex-1">{dateLabel}</p>
        <Button variant="outline" size="icon" className="h-9 w-9 flex-shrink-0"
          onClick={() => setSelectedDate(d => addDays(d, 1))}
          disabled={isToday(selectedDate)}>
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-3">
        <Card className="border-0 shadow-sm">
          <CardContent className="p-3">
            <div className="flex items-center gap-1.5 mb-1">
              <TrendingUp className="h-3.5 w-3.5 text-green-600 flex-shrink-0" />
              <p className="text-[10px] font-medium text-muted-foreground truncate">{t('total_collected')}</p>
            </div>
            {loading ? <Skeleton className="h-6 w-full" /> : (
              <>
                <p className="text-base font-bold leading-none">{fmt(grandTotal)}</p>
                {grandRepayTotal > 0 && (
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    {fmt(grandSalesTotal)} + {fmt(grandRepayTotal)} remb.
                  </p>
                )}
              </>
            )}
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm">
          <CardContent className="p-3">
            <div className="flex items-center gap-1.5 mb-1">
              <ShoppingCart className="h-3.5 w-3.5 text-blue-600 flex-shrink-0" />
              <p className="text-[10px] font-medium text-muted-foreground truncate">{t('total_sales')}</p>
            </div>
            {loading ? <Skeleton className="h-6 w-12" /> : <p className="text-base font-bold leading-none">{grandSalesCount}</p>}
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm">
          <CardContent className="p-3">
            <div className="flex items-center gap-1.5 mb-1">
              <Users className="h-3.5 w-3.5 text-violet-600 flex-shrink-0" />
              <p className="text-[10px] font-medium text-muted-foreground truncate">{t('active_cashiers')}</p>
            </div>
            {loading ? <Skeleton className="h-6 w-8" /> : <p className="text-base font-bold leading-none">{cashierSummaries.length}</p>}
          </CardContent>
        </Card>
      </div>

      {/* Main content */}
      {loading ? (
        <div className="space-y-2">
          {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-16 rounded-xl" />)}
        </div>
      ) : !hasAny ? (
        <div className="text-center py-16 text-muted-foreground">
          <ShoppingCart className="h-10 w-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm">{t('no_sales')}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {cashierSummaries.map((c, idx) => {
            const pct = grandTotal > 0 ? (c.total / grandTotal) * 100 : 0
            const isExpanded = expandedCashier === c.cashierId
            const initials = c.name.split(' ').map((n: string) => n[0]).slice(0, 2).join('').toUpperCase()

            return (
              <Card key={c.cashierId} className="border-0 shadow-sm overflow-hidden">
                <button
                  onClick={() => setExpandedCashier(isExpanded ? null : c.cashierId)}
                  className="w-full px-4 py-3 flex items-center gap-3 hover:bg-muted/30 transition-colors text-left"
                >
                  <div className={cn(
                    'flex-shrink-0 h-9 w-9 rounded-xl flex items-center justify-center text-xs font-bold',
                    RANK_STYLES[idx] ?? DEFAULT_RANK
                  )}>
                    {initials}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <p className="text-sm font-semibold truncate">{c.name}</p>
                      <p className="text-sm font-bold flex-shrink-0">{fmt(c.total)}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                        <div className="h-full rounded-full bg-stockshop-blue/70 transition-all duration-500"
                          style={{ width: `${pct}%` }} />
                      </div>
                      <span className="text-[10px] text-muted-foreground flex-shrink-0 leading-tight">
                        {c.salesCount > 0 && `${c.salesCount} vte`}
                        {c.repaymentsCount > 0 && `${c.salesCount > 0 ? ' · ' : ''}${c.repaymentsCount} remb.`}
                        {' · '}{pct.toFixed(0)}%
                      </span>
                    </div>
                  </div>

                  {isExpanded
                    ? <ChevronUp className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                    : <ChevronDown className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                  }
                </button>

                {isExpanded && (
                  <div className="border-t">
                    {/* Sales section */}
                    {c.sales.length > 0 && (
                      <>
                        <div className="flex items-center gap-2 px-4 py-2 bg-muted/20">
                          <ShoppingCart className="h-3.5 w-3.5 text-muted-foreground" />
                          <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
                            {t('section_sales')} · {fmt(c.salesTotal)}
                          </p>
                        </div>
                        <div className="divide-y">
                          {c.sales.map(sale => (
                            <div key={sale.id} className="flex items-center gap-3 px-4 py-2.5">
                              <p className="text-xs text-muted-foreground flex-shrink-0 w-10 tabular-nums">
                                {format(new Date(sale.created_at), 'HH:mm')}
                              </p>
                              <p className="text-xs text-muted-foreground flex-1 truncate">#{sale.sale_number}</p>
                              <p className="text-sm font-semibold flex-shrink-0">{fmt(Number(sale.amount_paid))}</p>
                            </div>
                          ))}
                        </div>
                      </>
                    )}

                    {/* Repayments section */}
                    {c.repayments.length > 0 && (
                      <>
                        <div className="flex items-center gap-2 px-4 py-2 bg-emerald-50/60 dark:bg-emerald-950/20">
                          <RotateCcw className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                          <p className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-400 uppercase tracking-wide">
                            {t('section_repayments')} · {fmt(c.repaymentsTotal)}
                          </p>
                        </div>
                        <div className="divide-y">
                          {c.repayments.map(r => (
                            <div key={r.id} className="flex items-center gap-3 px-4 py-2.5">
                              <p className="text-xs text-muted-foreground flex-shrink-0 w-10 tabular-nums">
                                {format(new Date(r.paid_at), 'HH:mm')}
                              </p>
                              <p className="text-xs text-muted-foreground flex-1 truncate">#{r.sale_number}</p>
                              <p className="text-sm font-semibold text-emerald-600 dark:text-emerald-400 flex-shrink-0">
                                {fmt(r.amount)}
                              </p>
                            </div>
                          ))}
                        </div>
                      </>
                    )}

                    {/* Cashier subtotal */}
                    <div className="flex items-center justify-between px-4 py-2.5 bg-muted/30">
                      <p className="text-xs font-medium text-muted-foreground">{t('subtotal')}</p>
                      <p className="text-sm font-bold">{fmt(c.total)}</p>
                    </div>
                  </div>
                )}
              </Card>
            )
          })}

          {/* Grand total */}
          <Card className="border-0 shadow-sm bg-stockshop-blue/5 dark:bg-blue-950/20">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-stockshop-blue dark:text-blue-400">
                  <TrendingUp className="h-4 w-4" />
                  <span className="text-sm font-semibold">{t('grand_total')}</span>
                </div>
                <span className="text-lg font-bold text-stockshop-blue dark:text-blue-400">{fmt(grandTotal)}</span>
              </div>
              {grandRepayTotal > 0 && (
                <div className="flex justify-end gap-4 mt-1">
                  <span className="text-[11px] text-muted-foreground">{t('section_sales')} : {fmt(grandSalesTotal)}</span>
                  <span className="text-[11px] text-emerald-600 dark:text-emerald-400">{t('section_repayments')} : {fmt(grandRepayTotal)}</span>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}

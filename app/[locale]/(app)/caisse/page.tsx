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
  TrendingUp, ChevronDown, ChevronUp, Table2, Users,
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

interface CashierSummary {
  cashierId: string
  name: string
  salesCount: number
  total: number
  sales: SaleRow[]
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
      const { data: salesData } = await supabase
        .from('sales')
        .select('id, sale_number, cashier_id, amount_paid, created_at')
        .in('shop_id', effectiveShopIds)
        .eq('sale_status', 'active')
        .gte('created_at', startOfDay(selectedDate).toISOString())
        .lte('created_at', endOfDay(selectedDate).toISOString())
        .order('created_at', { ascending: false })

      const sales: SaleRow[] = salesData || []
      const cashierIds = Array.from(new Set(sales.map(s => s.cashier_id).filter((id): id is string => !!id)))

      let profileMap: Record<string, string> = {}
      if (cashierIds.length) {
        const { data: profilesData } = await supabase
          .from('profiles')
          .select('id, full_name')
          .in('id', cashierIds)
        ;(profilesData || []).forEach((p: any) => { profileMap[p.id] = p.full_name })
      }

      const grouped: Record<string, CashierSummary> = {}
      for (const sale of sales) {
        const cid = sale.cashier_id ?? 'unknown'
        if (!grouped[cid]) {
          grouped[cid] = { cashierId: cid, name: profileMap[cid] ?? t('unknown'), salesCount: 0, total: 0, sales: [] }
        }
        grouped[cid].salesCount++
        grouped[cid].total += Number(sale.amount_paid)
        grouped[cid].sales.push(sale)
      }

      setCashierSummaries(Object.values(grouped).sort((a, b) => b.total - a.total))
    } finally {
      setLoading(false)
    }
  }, [shopIdsKey, selectedDate.toDateString(), isAuthorized])

  useEffect(() => { fetchData() }, [fetchData])

  const grandTotal = cashierSummaries.reduce((s, c) => s + c.total, 0)
  const grandCount = cashierSummaries.reduce((s, c) => s + c.salesCount, 0)

  const dateLabel = isToday(selectedDate)
    ? t('today')
    : selectedDate.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })

  const exportCSV = async () => {
    setExporting(true)
    const header = [t('col_cashier'), t('col_sales_count'), t('col_total')]
    const rows = cashierSummaries.map(c => [c.name, String(c.salesCount), String(c.total)])
    rows.push([t('grand_total'), String(grandCount), String(grandTotal)])
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

  return (
    <div className="space-y-4 max-w-2xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-lg font-bold">{t('title')}</h1>
        {cashierSummaries.length > 0 && (
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
            {loading ? <Skeleton className="h-6 w-full" /> : <p className="text-base font-bold leading-none">{fmt(grandTotal)}</p>}
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm">
          <CardContent className="p-3">
            <div className="flex items-center gap-1.5 mb-1">
              <ShoppingCart className="h-3.5 w-3.5 text-blue-600 flex-shrink-0" />
              <p className="text-[10px] font-medium text-muted-foreground truncate">{t('total_sales')}</p>
            </div>
            {loading ? <Skeleton className="h-6 w-12" /> : <p className="text-base font-bold leading-none">{grandCount}</p>}
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
      ) : cashierSummaries.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <ShoppingCart className="h-10 w-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm">{t('no_sales')}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {/* Cashier rows */}
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
                        <div
                          className="h-full rounded-full bg-stockshop-blue/70 transition-all duration-500"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="text-[10px] text-muted-foreground flex-shrink-0">
                        {c.salesCount} {c.salesCount > 1 ? t('sales_plural') : t('sale_singular')} · {pct.toFixed(0)}%
                      </span>
                    </div>
                  </div>

                  {isExpanded
                    ? <ChevronUp className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                    : <ChevronDown className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                  }
                </button>

                {isExpanded && (
                  <div className="border-t divide-y">
                    {c.sales.map(sale => (
                      <div key={sale.id} className="flex items-center gap-3 px-4 py-2.5">
                        <p className="text-xs text-muted-foreground flex-shrink-0 w-10 tabular-nums">
                          {format(new Date(sale.created_at), 'HH:mm')}
                        </p>
                        <p className="text-xs text-muted-foreground flex-1 truncate">#{sale.sale_number}</p>
                        <p className="text-sm font-semibold flex-shrink-0">{fmt(Number(sale.amount_paid))}</p>
                      </div>
                    ))}
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
            <CardContent className="p-4 flex items-center justify-between">
              <div className="flex items-center gap-2 text-stockshop-blue dark:text-blue-400">
                <TrendingUp className="h-4 w-4" />
                <span className="text-sm font-semibold">{t('grand_total')}</span>
              </div>
              <span className="text-lg font-bold text-stockshop-blue dark:text-blue-400">{fmt(grandTotal)}</span>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}

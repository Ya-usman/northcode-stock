'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { createClient } from '@/lib/supabase/client'
import { useAuthContext as useAuth } from '@/lib/contexts/auth-context'
import { useDashboardRealtime } from '@/lib/hooks/use-realtime'
import { MetricCards } from '@/components/dashboard/metric-cards'
import { RevenueChart } from '@/components/dashboard/revenue-chart'
import { TopProductsChart } from '@/components/dashboard/top-products-chart'
import { RecentSalesFeed, type RepaymentFeedItem, type FeedItem } from '@/components/dashboard/recent-sales-feed'
import { StockAlerts } from '@/components/dashboard/stock-alerts'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/use-toast'
import { RefreshCw, Store, ChevronDown, Check } from 'lucide-react'
import { format, subDays, startOfDay, endOfDay, parseISO } from 'date-fns'
import type { Sale, Product, RevenueDataPoint, TopProduct } from '@/lib/types/database'
import { useCurrency } from '@/lib/hooks/use-currency'
import { cn } from '@/lib/utils/cn'

const supabase = createClient() as any

// ── Dashboard cache (stale-while-revalidate) ────────────────────────────────
const DASH_CACHE_KEY = 'dashboard_cache_v1'
interface DashCache {
  shopKey: string
  todayRevenue: number; todaySalesCount: number; outstandingDebt: number
  revenueData: RevenueDataPoint[]; topProducts: TopProduct[]
  lowStock: Product[]; outOfStock: Product[]
  recentSales: Sale[]; repaymentItems: RepaymentFeedItem[]
  savedAt: number
}
function readDashCache(shopKey: string): DashCache | null {
  try {
    const raw = localStorage.getItem(DASH_CACHE_KEY)
    if (!raw) return null
    const c: DashCache = JSON.parse(raw)
    // Cache valid for 1 minute, same shop selection
    if (c.shopKey !== shopKey || Date.now() - c.savedAt > 60000) return null
    return c
  } catch { return null }
}
function writeDashCache(data: Omit<DashCache, 'savedAt'>) {
  try { localStorage.setItem(DASH_CACHE_KEY, JSON.stringify({ ...data, savedAt: Date.now() })) }
  catch { /* ignore */ }
}

export default function DashboardPage() {
  const t = useTranslations()
  const locale = useLocale()
  const { profile, shop, userShops, dashboardShopFilter, setDashboardShopFilter } = useAuth()
  const { fmt: formatNaira } = useCurrency()
  const { toast } = useToast()

  const [shopPickerOpen, setShopPickerOpen] = useState(false)

  // firstLoad = show skeleton only when no cached data available
  const [firstLoad, setFirstLoad] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const [todayRevenue, setTodayRevenue] = useState(0)
  const [todaySalesCount, setTodaySalesCount] = useState(0)
  const [repaymentFeed, setRepaymentFeed] = useState<RepaymentFeedItem[]>([])
  const [outstandingDebt, setOutstandingDebt] = useState(0)
  const [recentSales, setRecentSales] = useState<Sale[]>([])
  const [revenueData, setRevenueData] = useState<RevenueDataPoint[]>([])
  const [topProducts, setTopProducts] = useState<TopProduct[]>([])
  const [lowStockProducts, setLowStockProducts] = useState<Product[]>([])
  const [outOfStockProducts, setOutOfStockProducts] = useState<Product[]>([])

  // Determine which shop IDs to query
  const shopIds = dashboardShopFilter
    ? [dashboardShopFilter]
    : userShops.map(s => s.id).filter(Boolean)

  const activeShopLabel = dashboardShopFilter
    ? userShops.find(s => s.id === dashboardShopFilter)?.name || t('nav.shops')
    : userShops.length > 1 ? t('dashboard.all_shops') : (shop?.name || t('nav.shops'))

  // Track in-flight request to avoid stale updates
  const loadingRef = useRef(false)

  const applyDashData = useCallback((
    salesCount: number, revenue: number, debt: number,
    sales: Sale[], repayments: RepaymentFeedItem[], revData: RevenueDataPoint[], tops: TopProduct[],
    low: Product[], out: Product[]
  ) => {
    setTodaySalesCount(salesCount)
    setTodayRevenue(revenue)
    setRecentSales(sales)
    setRepaymentFeed(repayments)
    setOutstandingDebt(debt)
    setRevenueData(revData)
    setTopProducts(tops)
    setLowStockProducts(low)
    setOutOfStockProducts(out)
  }, [])

  const loadDashboard = useCallback(async (quiet = false) => {
    if (shopIds.length === 0) return
    if (loadingRef.current) return
    loadingRef.current = true

    const isCashier = profile?.role === 'cashier'
    const cashierId = profile?.id

    const shopKey = shopIds.join(',')

    // ── Serve cache immediately, then refresh in background ────────
    const cached = readDashCache(shopKey)
    if (cached && !quiet) {
      applyDashData(cached.todaySalesCount, cached.todayRevenue, cached.outstandingDebt,
        cached.recentSales, cached.repaymentItems ?? [], cached.revenueData, cached.topProducts, cached.lowStock, cached.outOfStock)
      setFirstLoad(false)
      // Still fetch fresh data in background — don't block render
    }

    if (quiet) setRefreshing(true)

    try {
      const today = new Date()
      const todayStart = startOfDay(today).toISOString()
      const todayEnd = endOfDay(today).toISOString()
      const sevenDaysAgo = subDays(today, 6)

      const weekStartISO = startOfDay(sevenDaysAgo).toISOString()

      // ── All parallel queries ────────────────────────────────────
      const [
        { data: todaySales },
        { data: debtData },
        { data: weekSales },
        { data: stockData },
        { data: todayPaymentsRaw },
        paymentsRes,
      ] = await Promise.all([
        // Today's sales — cashier sees only their own, owner sees all
        (() => {
          let q = supabase
            .from('sales')
            .select('id, sale_number, total, amount_paid, balance, payment_method, payment_status, sale_status, created_at, customers(name), cashier_id, shop_id')
            .in('shop_id', shopIds)
            .eq('sale_status', 'active')
            .gte('created_at', todayStart)
            .lte('created_at', todayEnd)
            .order('created_at', { ascending: false })
          if (isCashier && cashierId) q = (q as any).eq('cashier_id', cashierId)
          return q
        })(),

        // Outstanding debt
        supabase
          .from('customers')
          .select('total_debt')
          .in('shop_id', shopIds),

        // Last 7 days sales (for top products + chart fallback)
        supabase
          .from('sales')
          .select('id, total, amount_paid, created_at, sale_items(product_name, quantity, subtotal)')
          .in('shop_id', shopIds)
          .eq('sale_status', 'active')
          .gte('created_at', weekStartISO)
          .lte('created_at', todayEnd),

        // Stock alerts
        supabase
          .from('products')
          .select('id, name, name_hausa, quantity, low_stock_threshold, unit, selling_price, buying_price, shop_id')
          .in('shop_id', shopIds)
          .eq('is_active', true)
          .lte('quantity', shop?.low_stock_threshold || 10)
          .order('quantity', { ascending: true }),

        // Today's debt repayments (payments on OLD sales only)
        supabase
          .from('payments')
          .select('id, amount, paid_at, method, sales!inner(shop_id, created_at, customers(name))')
          .gte('paid_at', todayStart)
          .lte('paid_at', todayEnd)
          .order('paid_at', { ascending: false }),

        // Actual cash received via admin route (for weekly chart)
        fetch(`/api/dashboard/payments-today?shop_ids=${shopIds.join(',')}&start=${encodeURIComponent(todayStart)}&end=${encodeURIComponent(todayEnd)}&week_start=${encodeURIComponent(weekStartISO)}`),
      ])

      const paymentsApiOk = paymentsRes.ok
      const paymentsData = paymentsApiOk
        ? await paymentsRes.json()
        : { todayTotal: 0, weekPayments: [] as { date: string; amount: number }[] }

      // ── Process results ─────────────────────────────────────────
      const outOf = (stockData || []).filter((p: any) => p.quantity === 0) as unknown as Product[]
      const lowSt = (stockData || []).filter((p: any) => p.quantity > 0) as unknown as Product[]

      const salesArr = (todaySales || []) as unknown as Sale[]
      const salesCount = salesArr.length
      const debt = (debtData || []).reduce((s: number, c: any) => s + Number(c.total_debt), 0)

      // Revenue = face value of all sales created today
      const revenue = salesArr.reduce((s, sale: any) => s + Number(sale.total), 0)

      // Build repayment feed items — only payments on sales created BEFORE today
      // (payments on today's sales = normal payment validation, not a debt repayment)
      const repaymentItems: RepaymentFeedItem[] = (todayPaymentsRaw || [])
        .filter((p: any) => {
          if (!shopIds.includes(p.sales?.shop_id)) return false
          const saleDate = p.sales?.created_at ? new Date(p.sales.created_at) : null
          return saleDate ? saleDate < new Date(todayStart) : false
        })
        .map((p: any) => ({
          type: 'repayment' as const,
          id: p.id,
          amount: Number(p.amount),
          paid_at: p.paid_at,
          method: p.method,
          customerName: p.sales?.customers?.name || '—',
        }))

      const last7 = Array.from({ length: 7 }, (_, i) => subDays(today, 6 - i))
      const dayMap: Record<string, { revenue: number; sales: number }> = {}
      last7.forEach(d => { dayMap[format(d, 'yyyy-MM-dd')] = { revenue: 0, sales: 0 } })
      ;(weekSales || []).forEach((sale: any) => {
        const key = format(parseISO(sale.created_at), 'yyyy-MM-dd')
        if (dayMap[key]) { dayMap[key].sales += 1 }
      })

      if (paymentsApiOk) {
        // Preferred: actual cash received per day (includes debt repayments)
        ;(paymentsData.weekPayments as { date: string; amount: number }[]).forEach(p => {
          if (dayMap[p.date]) dayMap[p.date].revenue += p.amount
        })
      } else {
        // Fallback: sum amount_paid per day from weekSales
        ;(weekSales || []).forEach((sale: any) => {
          const key = format(parseISO(sale.created_at), 'yyyy-MM-dd')
          if (dayMap[key]) dayMap[key].revenue += Number(sale.amount_paid)
        })
      }
      const revData: RevenueDataPoint[] = last7.map(d => ({
        date: format(d, 'EEE'),
        revenue: dayMap[format(d, 'yyyy-MM-dd')].revenue,
        sales: dayMap[format(d, 'yyyy-MM-dd')].sales,
      }))

      const totals: Record<string, TopProduct> = {}
      ;(weekSales || []).forEach((sale: any) => {
        ;(sale.sale_items || []).forEach((item: any) => {
          if (!totals[item.product_name]) totals[item.product_name] = { name: item.product_name, quantity: 0, revenue: 0 }
          totals[item.product_name].quantity += Number(item.quantity)
          totals[item.product_name].revenue += Number(item.subtotal)
        })
      })
      const tops = Object.values(totals).sort((a, b) => b.revenue - a.revenue).slice(0, 5)

      applyDashData(salesCount, revenue, debt, salesArr, repaymentItems, revData, tops, lowSt, outOf)

      writeDashCache({ shopKey, todaySalesCount: salesCount, todayRevenue: revenue,
        outstandingDebt: debt, recentSales: salesArr, repaymentItems,
        revenueData: revData, topProducts: tops, lowStock: lowSt, outOfStock: outOf })

    } finally {
      loadingRef.current = false
      setFirstLoad(false)
      setRefreshing(false)
    }
  }, [shopIds.join(','), shop?.low_stock_threshold, applyDashData, profile?.role, profile?.id])

  // Initial load when shopIds become available
  useEffect(() => {
    if (shopIds.length > 0) loadDashboard()
  }, [loadDashboard])

  // Auto-refresh when user comes back to this tab
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible' && shopIds.length > 0) loadDashboard(true)
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [loadDashboard])

  const handleRefresh = () => loadDashboard(true)

  const isCashierView = profile?.role === 'cashier'
  useDashboardRealtime(shop?.id || null, {
    onNewSale: (sale) => {
      if (shopIds.includes(sale.shop_id || '')) {
        // Cashier only counts their own sales; owner/viewer counts all
        const isOwnSale = !isCashierView || sale.cashier_id === profile?.id
        if (isOwnSale) {
          setRecentSales(prev => [sale, ...prev])
          setTodaySalesCount(prev => prev + 1)
          setTodayRevenue(prev => prev + Number(sale.total))
        }
        if (!isCashierView) {
          toast({ title: `Nouvelle vente: ${formatNaira(sale.total)}`, description: `#${sale.sale_number}`, variant: 'success' })
        }
      }
    },
    onPaymentUpdate: async (payment: any) => {
      try {
        const { data: sale } = await supabase
          .from('sales')
          .select('shop_id, created_at, customers(name)')
          .eq('id', payment.sale_id)
          .single()
        if (!sale || !shopIds.includes(sale.shop_id)) return
        // Only add as repayment if the sale was created before today
        const saleDate = new Date((sale as any).created_at)
        if (saleDate >= startOfDay(new Date())) return
        const item: RepaymentFeedItem = {
          type: 'repayment',
          id: payment.id,
          amount: Number(payment.amount),
          paid_at: payment.paid_at || new Date().toISOString(),
          method: payment.method,
          customerName: (sale as any).customers?.name || '—',
        }
        setRepaymentFeed(prev => [item, ...prev])
      } catch { /* ignore */ }
    },
    onProductUpdate: (product) => {
      const threshold = shop?.low_stock_threshold || 10
      if (product.quantity === 0) {
        toast({ title: `⚠️ ${product.name} en rupture de stock!`, variant: 'destructive' })
      } else if (product.quantity <= threshold) {
        toast({ title: `${product.name}: plus que ${product.quantity} en stock` })
      }
    },
  })

  // Show skeleton only on very first load before any data arrives.
  // Never blank on authLoading — token refreshes must not erase the dashboard.
  if (firstLoad) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-24 rounded-lg" />)}
        </div>
        <Skeleton className="h-10 rounded-lg" />
        <Skeleton className="h-52 rounded-lg" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="font-bold text-lg text-foreground">{t('dashboard.title')}</h1>
          <p className="text-xs text-muted-foreground">
            {new Date().toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' })}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* Shop filter — visible si l'owner a plusieurs boutiques */}
          {userShops.length > 1 && (
            <div className="relative">
              <button
                onClick={() => setShopPickerOpen(o => !o)}
                className="flex items-center gap-2 rounded-lg border bg-card px-3 py-2 text-sm font-medium shadow-sm hover:bg-accent transition-colors"
              >
                <Store className="h-4 w-4 text-northcode-blue dark:text-blue-400" />
                <span className="max-w-[140px] truncate">{activeShopLabel}</span>
                <ChevronDown className={cn('h-3.5 w-3.5 text-muted-foreground transition-transform', shopPickerOpen && 'rotate-180')} />
              </button>

              {shopPickerOpen && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setShopPickerOpen(false)} />
                  <div className="absolute right-0 top-full z-20 mt-1 w-52 rounded-xl border bg-card shadow-lg p-1.5">
                    <button
                      onClick={() => { setDashboardShopFilter(null); setShopPickerOpen(false) }}
                      className={cn(
                        'w-full flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm text-left transition-colors',
                        !dashboardShopFilter ? 'bg-northcode-blue-muted dark:bg-blue-950/40 text-northcode-blue dark:text-blue-400 font-medium' : 'hover:bg-accent text-foreground/80'
                      )}
                    >
                      <span>{t('dashboard.all_shops')}</span>
                      {!dashboardShopFilter && <Check className="h-3.5 w-3.5" />}
                    </button>
                    {userShops.map(s => (
                      <button
                        key={s.id}
                        onClick={() => { setDashboardShopFilter(s.id); setShopPickerOpen(false) }}
                        className={cn(
                          'w-full flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm text-left transition-colors',
                          dashboardShopFilter === s.id ? 'bg-northcode-blue-muted dark:bg-blue-950/40 text-northcode-blue dark:text-blue-400 font-medium' : 'hover:bg-accent text-foreground/80'
                        )}
                      >
                        <span className="truncate">{s.name}</span>
                        {dashboardShopFilter === s.id && <Check className="h-3.5 w-3.5" />}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

          <Button
            variant="ghost"
            size="icon"
            onClick={handleRefresh}
            disabled={refreshing}
            className={refreshing ? 'animate-spin' : ''}
          >
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Metric cards */}
      <MetricCards
        todayRevenue={todayRevenue}
        todaySalesCount={todaySalesCount}
        lowStockCount={lowStockProducts.length + outOfStockProducts.length}
        outstandingDebt={outstandingDebt}
        role={profile?.role || 'viewer'}
        isCashier={isCashierView}
      />

      {/* Stock alerts */}
      <StockAlerts lowStockProducts={lowStockProducts} outOfStockProducts={outOfStockProducts} />

      {/* Charts — only for owner */}
      {profile?.role === 'owner' && (
        <div className="grid gap-4 md:grid-cols-2">
          <RevenueChart data={revenueData} />
          <TopProductsChart data={topProducts} />
        </div>
      )}

      {/* Recent sales */}
      {(profile?.role === 'owner' || profile?.role === 'viewer') && (
        <RecentSalesFeed
          items={[
            ...recentSales.map(s => ({ ...s, type: 'sale' as const })),
            ...repaymentFeed,
          ].sort((a, b) => {
            const tA = a.type === 'repayment' ? a.paid_at : (a as Sale).created_at
            const tB = b.type === 'repayment' ? b.paid_at : (b as Sale).created_at
            return new Date(tB).getTime() - new Date(tA).getTime()
          })}
          role={profile?.role || 'viewer'}
        />
      )}
    </div>
  )
}

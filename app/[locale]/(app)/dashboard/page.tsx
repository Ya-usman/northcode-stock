'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { createClient } from '@/lib/supabase/client'
import { useAuthContext as useAuth } from '@/lib/contexts/auth-context'
import { useDashboardRealtime } from '@/lib/hooks/use-realtime'
import { MetricCards } from '@/components/dashboard/metric-cards'
import { RevenueChart } from '@/components/dashboard/revenue-chart'
import { TopProductsChart } from '@/components/dashboard/top-products-chart'
import { ExpenseRevenueChart } from '@/components/dashboard/expense-revenue-chart'
import { RecentSalesFeed, type RepaymentFeedItem, type FeedItem, type PendingSaleFeedItem } from '@/components/dashboard/recent-sales-feed'
import { StockAlerts } from '@/components/dashboard/stock-alerts'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/use-toast'
import { RefreshCw } from 'lucide-react'
import { format, subDays, startOfDay, endOfDay, startOfMonth, endOfMonth, parseISO } from 'date-fns'
import type { Sale, Product, RevenueDataPoint, TopProduct } from '@/lib/types/database'
import { useCurrency } from '@/lib/hooks/use-currency'
import { cn } from '@/lib/utils/cn'
import { PlanStatusBanner } from '@/components/dashboard/plan-status-banner'

import { useRolePermissions } from '@/lib/hooks/use-role-permissions'
import { useOffline } from '@/lib/offline/use-offline'
import { useRefetchOnReconnect } from '@/lib/hooks/use-refetch-on-reconnect'
import { getPendingSales, type PendingSale } from '@/lib/offline/db'

const supabase = createClient() as any

// ── Dashboard cache (stale-while-revalidate) ────────────────────────────────
const DASH_CACHE_KEY = 'dashboard_cache_v1'
interface DashCache {
  shopKey: string
  todayRevenue: number; todaySalesCount: number; outstandingDebt: number
  revenueData: RevenueDataPoint[]; topProducts: TopProduct[]
  lowStock: Product[]; outOfStock: Product[]
  recentSales: Sale[]; repaymentItems: RepaymentFeedItem[]
  monthExpenses?: number; monthRevenue?: number; monthGlobalRevenue?: number
  savedAt: number
}
function readDashCache(shopKey: string): DashCache | null {
  try {
    const raw = localStorage.getItem(DASH_CACHE_KEY)
    if (!raw) return null
    const c: DashCache = JSON.parse(raw)
    // Online: cache valid 10 min (stale-while-revalidate). Offline: accept up to 24h.
    const ttl = navigator.onLine ? 600_000 : 24 * 60 * 60 * 1000
    if (c.shopKey !== shopKey || Date.now() - c.savedAt > ttl) return null
    return c
  } catch { return null }
}

// Stale-only read: used at mount to pre-fill UI immediately.
// Ignores TTL — loadDashboard will always refresh in background anyway.
function readDashCacheStale(shopKey: string): DashCache | null {
  try {
    const raw = localStorage.getItem(DASH_CACHE_KEY)
    if (!raw) return null
    const c: DashCache = JSON.parse(raw)
    if (c.shopKey !== shopKey) return null
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
  const { profile, shop, userShops, dashboardShopFilter, roleInActiveShop, loading: authLoading } = useAuth()
  const { fmt: formatNaira } = useCurrency()
  const { toast } = useToast()

  // Compute shopIds before useState so the lazy initializer can read the cache key
  const shopIds = dashboardShopFilter
    ? [dashboardShopFilter]
    : userShops.map(s => s.id).filter(Boolean)

  // Read stale cache synchronously at mount — shows data instantly even if TTL expired.
  // loadDashboard always refreshes in background, so stale data is fine here.
  const [mountCache] = useState<DashCache | null>(() => {
    if (!profile?.id || shopIds.length === 0) return null
    return readDashCacheStale(`${profile.id}:${shopIds.join(',')}`)
  })

  const [firstLoad, setFirstLoad] = useState(!mountCache && shopIds.length > 0)
  const [refreshing, setRefreshing] = useState(false)
  // navigator.onLine / the browser 'online' event are unreliable (notably in
  // the Capacitor Android WebView) — useOffline() actively verifies instead.
  const { isOnline, pendingCount } = useOffline()

  // Offline sales sitting in the IndexedDB queue, not yet synced — added on
  // top of todayRevenue/todaySalesCount and the recent-sales feed below
  // (never merged into the base state itself) so this recomputes cleanly
  // every time instead of risking double-counting if it re-ran more than
  // once for the same pending sale.
  const [pendingSalesToday, setPendingSalesToday] = useState<PendingSale[]>([])
  const pendingTodayRevenue = pendingSalesToday.reduce((s, sale) => s + sale.total, 0)
  const pendingTodayCount = pendingSalesToday.length

  const [todayRevenue, setTodayRevenue] = useState<number | null>(mountCache?.todayRevenue ?? null)
  const [todaySalesCount, setTodaySalesCount] = useState<number | null>(mountCache?.todaySalesCount ?? null)
  const [repaymentFeed, setRepaymentFeed] = useState<RepaymentFeedItem[]>(mountCache?.repaymentItems ?? [])
  const [outstandingDebt, setOutstandingDebt] = useState<number | null>(mountCache?.outstandingDebt ?? null)
  const [recentSales, setRecentSales] = useState<Sale[]>(mountCache?.recentSales ?? [])
  const [revenueData, setRevenueData] = useState<RevenueDataPoint[]>(mountCache?.revenueData ?? [])
  const [topProducts, setTopProducts] = useState<TopProduct[]>(mountCache?.topProducts ?? [])
  const [lowStockProducts, setLowStockProducts] = useState<Product[]>(mountCache?.lowStock ?? [])
  const [outOfStockProducts, setOutOfStockProducts] = useState<Product[]>(mountCache?.outOfStock ?? [])
  const [monthExpenses, setMonthExpenses]           = useState<number | null>(mountCache?.monthExpenses ?? null)
  const [monthRevenue, setMonthRevenue]             = useState<number | null>(mountCache?.monthRevenue ?? null)
  const [monthGlobalRevenue, setMonthGlobalRevenue] = useState<number | null>(mountCache?.monthGlobalRevenue ?? null)


  // Track in-flight request to avoid stale updates
  const loadingRef = useRef(false)
  // Timestamp (ms) when the last API fetch started — realtime events older than this
  // are already captured by the fetch and must not be double-counted.
  const lastFetchStartRef = useRef<number>(0)

  const applyDashData = useCallback((
    salesCount: number, revenue: number, debt: number,
    sales: Sale[], repayments: RepaymentFeedItem[], revData: RevenueDataPoint[], tops: TopProduct[],
    low: Product[], out: Product[], expenses = 0, mRevenue = 0, mGlobalRevenue = 0
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
    setMonthExpenses(expenses)
    setMonthRevenue(mRevenue)
    setMonthGlobalRevenue(mGlobalRevenue)
  }, [])

  const loadDashboard = useCallback(async (quiet = false) => {
    if (shopIds.length === 0) return

    // On manual refresh: immediately clear skeleton so rapid presses can't re-show it
    if (quiet) setFirstLoad(false)

    const shopKey = `${profile?.id}:${shopIds.join(',')}`

    // ── Serve cache immediately (stale-while-revalidate) ──────────────────
    // On initial load: use stale read (ignores 10-min TTL) so any existing
    // cache clears the skeleton instantly while fresh data loads in the background.
    // On manual refresh (quiet=true): skip cache — user wants fresh data now.
    if (!quiet) {
      const cached = readDashCacheStale(shopKey)
      if (cached) {
        applyDashData(cached.todaySalesCount, cached.todayRevenue, cached.outstandingDebt,
          cached.recentSales, cached.repaymentItems ?? [], cached.revenueData, cached.topProducts, cached.lowStock, cached.outOfStock,
          cached.monthExpenses ?? 0, cached.monthRevenue ?? 0, cached.monthGlobalRevenue ?? 0)
        setFirstLoad(false)
      }
    }

    // Don't fetch from network when offline
    if (!isOnline) {
      setFirstLoad(false)
      setRefreshing(false)
      return
    }

    // Don't start a new network fetch if one is already in flight
    if (loadingRef.current) return
    loadingRef.current = true
    lastFetchStartRef.current = Date.now()

    const isCashier = (roleInActiveShop ?? profile?.role) === 'cashier'
    const cashierId = profile?.id

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
        { data: expensesRaw },
        { data: monthSalesRaw },
        { data: monthGlobalRaw },
      ] = await Promise.all([
        // Today's sales — cashier sees only their own; owner/viewer sees all
        (() => {
          let q = supabase
            .from('sales')
            .select('id, sale_number, total, amount_paid, balance, payment_method, payment_status, sale_status, created_at, customers(name), cashier_id, shop_id')
            .in('shop_id', shopIds)
            .eq('sale_status', 'active')
            .gte('created_at', todayStart)
            .lte('created_at', todayEnd)
            .order('created_at', { ascending: false })
          if (isCashier && cashierId) q = q.eq('cashier_id', cashierId)
          return q
        })(),

        // Outstanding debt
        supabase
          .from('customers')
          .select('total_debt')
          .in('shop_id', shopIds),

        // Last 7 days sales (for top products + chart) — cashier sees own only
        (() => {
          let q = supabase
            .from('sales')
            .select('id, total, amount_paid, created_at, sale_items(product_id, product_name, quantity, subtotal)')
            .in('shop_id', shopIds)
            .eq('sale_status', 'active')
            .gte('created_at', weekStartISO)
            .lte('created_at', todayEnd)
          if (isCashier && cashierId) q = q.eq('cashier_id', cashierId)
          return q
        })(),

        // Stock alerts
        supabase
          .from('products')
          .select('id, name, name_hausa, quantity, low_stock_threshold, unit, selling_price, buying_price, shop_id')
          .in('shop_id', shopIds)
          .eq('is_active', true)
          .lte('quantity', shop?.low_stock_threshold || 10)
          .order('quantity', { ascending: true }),

        // Today's debt repayments — exclure les paiements sur ventes annulées
        supabase
          .from('payments')
          .select('id, sale_id, amount, paid_at, method, sales!inner(shop_id, sale_number, created_at, total, balance, payment_method, customers(name), sale_status)')
          .eq('is_repayment', true)
          .gte('paid_at', todayStart)
          .lte('paid_at', todayEnd)
          .order('paid_at', { ascending: false }),

        // Actual cash received via admin route (for weekly chart) — scoped to
        // the cashier's own sales when applicable, so their chart attributes
        // revenue to the day it was actually paid (same accurate method used
        // for owners/managers), not just the day the sale was created.
        fetch(`/api/dashboard/payments-today?shop_ids=${shopIds.join(',')}&start=${encodeURIComponent(todayStart)}&end=${encodeURIComponent(todayEnd)}&week_start=${encodeURIComponent(weekStartISO)}${isCashier && cashierId ? `&cashier_id=${cashierId}` : ''}`),

        // Month expenses (owner only) — 1st to last day of current month
        !isCashier ? supabase
          .from('expenses')
          .select('amount')
          .in('shop_id', shopIds)
          .eq('is_recurring', false)
          .gte('date', startOfMonth(today).toISOString().slice(0, 10))
          .lte('date', endOfMonth(today).toISOString().slice(0, 10)) : Promise.resolve({ data: [] }),

        // Month collections — cash actually received this month, sourced from
        // the payments ledger (paid_at). Filtering sales by created_at instead
        // would miss a repayment collected this month on a sale created in a
        // previous month (same fix as sales/history's "Encaissé" — see there
        // for the full explanation). received_by scopes to what THIS user
        // personally collected, matching the "Mes encaissements" label.
        supabase
          .from('payments')
          .select('amount, sales!inner(shop_id, sale_status)')
          .in('sales.shop_id', shopIds)
          .eq('sales.sale_status', 'active')
          .eq('received_by', cashierId)
          .gte('paid_at', startOfMonth(today).toISOString())
          .lte('paid_at', endOfMonth(today).toISOString()),

        // Global month collections (all cashiers) — for roles with revenue_chart access
        supabase
          .from('payments')
          .select('amount, sales!inner(shop_id, sale_status)')
          .in('sales.shop_id', shopIds)
          .eq('sales.sale_status', 'active')
          .gte('paid_at', startOfMonth(today).toISOString())
          .lte('paid_at', endOfMonth(today).toISOString()),

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
      const expensesTotal         = (expensesRaw    || []).reduce((s: number, e: any) => s + Number(e.amount), 0)
      const monthRevenueTotal       = (monthSalesRaw  || []).reduce((s: number, e: any) => s + Number(e.amount), 0)
      const monthGlobalRevenueTotal = (monthGlobalRaw || []).reduce((s: number, e: any) => s + Number(e.amount), 0)

      // Cashier's own sale IDs (already filtered by cashier_id above)
      const cashierSaleIds = new Set(salesArr.map((s: any) => s.id))

      // Build repayment feed items — exclure les paiements sur ventes annulées
      const repaymentItems: RepaymentFeedItem[] = (todayPaymentsRaw || [])
        .filter((p: any) => {
          if (!shopIds.includes(p.sales?.shop_id)) return false
          if (p.sales?.sale_status === 'cancelled') return false
          if (isCashier) return cashierSaleIds.has(p.sale_id)
          return true
        })
        .map((p: any) => ({
          type: 'repayment' as const,
          id: p.id,
          sale_id: p.sale_id,
          sale_number: p.sales?.sale_number || undefined,
          amount: Number(p.amount),
          paid_at: p.paid_at,
          method: p.method,
          customerName: p.sales?.customers?.name || '—',
          totalDebt: p.sales?.total !== undefined ? Number(p.sales.total) : undefined,
          remainingBalance: p.sales?.balance !== undefined ? Number(p.sales.balance) : undefined,
        }))

      const last7 = Array.from({ length: 7 }, (_, i) => subDays(today, 6 - i))
      const dayMap: Record<string, { revenue: number; sales: number; repayments: number }> = {}
      last7.forEach(d => { dayMap[format(d, 'yyyy-MM-dd')] = { revenue: 0, sales: 0, repayments: 0 } })
      ;(weekSales || []).forEach((sale: any) => {
        const key = format(parseISO(sale.created_at), 'yyyy-MM-dd')
        if (dayMap[key]) { dayMap[key].sales += 1 }
      })

      if (paymentsApiOk) {
        // Actual cash received per day (includes debt repayments paid on a
        // later day than the sale itself) — accurate for both owners/managers
        // (shop-wide) and cashiers (scoped to their own sales via cashier_id).
        // Repayment events are tracked separately from new-sale count, so the
        // tooltip can show both "X new sale(s)" and "Y credit repayment(s)"
        // instead of a single count that hides which is which.
        ;(paymentsData.weekPayments as { date: string; amount: number; repaymentsCount: number }[]).forEach(p => {
          if (dayMap[p.date]) {
            dayMap[p.date].revenue += p.amount
            dayMap[p.date].repayments += p.repaymentsCount
          }
        })
      } else {
        // API failed: approximate by summing amount_paid attributed to the
        // sale's creation date — less accurate for credit sales paid off on a
        // later day, but better than showing nothing.
        ;(weekSales || []).forEach((sale: any) => {
          const key = format(parseISO(sale.created_at), 'yyyy-MM-dd')
          if (dayMap[key]) dayMap[key].revenue += Number(sale.amount_paid)
        })
      }
      const revData: RevenueDataPoint[] = last7.map(d => ({
        date: format(d, 'EEE'),
        revenue: dayMap[format(d, 'yyyy-MM-dd')].revenue,
        sales: dayMap[format(d, 'yyyy-MM-dd')].sales,
        repayments: dayMap[format(d, 'yyyy-MM-dd')].repayments,
      }))

      // Grouped by product_id (falling back to product_name for free-text items
      // with no product_id) — grouping by name alone would split a renamed
      // product's sales across two entries, or merge two different products
      // that happen to share the same name.
      const totals: Record<string, TopProduct> = {}
      ;(weekSales || []).forEach((sale: any) => {
        ;(sale.sale_items || []).forEach((item: any) => {
          const key = item.product_id ?? item.product_name
          if (!totals[key]) totals[key] = { name: item.product_name, quantity: 0, revenue: 0 }
          totals[key].quantity += Number(item.quantity)
          totals[key].revenue += Number(item.subtotal)
        })
      })
      const tops = Object.values(totals).sort((a, b) => b.revenue - a.revenue).slice(0, 5)

      // Revenue = sum of amount_paid on today's active sales (consistent with Reports page).
      // Using salesArr (not payments table) avoids realtime/API race conditions and
      // matches what the user expects: sales revenue, not total cash flow.
      const revenue = salesArr.reduce((s: number, sale: any) => s + Number(sale.amount_paid), 0)

      applyDashData(salesCount, revenue, debt, salesArr, repaymentItems, revData, tops, lowSt, outOf, expensesTotal, monthRevenueTotal, monthGlobalRevenueTotal)

      writeDashCache({ shopKey, todaySalesCount: salesCount, todayRevenue: revenue,
        outstandingDebt: debt, recentSales: salesArr, repaymentItems,
        revenueData: revData, topProducts: tops, lowStock: lowSt, outOfStock: outOf,
        monthExpenses: expensesTotal, monthRevenue: monthRevenueTotal, monthGlobalRevenue: monthGlobalRevenueTotal })

    } finally {
      loadingRef.current = false
      setFirstLoad(false)
      setRefreshing(false)
    }
  }, [shopIds.join(','), shop?.low_stock_threshold, applyDashData, roleInActiveShop, profile?.role, profile?.id, isOnline])

  // Initial load when shopIds become available
  useEffect(() => {
    if (shopIds.length > 0) loadDashboard()
  }, [loadDashboard])

  // Merge today's not-yet-synced offline sales into the displayed totals —
  // getPendingSales() already filters to unsynced only (lib/offline/db.ts),
  // so a sale that finishes syncing naturally drops out of this sum right
  // as it starts being counted in the server-fetched total instead: no
  // window where it's counted twice or not at all.
  useEffect(() => {
    if (shopIds.length === 0) return
    let cancelled = false
    const todayStart = startOfDay(new Date())
    Promise.all(shopIds.map(id => getPendingSales(id))).then(results => {
      if (cancelled) return
      setPendingSalesToday(results.flat().filter(sale => new Date(sale.created_at) >= todayStart))
    }).catch(() => {})
    return () => { cancelled = true }
  }, [shopIds.join(','), pendingCount])

  // Si auth est terminée mais aucune boutique disponible, débloquer le skeleton
  useEffect(() => {
    if (!authLoading && shopIds.length === 0) setFirstLoad(false)
  }, [authLoading, shopIds.length])

  // Timeout de sécurité : skeleton jamais bloqué plus de 1.5 secondes
  // After 1.5s the dashboard renders with zeros/empty while data loads in background.
  useEffect(() => {
    if (!firstLoad) return
    const t = setTimeout(() => setFirstLoad(false), 1500)
    return () => clearTimeout(t)
  }, [firstLoad])

  // Refresh on reconnect — isOnline comes from useOffline()'s actively-verified
  // check, unlike the raw 'online' event which is unreliable in the Capacitor
  // Android WebView.
  useRefetchOnReconnect(() => { if (shopIds.length > 0) loadDashboard(true) }, isOnline)

  // Auto-refresh when user comes back to this tab
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible' && shopIds.length > 0) loadDashboard(true)
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [loadDashboard])

  const handleRefresh = () => {
    if (loadingRef.current) {
      // Fetch already in flight — show spinner so the user gets feedback;
      // the in-flight fetch's finally block will clear it.
      setRefreshing(true)
      return
    }
    loadDashboard(true)
  }

  const isCashierView = (roleInActiveShop ?? profile?.role) === 'cashier'
  const { canAccess } = useRolePermissions()
  const canSeeRevenueChart = canAccess('revenue_chart')
  const canSeeExpenses = canAccess('expenses')
  useDashboardRealtime(shop?.id || null, {
    onNewSale: (sale) => {
      if (shopIds.includes(sale.shop_id || '')) {
        const isOwnSale = !isCashierView || sale.cashier_id === profile?.id
        if (isOwnSale) {
          setRecentSales(prev => [sale, ...prev])
          setTodaySalesCount(prev => (prev ?? 0) + 1)
          // Revenue is added by onPaymentUpdate when the payment record is inserted.
        }
        toast({ title: `Nouvelle vente: ${formatNaira(sale.total)}`, description: `#${sale.sale_number}`, variant: 'success' })
      }
    },
    onSaleCancelled: (sale) => {
      if (!shopIds.includes((sale as any).shop_id || '')) return
      setRecentSales(prev => prev.filter(s => s.id !== sale.id))
      setRepaymentFeed(prev => prev.filter(r => r.sale_id !== sale.id))
      setTodaySalesCount(prev => Math.max(0, (prev ?? 0) - 1))
      setTodayRevenue(prev => Math.max(0, (prev ?? 0) - Number((sale as any).amount_paid ?? 0)))
      try { localStorage.removeItem('dashboard_cache_v1') } catch {}
    },
    onPaymentUpdate: async (payment: any) => {
      try {
        // Skip payments that were already captured by the last API fetch
        // (race condition: realtime can deliver old events after a fetch completes)
        const paymentMs = new Date(payment.paid_at || 0).getTime()
        if (paymentMs < lastFetchStartRef.current) return

        const { data: sale } = await supabase
          .from('sales')
          .select('shop_id, created_at, total, balance, sale_status, customers(name)')
          .eq('id', payment.sale_id)
          .single()
        if (!sale || !shopIds.includes(sale.shop_id)) return
        if ((sale as any).sale_status === 'cancelled') return
        const item: RepaymentFeedItem = {
          type: 'repayment',
          id: payment.id,
          sale_id: payment.sale_id,
          amount: Number(payment.amount),
          paid_at: payment.paid_at || new Date().toISOString(),
          method: payment.method,
          customerName: (sale as any).customers?.name || '—',
          totalDebt: Number((sale as any).total),
          remainingBalance: Number((sale as any).balance),
        }
        setRepaymentFeed(prev => [item, ...prev])
        // All cash received today = revenue, including old-debt repayments
        setTodayRevenue(prev => (prev ?? 0) + Number(payment.amount))
        // Update the matching sale in recentSales so its balance/gauge reflects the payment
        setRecentSales(prev => prev.map((s: any) =>
          s.id === payment.sale_id
            ? { ...s, amount_paid: Number(s.amount_paid) + Number(payment.amount), balance: Math.max(0, Number(s.balance) - Number(payment.amount)), payment_status: Math.max(0, Number(s.balance) - Number(payment.amount)) === 0 ? 'paid' : 'partial' }
            : s
        ))
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
          <p className="text-xs text-muted-foreground">
            {new Date().toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' })}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* Mode indicator — "Toutes les boutiques" si le filtre est global */}
          {userShops.length > 1 && !dashboardShopFilter && (
            <span className="hidden sm:inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground select-none">
              {t('dashboard.all_shops')}
            </span>
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

      {/* Plan status banner — owner only */}
      {profile?.role === 'owner' && shop && (
        <PlanStatusBanner
          plan={shop.plan ?? null}
          trialEndsAt={shop.trial_ends_at ?? null}
          planExpiresAt={shop.plan_expires_at ?? null}
        />
      )}

      {/* Metric cards */}
      <MetricCards
        isLoading={todayRevenue === null}
        todayRevenue={(todayRevenue ?? 0) + pendingTodayRevenue}
        todaySalesCount={(todaySalesCount ?? 0) + pendingTodayCount}
        lowStockCount={lowStockProducts.length + outOfStockProducts.length}
        outstandingDebt={outstandingDebt ?? 0}
        monthExpenses={monthExpenses ?? 0}
        monthRevenue={monthRevenue ?? 0}
        monthGlobalRevenue={monthGlobalRevenue ?? 0}
        role={profile?.role || 'viewer'}
        isCashier={isCashierView}
        canRevenueChart={canSeeRevenueChart}
        canSeeExpenses={canSeeExpenses}
      />

      {/* Stock alerts */}
      {canAccess('widget_stock_alerts_list') && (
        <StockAlerts lowStockProducts={lowStockProducts} outOfStockProducts={outOfStockProducts} />
      )}

      {/* Charts */}
      {(canAccess('widget_dashboard_revenue_chart') || canAccess('widget_top_products_chart')) && (
        <div className="grid gap-4 md:grid-cols-2">
          {canAccess('widget_dashboard_revenue_chart') && <RevenueChart data={revenueData} />}
          {canAccess('widget_top_products_chart') && <TopProductsChart data={topProducts} />}
        </div>
      )}

      {/* Expense vs Revenue trend — owner or permitted roles */}
      {canSeeRevenueChart && <ExpenseRevenueChart />}

      {/* Recent sales */}
      {canAccess('widget_recent_sales') && (
        <RecentSalesFeed
          items={[
            ...recentSales.map(s => ({ ...s, type: 'sale' as const })),
            ...repaymentFeed,
            ...pendingSalesToday.map((s): PendingSaleFeedItem => ({
              type: 'pending_sale',
              id: s.local_id,
              total: s.total,
              payment_method: s.payment_method,
              customerName: s.customer_name || '',
              created_at: s.created_at,
            })),
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

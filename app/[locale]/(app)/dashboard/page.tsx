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
import { computeTopProducts } from '@/lib/dashboard/top-products'
import { useCurrency } from '@/lib/hooks/use-currency'
import { cn } from '@/lib/utils/cn'
import { PlanStatusBanner } from '@/components/dashboard/plan-status-banner'

import { useRolePermissions } from '@/lib/hooks/use-role-permissions'
import { useOffline } from '@/lib/offline/use-offline'
import { useRefetchOnReconnect } from '@/lib/hooks/use-refetch-on-reconnect'
import { useRefetchOnVisible } from '@/lib/hooks/use-refetch-on-visible'
import { getPendingSales, type PendingSale } from '@/lib/offline/db'
import { withTimeout } from '@/lib/utils/with-timeout'
import { getPageCache, setPageCache } from '@/lib/offline/page-cache'
import { PRODUCT_PUBLIC_COLUMNS } from '@/lib/products/columns'
import { SUPPLIER_PUBLIC_COLUMNS } from '@/lib/suppliers/columns'
import { runIdlePrefetch, type PrefetchTask } from '@/lib/utils/idle-prefetch'
import { onSalesDataChanged } from '@/lib/data-refresh'
import { GettingStarted } from '@/components/onboarding/getting-started'
import { TeamWelcome } from '@/components/onboarding/team-welcome'

const supabase = createClient() as any

// ── Dashboard cache (stale-while-revalidate) ────────────────────────────────
// Same shared cache as every other page (lib/offline/page-cache.ts) — the
// key itself is scoped per shop, so no per-entry shopKey/comparison logic
// is needed, and it inherits the standard 7-day hard cutoff instead of
// being read unboundedly stale.
interface DashCache {
  todayRevenue: number; todaySalesCount: number; outstandingDebt: number
  revenueData: RevenueDataPoint[]; topProducts: TopProduct[]
  lowStock: Product[]; outOfStock: Product[]
  recentSales: Sale[]; repaymentItems: RepaymentFeedItem[]
  monthExpenses?: number; monthRevenue?: number; monthGlobalRevenue?: number
}

export default function DashboardPage() {
  const t = useTranslations()
  const locale = useLocale()
  const { profile, shop, userShops, dashboardShopFilter, roleInActiveShop, loading: authLoading, effectiveShopIds } = useAuth()
  const { fmt: formatNaira } = useCurrency()
  const { toast } = useToast()

  // Compute shopIds before useState so the lazy initializer can read the cache key
  const shopIds = dashboardShopFilter
    ? [dashboardShopFilter]
    : userShops.map(s => s.id).filter(Boolean)

  // Read cache synchronously at mount — shows data instantly. loadDashboard
  // always refreshes in background, so up-to-7-day-old data is fine here.
  const [mountCache] = useState<DashCache | null>(() => {
    if (!profile?.id || shopIds.length === 0) return null
    return getPageCache<DashCache>(`dashboard_${profile.id}:${shopIds.join(',')}`)
  })

  const [firstLoad, setFirstLoad] = useState(!mountCache && shopIds.length > 0)
  const [refreshing, setRefreshing] = useState(false)
  // Graphique de la semaine en attente de la route serveur (les chiffres, eux, sont déjà là)
  const [weekChartPending, setWeekChartPending] = useState(false)
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

  // `silent` : rechargement discret déclenché par le temps réel (ni cache relu, ni roue qui tourne)
  const loadDashboard = useCallback(async (quiet = false, silent = false) => {
    if (shopIds.length === 0) return

    // On manual refresh: immediately clear skeleton so rapid presses can't re-show it
    if (quiet || silent) setFirstLoad(false)

    const shopKey = `${profile?.id}:${shopIds.join(',')}`
    const cacheKey = `dashboard_${shopKey}`

    // ── Serve cache immediately (stale-while-revalidate) ──────────────────
    // On initial load: any existing cache (up to the standard 7-day cutoff)
    // clears the skeleton instantly while fresh data loads in the background.
    // On manual refresh (quiet=true): skip cache — user wants fresh data now.
    if (!quiet && !silent) {
      const cached = getPageCache<DashCache>(cacheKey)
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

    if (quiet && !silent) setRefreshing(true)

    try {
      const today = new Date()
      const todayStart = startOfDay(today).toISOString()
      const todayEnd = endOfDay(today).toISOString()
      const sevenDaysAgo = subDays(today, 6)

      const weekStartISO = startOfDay(sevenDaysAgo).toISOString()

      // Argent réellement reçu, jour par jour (route serveur, pour le graphique
      // de la semaine) — pour un vendeur, limité à ses propres ventes. Lancé en
      // même temps que les lectures ci-dessous mais attendu À PART : les chiffres
      // ne doivent pas rester gris parce que cette route tarde.
      const paymentsPromise: Promise<Response | null> = fetch(`/api/dashboard/payments-today?shop_ids=${shopIds.join(',')}&start=${encodeURIComponent(todayStart)}&end=${encodeURIComponent(todayEnd)}&week_start=${encodeURIComponent(weekStartISO)}${isCashier && cashierId ? `&cashier_id=${cashierId}` : ''}`).catch(() => null)

      const summaryParams = new URLSearchParams({
        shop_ids: shopIds.join(','), day_start: todayStart, day_end: todayEnd,
        month_start: startOfMonth(today).toISOString(), month_end: endOfMonth(today).toISOString(),
      })
      const summaryPromise = fetch(`/api/dashboard/summary?${summaryParams}`).then(async r => {
        const j = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(j.error || 'summary')
        return j
      })

      // Ventes du jour, ventes de la semaine avec leurs lignes, dette clients : décidées et lues par le SERVEUR
      // (/api/dashboard/live, lot 2B du 26 oct. 2026) — avant : lues directement ici. Mêmes chiffres : vendeur et
      // magasinier limités à leurs ventes comme le faisait la base ; un bloc dont aucun widget n'est autorisé n'est
      // pas envoyé (null). Même forme de résultat qu'avant pour la suite du calcul.
      const liveParams = new URLSearchParams({ shop_ids: shopIds.join(','), day_start: todayStart, day_end: todayEnd, week_start: weekStartISO })
      const livePromise = fetch(`/api/dashboard/live?${liveParams}`).then(async r => {
        const j = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(j.error || 'live')
        return j
      })

      // ── All parallel queries ────────────────────────────────────
      const [
        todaySalesRes,
        debtRes,
        weekSalesRes,
        stockRes,
        todayPaymentsRes,
        expensesRes,
        monthSalesRes,
        monthGlobalRes,
      ] = await withTimeout(Promise.all([
        // Ventes du jour, dette clients, ventes des 7 derniers jours (graphique, meilleurs produits) : serveur
        livePromise.then((j: any) => ({ data: j.today_sales || [], error: null })),
        livePromise.then((j: any) => ({ data: j.outstanding_debt === null ? [] : [{ total_debt: j.outstanding_debt }], error: null })),
        livePromise.then((j: any) => ({ data: j.week_sales || [], error: null })),

        // Stock alerts
        supabase
          .from('products')
          .select('id, name, name_hausa, quantity, low_stock_threshold, unit, selling_price, shop_id')
          .in('shop_id', shopIds)
          .eq('is_active', true)
          .lte('quantity', shop?.low_stock_threshold || 10)
          .order('quantity', { ascending: true }),

        // Remboursements du jour, mes encaissements du mois, encaissé global du mois, dépenses du mois : décidés et
        // calculés par le SERVEUR (/api/dashboard/summary) selon le rôle et les réglages de CHAQUE boutique — avant :
        // lus directement ici, la base ne contrôlant que l'appartenance (un caissier recevait l'encaissé de toute la
        // boutique et les dépenses, même non affichés). Même forme de résultat qu'avant pour la suite du calcul.
        summaryPromise.then((j: any) => ({ data: j.repayments || [], error: null })),
        summaryPromise.then((j: any) => ({ data: j.month_expenses === null ? [] : [{ amount: j.month_expenses }], error: null })),
        summaryPromise.then((j: any) => ({ data: [{ amount: j.month_revenue_own ?? 0 }], error: null })),
        summaryPromise.then((j: any) => ({ data: [{ amount: j.month_global_revenue ?? 0 }], error: null })),

      ]), 20_000, 'Chargement du tableau de bord trop lent — réessayez.')

      // A transient auth/RLS hiccup (session mid-refresh right after the tab
      // resumes from background) can resolve a query successfully with
      // data: null instead of throwing — check every error explicitly so the
      // outer catch preserves whatever's already on screen (and in
      // dashboard_cache_v1) instead of silently overwriting it with zeros.
      const supaErr = todaySalesRes.error || debtRes.error || weekSalesRes.error || stockRes.error
        || todayPaymentsRes.error || expensesRes.error || monthSalesRes.error || monthGlobalRes.error
      if (supaErr) throw supaErr
      const { data: todaySales } = todaySalesRes
      const { data: debtData } = debtRes
      const { data: weekSales } = weekSalesRes
      const { data: stockData } = stockRes
      const { data: todayPaymentsRaw } = todayPaymentsRes
      const { data: expensesRaw } = expensesRes
      const { data: monthSalesRaw } = monthSalesRes
      const { data: monthGlobalRaw } = monthGlobalRes

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

      // Règle commune (lib/dashboard/top-products) : par fiche produit dans une
      // boutique, et une seule ligne par produit en vue « Toutes les boutiques ».
      const tops: TopProduct[] = computeTopProducts(weekSales as any)

      // Revenue = sum of amount_paid on today's active sales (consistent with Reports page).
      // Using salesArr (not payments table) avoids realtime/API race conditions and
      // matches what the user expects: sales revenue, not total cash flow.
      const revenue = salesArr.reduce((s: number, sale: any) => s + Number(sale.amount_paid), 0)

      // ── 1. Les chiffres : affichés dès que la base a répondu ──────────────
      setTodaySalesCount(salesCount)
      setTodayRevenue(revenue)
      setRecentSales(salesArr)
      setRepaymentFeed(repaymentItems)
      setOutstandingDebt(debt)
      setTopProducts(tops)
      setLowStockProducts(lowSt)
      setOutOfStockProducts(outOf)
      setMonthExpenses(expensesTotal)
      setMonthRevenue(monthRevenueTotal)
      setMonthGlobalRevenue(monthGlobalRevenueTotal)
      setFirstLoad(false)

      // ── 2. Le graphique de la semaine : dès que la route serveur a répondu ──
      setWeekChartPending(true)
      const paymentsRes = await withTimeout(paymentsPromise, 20_000, 'Chargement du graphique trop lent — réessayez.')
      const paymentsApiOk = !!paymentsRes && paymentsRes.ok
      const paymentsData = paymentsApiOk
        ? await paymentsRes!.json()
        : { todayTotal: 0, weekPayments: [] as { date: string; amount: number }[] }

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
        // Jour abrégé dans la langue de l'écran (« lun. », « Mon ») — jamais un format figé en anglais
        date: d.toLocaleDateString(locale, { weekday: 'short' }),
        revenue: dayMap[format(d, 'yyyy-MM-dd')].revenue,
        sales: dayMap[format(d, 'yyyy-MM-dd')].sales,
        repayments: dayMap[format(d, 'yyyy-MM-dd')].repayments,
      }))

      setRevenueData(revData)

      setPageCache<DashCache>(cacheKey, { todaySalesCount: salesCount, todayRevenue: revenue,
        outstandingDebt: debt, recentSales: salesArr, repaymentItems,
        revenueData: revData, topProducts: tops, lowStock: lowSt, outOfStock: outOf,
        monthExpenses: expensesTotal, monthRevenue: monthRevenueTotal, monthGlobalRevenue: monthGlobalRevenueTotal })

    } catch {
      // Timeout or network failure — the cache read above (if any) is
      // already on screen; nothing further to do. The finally block below
      // is what actually matters here: without it reachable, a hang would
      // leave loadingRef stuck true and permanently no-op every future
      // refresh (manual button, visibilitychange, reconnect) until a full
      // page reload — withTimeout turns that hang into a fast rejection so
      // finally always runs.
    } finally {
      loadingRef.current = false
      setFirstLoad(false)
      setRefreshing(false)
      setWeekChartPending(false)
    }
  }, [shopIds.join(','), shop?.low_stock_threshold, applyDashData, roleInActiveShop, profile?.role, profile?.id, isOnline])

  // Initial load when shopIds become available
  useEffect(() => {
    if (shopIds.length > 0) loadDashboard()
  }, [loadDashboard])

  // A sale created elsewhere (checkout, or synced from the offline queue)
  // calls notifySalesDataChanged() — refetch so this page doesn't need a
  // hard reload to show it, whether already mounted or freshly visited.
  // The realtime layer below (useDashboardRealtime) separately patches
  // state live while this page stays open.
  useEffect(() => onSalesDataChanged(() => loadDashboard()), [loadDashboard])

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
  useRefetchOnVisible(() => { if (shopIds.length > 0) loadDashboard(true) })

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

  // Réchauffe en arrière-plan le cache des quelques pages les plus visitées
  // après le dashboard (Fournisseurs, Stock, Clients, Crédits) — mêmes clés de
  // cache que leurs pages respectives, remplies une par une pendant les temps
  // d'inactivité du navigateur (voir runIdlePrefetch) plutôt que toutes en
  // même temps, et jamais hors-ligne ou en mode économie de données. Le temps
  // que l'utilisateur y navigue, les données sont déjà là et le squelette de
  // chargement ne s'affiche quasiment jamais. Best-effort partout : en cas
  // d'échec d'une tâche, la page concernée charge normalement comme avant.
  useEffect(() => {
    if (!effectiveShopIds.length) return
    const ids = effectiveShopIds
    const tasks: PrefetchTask[] = []

    if (canAccess('suppliers')) {
      tasks.push({
        cacheKey: `suppliers_${ids.join(',')}`,
        run: async () => {
          const [suppliersRes, productsRes] = await Promise.all([
            supabase.from('suppliers').select(SUPPLIER_PUBLIC_COLUMNS).in('shop_id', ids).order('name'),
            supabase.from('products').select('id, name, selling_price, quantity, unit, supplier_id, shop_id').in('shop_id', ids).eq('is_active', true),
          ])
          if (suppliersRes.error || productsRes.error) return
          setPageCache(`suppliers_${ids.join(',')}`, { suppliers: suppliersRes.data || [], products: productsRes.data || [] })
        },
      })
    }

    if (canAccess('stock')) {
      tasks.push({
        cacheKey: `stock_${ids.join(',')}`,
        run: async () => {
          const [prodsRes, catsRes, supsRes] = await Promise.all([
            supabase.from('products').select(`${PRODUCT_PUBLIC_COLUMNS}, categories(name, color), suppliers(name)`).in('shop_id', ids).eq('is_active', true).order('name'),
            supabase.from('categories').select('*').in('shop_id', ids).order('name'),
            supabase.from('suppliers').select(SUPPLIER_PUBLIC_COLUMNS).in('shop_id', ids).order('name'),
          ])
          if (prodsRes.error || catsRes.error || supsRes.error) return
          setPageCache(`stock_${ids.join(',')}`, { prods: prodsRes.data || [], cats: catsRes.data || [], sups: supsRes.data || [] })
        },
      })
    }

    if (canAccess('customers')) {
      tasks.push({
        cacheKey: `customers_${ids.join(',')}`,
        run: async () => {
          const res = await supabase.from('customers').select('*').in('shop_id', ids).order('name')
          if (res.error) return
          setPageCache(`customers_${ids.join(',')}`, res.data || [])
        },
      })
    }

    if (canAccess('payments')) {
      tasks.push({
        cacheKey: `debtors_${ids.join(',')}`,
        run: async () => {
          const res = await fetch(`/api/payments/debts?shop_ids=${ids.join(',')}`)
          if (!res.ok) return
          const data = await res.json()
          setPageCache(`debtors_${ids.join(',')}`, data.debtors || [])
        },
      })
    }

    runIdlePrefetch(tasks, isOnline)
  }, [effectiveShopIds.join(','), isOnline])
  // Rechargement discret après un événement temps réel : un seul pour une rafale (1,5 s)
  const silentTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const scheduleSilentRefresh = () => {
    if (silentTimer.current) clearTimeout(silentTimer.current)
    silentTimer.current = setTimeout(() => { silentTimer.current = null; loadDashboard(false, true) }, 1500)
  }
  useEffect(() => () => { if (silentTimer.current) clearTimeout(silentTimer.current) }, [])
  useDashboardRealtime(shop?.id || null, {
    onNewSale: (sale) => {
      if (shopIds.includes(sale.shop_id || '')) {
        const isOwnSale = !isCashierView || sale.cashier_id === profile?.id
        if (isOwnSale) {
          setRecentSales(prev => [sale, ...prev])
          setTodaySalesCount(prev => (prev ?? 0) + 1)
          // Revenue is added by onPaymentUpdate when the payment record is inserted.
        }
        // Pas de message ici : la notification « nouvelle vente » est celle de la
        // coquille (app-layout), qui exclut ses propres ventes — y compris celles
        // que cet appareil synchronise — et regroupe les rafales.
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
    onPaymentUpdate: (payment: any) => {
      // Paiements déjà pris en compte par la dernière lecture : ignorés (le temps réel peut livrer un événement ancien)
      const paymentMs = new Date(payment.paid_at || 0).getTime()
      if (paymentMs < lastFetchStartRef.current) return
      // Avant : la vente du paiement était relue ici, directement dans la base. Désormais le serveur refait le calcul
      // (rechargement discret, regroupé si plusieurs paiements arrivent ensemble) — mêmes règles que l'ouverture.
      scheduleSilentRefresh()
    },
    onProductUpdate: (product) => {
      const threshold = shop?.low_stock_threshold || 10
      if (product.quantity === 0) {
        toast({ title: t('dashboard.out_of_stock_toast', { product: product.name }), variant: 'destructive' })
      } else if (product.quantity <= threshold) {
        toast({ title: t('dashboard.low_stock_toast', { product: product.name, qty: product.quantity }) })
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

      {/* Guide « Bien démarrer » : propriétaire d'un compte qui débute (s'efface de lui-même) */}
      <GettingStarted />
      {/* Employé qui arrive : le tour qui correspond à son poste */}
      <TeamWelcome />

      {/* Plan status banner — owner only */}
      {profile?.role === 'owner' && shop && (
        <PlanStatusBanner
          plan={shop.plan ?? null}
          trialEndsAt={shop.trial_ends_at ?? null}
          planExpiresAt={shop.plan_expires_at ?? null}
          isInternal={shop.is_internal}
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
          {canAccess('widget_dashboard_revenue_chart') && (
            <RevenueChart
              data={revenueData}
              loading={weekChartPending}
              shopIds={effectiveShopIds}
              cashierId={isCashierView ? (profile?.id ?? undefined) : undefined}
            />
          )}
          {canAccess('widget_top_products_chart') && (
            <TopProductsChart
              data={topProducts}
              shopIds={effectiveShopIds}
              cashierId={isCashierView ? (profile?.id ?? undefined) : undefined}
            />
          )}
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

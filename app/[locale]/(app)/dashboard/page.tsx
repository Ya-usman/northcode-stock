'use client'

import { useEffect, useState, useCallback } from 'react'
import { useTranslations } from 'next-intl'
import { createClient } from '@/lib/supabase/client'
import { useAuthContext as useAuth } from '@/lib/contexts/auth-context'
import { useDashboardRealtime } from '@/lib/hooks/use-realtime'
import { MetricCards } from '@/components/dashboard/metric-cards'
import { RevenueChart } from '@/components/dashboard/revenue-chart'
import { TopProductsChart } from '@/components/dashboard/top-products-chart'
import { RecentSalesFeed } from '@/components/dashboard/recent-sales-feed'
import { StockAlerts } from '@/components/dashboard/stock-alerts'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/use-toast'
import { RefreshCw, Store, ChevronDown, Check } from 'lucide-react'
import { format, subDays, startOfDay, endOfDay } from 'date-fns'
import type { Sale, Product, RevenueDataPoint, TopProduct } from '@/lib/types/database'
import { useCurrency } from '@/lib/hooks/use-currency'
import { cn } from '@/lib/utils/cn'

const supabase = createClient() as any

export default function DashboardPage() {
  const t = useTranslations()
  const { profile, shop, userShops, loading: authLoading } = useAuth()
  const { fmt: formatNaira } = useCurrency()
  const { toast } = useToast()

  // Shop filter: null = all shops
  const [selectedShopId, setSelectedShopId] = useState<string | null>(null)
  const [shopPickerOpen, setShopPickerOpen] = useState(false)

  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [todayRevenue, setTodayRevenue] = useState(0)
  const [todaySalesCount, setTodaySalesCount] = useState(0)
  const [outstandingDebt, setOutstandingDebt] = useState(0)
  const [recentSales, setRecentSales] = useState<Sale[]>([])
  const [revenueData, setRevenueData] = useState<RevenueDataPoint[]>([])
  const [topProducts, setTopProducts] = useState<TopProduct[]>([])
  const [lowStockProducts, setLowStockProducts] = useState<Product[]>([])
  const [outOfStockProducts, setOutOfStockProducts] = useState<Product[]>([])

  // Determine which shop IDs to query
  const shopIds = selectedShopId
    ? [selectedShopId]
    : userShops.map(s => s.id).filter(Boolean)

  const activeShopLabel = selectedShopId
    ? userShops.find(s => s.id === selectedShopId)?.name || 'Boutique'
    : userShops.length > 1 ? 'Toutes les boutiques' : (shop?.name || 'Boutique')

  const loadDashboard = useCallback(async () => {
    if (shopIds.length === 0) return

    const today = new Date()
    const todayStart = startOfDay(today).toISOString()
    const todayEnd = endOfDay(today).toISOString()

    // Today's sales (active only)
    const { data: todaySales } = await supabase
      .from('sales')
      .select('id, total, amount_paid, balance, payment_method, payment_status, sale_status, created_at, customers(name), cashier_id, shop_id')
      .in('shop_id', shopIds)
      .eq('sale_status', 'active')
      .gte('created_at', todayStart)
      .lte('created_at', todayEnd)
      .order('created_at', { ascending: false })

    setTodaySalesCount(todaySales?.length || 0)
    setTodayRevenue((todaySales || []).reduce((s: number, sale: any) => s + Number(sale.total), 0))
    setRecentSales((todaySales || []) as unknown as Sale[])

    // Outstanding debt
    const { data: debtData } = await supabase
      .from('customers')
      .select('total_debt')
      .in('shop_id', shopIds)
    setOutstandingDebt((debtData || []).reduce((s: number, c: any) => s + Number(c.total_debt), 0))

    // Revenue last 7 days
    const last7 = Array.from({ length: 7 }, (_, i) => subDays(today, 6 - i))
    const revenueArr: RevenueDataPoint[] = []
    for (const day of last7) {
      const { data } = await supabase
        .from('sales')
        .select('total')
        .in('shop_id', shopIds)
        .eq('sale_status', 'active')
        .gte('created_at', startOfDay(day).toISOString())
        .lte('created_at', endOfDay(day).toISOString())
      revenueArr.push({
        date: format(day, 'EEE'),
        revenue: (data || []).reduce((s: number, d: any) => s + Number(d.total), 0),
        sales: data?.length || 0,
      })
    }
    setRevenueData(revenueArr)

    // Top 5 products (last 7 days)
    const { data: weekSales } = await supabase
      .from('sales')
      .select('id')
      .in('shop_id', shopIds)
      .eq('sale_status', 'active')
      .gte('created_at', subDays(today, 7).toISOString())

    if (weekSales && weekSales.length > 0) {
      const { data: items } = await supabase
        .from('sale_items')
        .select('product_name, quantity, subtotal')
        .in('sale_id', (weekSales as any[]).map((s: any) => s.id))

      const totals: Record<string, TopProduct> = {}
      ;(items || []).forEach((item: any) => {
        if (!totals[item.product_name]) {
          totals[item.product_name] = { name: item.product_name, quantity: 0, revenue: 0 }
        }
        totals[item.product_name].quantity += Number(item.quantity)
        totals[item.product_name].revenue += Number(item.subtotal)
      })
      setTopProducts(Object.values(totals).sort((a, b) => b.revenue - a.revenue).slice(0, 5))
    } else {
      setTopProducts([])
    }

    // Stock alerts (per selected shop or all)
    const threshold = shop?.low_stock_threshold || 10
    const { data: stockData } = await supabase
      .from('products')
      .select('id, name, name_hausa, quantity, low_stock_threshold, unit, selling_price, buying_price, shop_id')
      .in('shop_id', shopIds)
      .eq('is_active', true)
      .lte('quantity', threshold)
      .order('quantity', { ascending: true })

    setOutOfStockProducts((stockData || []).filter((p: any) => p.quantity === 0) as unknown as Product[])
    setLowStockProducts((stockData || []).filter((p: any) => p.quantity > 0) as unknown as Product[])
  }, [shopIds.join(','), shop?.low_stock_threshold])

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      await loadDashboard()
      setLoading(false)
    }
    load()
  }, [loadDashboard])

  const handleRefresh = async () => {
    setRefreshing(true)
    await loadDashboard()
    setRefreshing(false)
  }

  useDashboardRealtime(shop?.id || null, {
    onNewSale: (sale) => {
      if (shopIds.includes(sale.shop_id || '')) {
        setRecentSales(prev => [sale, ...prev])
        setTodaySalesCount(prev => prev + 1)
        setTodayRevenue(prev => prev + Number(sale.total))
        toast({ title: `Nouvelle vente: ${formatNaira(sale.total)}`, description: `#${sale.sale_number}`, variant: 'success' })
      }
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

  if (authLoading || loading) {
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
            {new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* Shop filter — visible si l'owner a plusieurs boutiques */}
          {userShops.length > 1 && (
            <div className="relative">
              <button
                onClick={() => setShopPickerOpen(o => !o)}
                className="flex items-center gap-2 rounded-lg border bg-white px-3 py-2 text-sm font-medium shadow-sm hover:bg-gray-50 transition-colors"
              >
                <Store className="h-4 w-4 text-northcode-blue" />
                <span className="max-w-[140px] truncate">{activeShopLabel}</span>
                <ChevronDown className={cn('h-3.5 w-3.5 text-muted-foreground transition-transform', shopPickerOpen && 'rotate-180')} />
              </button>

              {shopPickerOpen && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setShopPickerOpen(false)} />
                  <div className="absolute right-0 top-full z-20 mt-1 w-52 rounded-xl border bg-white shadow-lg p-1.5">
                    {/* All shops option */}
                    <button
                      onClick={() => { setSelectedShopId(null); setShopPickerOpen(false) }}
                      className={cn(
                        'w-full flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm text-left transition-colors',
                        !selectedShopId ? 'bg-northcode-blue-muted text-northcode-blue font-medium' : 'hover:bg-gray-50 text-gray-700'
                      )}
                    >
                      <span>Toutes les boutiques</span>
                      {!selectedShopId && <Check className="h-3.5 w-3.5" />}
                    </button>
                    {userShops.map(s => (
                      <button
                        key={s.id}
                        onClick={() => { setSelectedShopId(s.id); setShopPickerOpen(false) }}
                        className={cn(
                          'w-full flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm text-left transition-colors',
                          selectedShopId === s.id ? 'bg-northcode-blue-muted text-northcode-blue font-medium' : 'hover:bg-gray-50 text-gray-700'
                        )}
                      >
                        <span className="truncate">{s.name}</span>
                        {selectedShopId === s.id && <Check className="h-3.5 w-3.5" />}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

          <Button variant="ghost" size="icon" onClick={handleRefresh} className={refreshing ? 'animate-spin' : ''}>
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
        <RecentSalesFeed sales={recentSales} role={profile?.role || 'viewer'} />
      )}
    </div>
  )
}

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
import { RefreshCw } from 'lucide-react'
import { format, subDays, startOfDay, endOfDay } from 'date-fns'
import type { Sale, Product, RevenueDataPoint, TopProduct } from '@/lib/types/database'
import { useCurrency } from '@/lib/hooks/use-currency'

// Singleton client — évite les recréations à chaque render
const supabase = createClient()

export default function DashboardPage() {
  const t = useTranslations()
  const { profile, shop, loading: authLoading } = useAuth()
  const { fmt: formatNaira } = useCurrency()
  const { toast } = useToast()

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

  const loadDashboard = useCallback(async () => {
    if (!shop?.id) return

    const today = new Date()
    const todayStart = startOfDay(today).toISOString()
    const todayEnd = endOfDay(today).toISOString()

    // Today's sales
    const { data: todaySales } = await supabase
      .from('sales')
      .select('id, total, amount_paid, balance, payment_method, payment_status, created_at, customers(name), cashier_id')
      .eq('shop_id', shop.id)
      .gte('created_at', todayStart)
      .lte('created_at', todayEnd)
      .order('created_at', { ascending: false })

    setTodaySalesCount(todaySales?.length || 0)
    setTodayRevenue(todaySales?.reduce((s, sale) => s + Number(sale.total), 0) || 0)
    setRecentSales((todaySales || []) as unknown as Sale[])

    // Outstanding debt
    const { data: debtData } = await supabase
      .from('customers')
      .select('total_debt')
      .eq('shop_id', shop.id)
    setOutstandingDebt(debtData?.reduce((s, c) => s + Number(c.total_debt), 0) || 0)

    // Revenue last 7 days
    const last7 = Array.from({ length: 7 }, (_, i) => subDays(today, 6 - i))
    const revenueArr: RevenueDataPoint[] = []
    for (const day of last7) {
      const { data } = await supabase
        .from('sales')
        .select('total')
        .eq('shop_id', shop.id)
        .gte('created_at', startOfDay(day).toISOString())
        .lte('created_at', endOfDay(day).toISOString())
      revenueArr.push({
        date: format(day, 'EEE'),
        revenue: data?.reduce((s, d) => s + Number(d.total), 0) || 0,
        sales: data?.length || 0,
      })
    }
    setRevenueData(revenueArr)

    // Top 5 products (last 7 days)
    const { data: saleItems } = await supabase
      .from('sale_items')
      .select('product_name, quantity, subtotal, sale_id')
      .in('sale_id', (todaySales || []).map((s: any) => s.id).concat(
        // also include the last 7 days' sales
        revenueArr.map(() => '').filter(Boolean)
      ))

    // Better approach: query sale_items via join on last 7 days sales
    const { data: weekSales } = await supabase
      .from('sales')
      .select('id')
      .eq('shop_id', shop.id)
      .gte('created_at', subDays(today, 7).toISOString())

    if (weekSales && weekSales.length > 0) {
      const { data: items } = await supabase
        .from('sale_items')
        .select('product_name, quantity, subtotal')
        .in('sale_id', weekSales.map(s => s.id))

      const totals: Record<string, TopProduct> = {}
      items?.forEach(item => {
        if (!totals[item.product_name]) {
          totals[item.product_name] = { name: item.product_name, quantity: 0, revenue: 0 }
        }
        totals[item.product_name].quantity += Number(item.quantity)
        totals[item.product_name].revenue += Number(item.subtotal)
      })
      const sorted = Object.values(totals).sort((a, b) => b.revenue - a.revenue).slice(0, 5)
      setTopProducts(sorted)
    }

    // Stock alerts
    const threshold = shop.low_stock_threshold || 10
    const { data: stockData } = await supabase
      .from('products')
      .select('id, name, name_hausa, quantity, low_stock_threshold, unit, selling_price, buying_price')
      .eq('shop_id', shop.id)
      .eq('is_active', true)
      .lte('quantity', threshold)
      .order('quantity', { ascending: true })

    setOutOfStockProducts((stockData || []).filter(p => p.quantity === 0) as unknown as Product[])
    setLowStockProducts((stockData || []).filter(p => p.quantity > 0) as unknown as Product[])
  }, [shop?.id, supabase])

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

  // Realtime subscription
  useDashboardRealtime(shop?.id || null, {
    onNewSale: (sale) => {
      setRecentSales(prev => [sale, ...prev])
      setTodaySalesCount(prev => prev + 1)
      setTodayRevenue(prev => prev + Number(sale.total))
      toast({
        title: `New sale: ${formatNaira(sale.total)}`,
        description: `Sale #${sale.sale_number}`,
        variant: 'success',
      })
    },
    onProductUpdate: (product) => {
      const threshold = shop?.low_stock_threshold || 10
      if (product.quantity === 0) {
        toast({
          title: `⚠️ ${product.name} is out of stock!`,
          variant: 'destructive',
        })
      } else if (product.quantity <= threshold) {
        toast({
          title: `${product.name}: only ${product.quantity} left`,
          description: 'Consider restocking soon',
        })
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
        <Skeleton className="h-52 rounded-lg" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Header with refresh */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-bold text-lg text-foreground">{t('dashboard.title')}</h1>
          <p className="text-xs text-muted-foreground">
            {new Date().toLocaleDateString('en-NG', { weekday: 'long', day: 'numeric', month: 'long' })}
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={handleRefresh}
          className={refreshing ? 'animate-spin' : ''}
        >
          <RefreshCw className="h-4 w-4" />
        </Button>
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
      <StockAlerts
        lowStockProducts={lowStockProducts}
        outOfStockProducts={outOfStockProducts}
      />

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

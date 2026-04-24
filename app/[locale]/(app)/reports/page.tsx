'use client'

import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { FileDown } from 'lucide-react'
import {
  PieChart, Pie, Cell,
  Tooltip, ResponsiveContainer,
} from 'recharts'
import { createClient } from '@/lib/supabase/client'
import { useAuthContext as useAuth } from '@/lib/contexts/auth-context'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { useCurrency } from '@/lib/hooks/use-currency'
import { generateReportPDFBlob } from '@/lib/utils/pdf'
import { sharePDFNative } from '@/lib/utils/native-share'
import { format, startOfDay, endOfDay, startOfMonth, startOfWeek, startOfQuarter, startOfYear } from 'date-fns'

const PIE_COLORS = ['#60a5fa', '#D4AF37', '#16A34A', '#DC2626', '#a78bfa']

export default function ReportsPage() {
  const t = useTranslations()
  const { shop } = useAuth()
  const { fmt: formatNaira } = useCurrency()
  const supabase = createClient() as any

  const [dateFilter, setDateFilter] = useState('month')
  const [loading, setLoading] = useState(true)
  const [exporting, setExporting] = useState(false)

  const [revenueByMethod, setRevenueByMethod] = useState<{ name: string; value: number }[]>([])
  const [topProducts, setTopProducts] = useState<{ name: string; qty: number; revenue: number }[]>([])
  const [stockValuation, setStockValuation] = useState({ buyingValue: 0, sellingValue: 0, potentialProfit: 0 })
  const [cashierPerf, setCashierPerf] = useState<{ name: string; sales: number; revenue: number }[]>([])
  const [totals, setTotals] = useState({ revenue: 0, profit: 0, sales: 0 })

  const getDateRange = () => {
    const now = new Date()
    const end = endOfDay(now)
    let start: Date
    switch (dateFilter) {
      case 'today':    start = startOfDay(now); break
      case 'week':     start = startOfWeek(now, { weekStartsOn: 1 }); break
      case 'month':    start = startOfMonth(now); break
      case 'quarter':  start = startOfQuarter(now); break
      case 'semester': start = new Date(now.getFullYear(), now.getMonth() < 6 ? 0 : 6, 1); break
      case 'year':     start = startOfYear(now); break
      default:         start = startOfMonth(now)
    }
    return { start: start.toISOString(), end: end.toISOString() }
  }

  const fetchReports = async () => {
    if (!shop?.id) return
    setLoading(true)
    const { start, end } = getDateRange()

    // Sales in period
    const { data: salesRaw } = await supabase
      .from('sales')
      .select('id, total, payment_method, created_at, cashier_id')
      .eq('shop_id', shop.id)
      .eq('sale_status', 'active')
      .gte('created_at', start)
      .lte('created_at', end)
    const sales = (salesRaw || []) as Array<{ id: string; total: number; payment_method: string; created_at: string; cashier_id: string | null }>

    // Revenue by method
    const byMethod: Record<string, number> = {}
    sales.forEach(s => { byMethod[s.payment_method] = (byMethod[s.payment_method] || 0) + Number(s.total) })
    setRevenueByMethod(
      Object.entries(byMethod).map(([name, value]) => ({
        name: name.charAt(0).toUpperCase() + name.slice(1),
        value,
      }))
    )

    const totalRevenue = sales.reduce((s, sale) => s + Number(sale.total), 0)

    // Sale items for profit calculation (only if there are sales)
    let totalProfit = 0
    let prodTotals: Record<string, { qty: number; revenue: number }> = {}

    if (sales.length > 0) {
      const { data: items } = await supabase
        .from('sale_items')
        .select('product_name, quantity, unit_price, subtotal, product_id, sale_id')
        .in('sale_id', sales.map(s => s.id))

      const safeItems = (items || []) as Array<{ product_name: string; quantity: number; unit_price: number; subtotal: number; product_id: string | null; sale_id: string }>

      // Product buying prices for profit
      const productIds = [...new Set(safeItems.map(i => i.product_id).filter(Boolean) as string[])]
      let priceMap: Record<string, number> = {}
      if (productIds.length > 0) {
        const { data: prodPrices } = await supabase
          .from('products').select('id, buying_price').in('id', productIds)
        ;(prodPrices || []).forEach((p: any) => { priceMap[p.id] = Number(p.buying_price) })
      }

      totalProfit = safeItems.reduce((s, item) => {
        const buyingCost = (priceMap[item.product_id || ''] || 0) * Number(item.quantity)
        return s + Number(item.subtotal) - buyingCost
      }, 0)

      // Top 10 products
      safeItems.forEach(item => {
        if (!prodTotals[item.product_name]) prodTotals[item.product_name] = { qty: 0, revenue: 0 }
        prodTotals[item.product_name].qty += Number(item.quantity)
        prodTotals[item.product_name].revenue += Number(item.subtotal)
      })
    }

    setTotals({ revenue: totalRevenue, profit: totalProfit, sales: sales.length })
    setTopProducts(
      Object.entries(prodTotals)
        .map(([name, { qty, revenue }]) => ({ name, qty, revenue }))
        .sort((a, b) => b.revenue - a.revenue)
        .slice(0, 10)
    )

    // Stock valuation
    const { data: allProducts } = await supabase
      .from('products').select('quantity, buying_price, selling_price')
      .eq('shop_id', shop.id).eq('is_active', true)
    const buyingValue = (allProducts || []).reduce((s: number, p: any) => s + Number(p.quantity) * Number(p.buying_price), 0)
    const sellingValue = (allProducts || []).reduce((s: number, p: any) => s + Number(p.quantity) * Number(p.selling_price), 0)
    setStockValuation({ buyingValue, sellingValue, potentialProfit: sellingValue - buyingValue })

    // Cashier performance
    const cashierMap: Record<string, { sales: number; revenue: number }> = {}
    sales.forEach(s => {
      if (!s.cashier_id) return
      if (!cashierMap[s.cashier_id]) cashierMap[s.cashier_id] = { sales: 0, revenue: 0 }
      cashierMap[s.cashier_id].sales += 1
      cashierMap[s.cashier_id].revenue += Number(s.total)
    })
    const cashierIds = Object.keys(cashierMap)
    if (cashierIds.length > 0) {
      const { data: profiles } = await supabase.from('profiles').select('id, full_name').in('id', cashierIds)
      setCashierPerf(
        cashierIds.map(id => ({
          name: (profiles || []).find((p: any) => p.id === id)?.full_name || 'Unknown',
          ...cashierMap[id],
        })).sort((a, b) => b.revenue - a.revenue)
      )
    } else {
      setCashierPerf([])
    }

    setLoading(false)
  }

  useEffect(() => { fetchReports() }, [shop?.id, dateFilter])

  const exportPDF = async () => {
    setExporting(true)
    try {
      const { start, end } = getDateRange()
      const dateRange = `${format(new Date(start), 'dd MMM yyyy')} – ${format(new Date(end), 'dd MMM yyyy')}`
      const { blob, fileName } = await generateReportPDFBlob({
        shopName: shop!.name,
        dateRange,
        sections: [
          {
            title: t('reports.revenue_by_method'),
            headers: [t('reports.col_method'), formatNaira(0).replace('0', '').trim() || shop?.currency || '', t('reports.col_share')],
            rows: revenueByMethod.map(m => [
              m.name,
              formatNaira(m.value),
              totals.revenue > 0 ? `${((m.value / totals.revenue) * 100).toFixed(1)}%` : '0%',
            ]),
          },
          {
            title: t('reports.top_products'),
            headers: [t('reports.col_product'), t('reports.col_qty'), t('reports.col_revenue')],
            rows: topProducts.map(p => [p.name, p.qty, formatNaira(p.revenue)]),
          },
          {
            title: t('reports.stock_valuation'),
            headers: ['Métrique', 'Valeur'],
            rows: [
              [t('reports.buying_value'), formatNaira(stockValuation.buyingValue)],
              [t('reports.selling_value'), formatNaira(stockValuation.sellingValue)],
              [t('reports.potential_profit'), formatNaira(stockValuation.potentialProfit)],
            ],
          },
          {
            title: t('reports.cashier_performance'),
            headers: [t('reports.col_cashier'), t('reports.col_sales'), t('reports.col_revenue')],
            rows: cashierPerf.map(c => [c.name, c.sales, formatNaira(c.revenue)]),
          },
        ],
      })
      await sharePDFNative(blob, fileName, `Rapport — ${shop!.name}`)
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <Select value={dateFilter} onValueChange={setDateFilter}>
          <SelectTrigger className="w-[170px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="today">{t('reports.today')}</SelectItem>
            <SelectItem value="week">{t('reports.this_week')}</SelectItem>
            <SelectItem value="month">{t('reports.this_month')}</SelectItem>
            <SelectItem value="quarter">{t('reports.this_quarter')}</SelectItem>
            <SelectItem value="semester">{t('reports.this_semester')}</SelectItem>
            <SelectItem value="year">{t('reports.this_year')}</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" onClick={exportPDF} loading={exporting} className="gap-2">
          <FileDown className="h-4 w-4" />
          {t('actions.export_pdf')}
        </Button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: t('reports.total_revenue'), value: formatNaira(totals.revenue), color: 'text-northcode-blue dark:text-blue-400' },
          { label: t('reports.est_profit'), value: formatNaira(totals.profit), color: 'text-green-600' },
          { label: t('reports.transactions'), value: String(totals.sales), color: 'text-foreground' },
        ].map(item => (
          <Card key={item.label} className="border-0 shadow-sm">
            <CardContent className="p-3 text-center">
              <p className="text-xs text-muted-foreground leading-tight">{item.label}</p>
              <p className={`text-sm sm:text-lg font-bold mt-0.5 ${item.color}`}>{loading ? '…' : item.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {loading ? (
        <div className="space-y-4">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-48" />)}</div>
      ) : (
        <>
          {/* Revenue by payment method */}
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">{t('reports.revenue_by_method')}</CardTitle>
            </CardHeader>
            <CardContent>
              {revenueByMethod.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-6">{t('reports.no_data')}</p>
              ) : (
                <div className="flex flex-col sm:flex-row items-center gap-4">
                  <ResponsiveContainer width="100%" height={200}>
                    <PieChart>
                      <Pie data={revenueByMethod} cx="50%" cy="50%" innerRadius={50} outerRadius={80} dataKey="value">
                        {revenueByMethod.map((_, idx) => <Cell key={idx} fill={PIE_COLORS[idx % PIE_COLORS.length]} />)}
                      </Pie>
                      <Tooltip formatter={(v: any) => formatNaira(v)} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="space-y-2 min-w-[140px]">
                    {revenueByMethod.map((m, idx) => (
                      <div key={m.name} className="flex items-center gap-2 text-sm">
                        <span className="h-3 w-3 rounded-full flex-shrink-0" style={{ background: PIE_COLORS[idx % PIE_COLORS.length] }} />
                        <span className="text-muted-foreground">{m.name}</span>
                        <span className="font-medium ml-auto">{formatNaira(m.value)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Top selling products */}
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">{t('reports.top_products')}</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {topProducts.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-6">{t('reports.no_data')}</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-8">{t('reports.col_rank')}</TableHead>
                      <TableHead>{t('reports.col_product')}</TableHead>
                      <TableHead className="text-right">{t('reports.col_qty')}</TableHead>
                      <TableHead className="text-right">{t('reports.col_revenue')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {topProducts.map((p, idx) => (
                      <TableRow key={p.name}>
                        <TableCell className="text-muted-foreground text-sm">{idx + 1}</TableCell>
                        <TableCell className="text-sm font-medium">{p.name}</TableCell>
                        <TableCell className="text-right text-sm">{p.qty}</TableCell>
                        <TableCell className="text-right text-sm font-medium text-northcode-blue dark:text-blue-400">{formatNaira(p.revenue)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          {/* Stock valuation */}
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">{t('reports.stock_valuation')}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-3 gap-3 text-center">
                {[
                  { label: t('reports.buying_value'), value: formatNaira(stockValuation.buyingValue), color: 'text-muted-foreground' },
                  { label: t('reports.selling_value'), value: formatNaira(stockValuation.sellingValue), color: 'text-northcode-blue dark:text-blue-400' },
                  { label: t('reports.potential_profit'), value: formatNaira(stockValuation.potentialProfit), color: 'text-green-600' },
                ].map(item => (
                  <div key={item.label} className="rounded-lg bg-muted/30 p-3">
                    <p className="text-xs text-muted-foreground leading-tight">{item.label}</p>
                    <p className={`text-xs sm:text-sm font-bold mt-1 ${item.color}`}>{item.value}</p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Cashier performance */}
          {cashierPerf.length > 0 && (
            <Card className="border-0 shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">{t('reports.cashier_performance')}</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('reports.col_cashier')}</TableHead>
                      <TableHead className="text-right">{t('reports.col_sales')}</TableHead>
                      <TableHead className="text-right">{t('reports.col_revenue')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {cashierPerf.map(c => (
                      <TableRow key={c.name}>
                        <TableCell className="font-medium text-sm">{c.name}</TableCell>
                        <TableCell className="text-right">{c.sales}</TableCell>
                        <TableCell className="text-right font-medium text-northcode-blue dark:text-blue-400">{formatNaira(c.revenue)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  )
}

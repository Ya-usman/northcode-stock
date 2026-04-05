'use client'

import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { FileDown, BarChart2 } from 'lucide-react'
import {
  PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend,
} from 'recharts'
import { createClient } from '@/lib/supabase/client'
import { useAuthContext as useAuth } from '@/lib/contexts/auth-context'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { formatNaira, profitMargin } from '@/lib/utils/currency'
import { generateReportPDF } from '@/lib/utils/pdf'
import { format, subDays, startOfDay, endOfDay, startOfMonth, startOfWeek } from 'date-fns'

const PIE_COLORS = ['#0A2F6E', '#D4AF37', '#16A34A', '#DC2626', '#7BB3F0']

export default function ReportsPage() {
  const t = useTranslations()
  const { shop, profile } = useAuth()
  const supabase = createClient()

  const [dateFilter, setDateFilter] = useState('month')
  const [loading, setLoading] = useState(true)
  const [exporting, setExporting] = useState(false)

  const [revenueByMethod, setRevenueByMethod] = useState<{ name: string; value: number }[]>([])
  const [profitData, setProfitData] = useState<{ date: string; revenue: number; profit: number }[]>([])
  const [topProducts, setTopProducts] = useState<{ name: string; qty: number; revenue: number }[]>([])
  const [stockValuation, setStockValuation] = useState({ buyingValue: 0, sellingValue: 0, potentialProfit: 0 })
  const [cashierPerf, setCashierPerf] = useState<{ name: string; sales: number; revenue: number }[]>([])
  const [totals, setTotals] = useState({ revenue: 0, profit: 0, sales: 0 })

  const getDateRange = () => {
    const now = new Date()
    const end = endOfDay(now)
    let start: Date
    switch (dateFilter) {
      case 'week': start = startOfWeek(now); break
      case 'month': start = startOfMonth(now); break
      case '3months': start = subDays(now, 90); break
      case 'year': start = new Date(now.getFullYear(), 0, 1); break
      default: start = startOfMonth(now)
    }
    return { start: start.toISOString(), end: end.toISOString() }
  }

  const fetchReports = async () => {
    if (!shop?.id) return
    setLoading(true)
    const { start, end } = getDateRange()

    // Sales in period
    const { data: sales } = await supabase
      .from('sales')
      .select('id, total, payment_method, created_at, cashier_id')
      .eq('shop_id', shop.id)
      .gte('created_at', start)
      .lte('created_at', end)

    // Revenue by method
    const byMethod: Record<string, number> = {}
    sales?.forEach(s => { byMethod[s.payment_method] = (byMethod[s.payment_method] || 0) + Number(s.total) })
    setRevenueByMethod(
      Object.entries(byMethod).map(([name, value]) => ({
        name: name.charAt(0).toUpperCase() + name.slice(1),
        value,
      }))
    )

    const totalRevenue = sales?.reduce((s, sale) => s + Number(sale.total), 0) || 0

    // Sale items for profit calculation
    const { data: items } = await supabase
      .from('sale_items')
      .select('product_name, quantity, unit_price, subtotal, product_id, sale_id')
      .in('sale_id', (sales || []).map(s => s.id))

    // Product buying prices for profit
    const productIds = [...new Set(items?.map(i => i.product_id).filter(Boolean))]
    const { data: prodPrices } = await supabase
      .from('products').select('id, buying_price').in('id', productIds)
    const priceMap: Record<string, number> = {}
    prodPrices?.forEach(p => { priceMap[p.id] = Number(p.buying_price) })

    const totalProfit = items?.reduce((s, item) => {
      const buyingCost = (priceMap[item.product_id || ''] || 0) * Number(item.quantity)
      return s + Number(item.subtotal) - buyingCost
    }, 0) || 0

    setTotals({ revenue: totalRevenue, profit: totalProfit, sales: sales?.length || 0 })

    // Top 10 products
    const prodTotals: Record<string, { qty: number; revenue: number }> = {}
    items?.forEach(item => {
      if (!prodTotals[item.product_name]) prodTotals[item.product_name] = { qty: 0, revenue: 0 }
      prodTotals[item.product_name].qty += Number(item.quantity)
      prodTotals[item.product_name].revenue += Number(item.subtotal)
    })
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
    const buyingValue = allProducts?.reduce((s, p) => s + Number(p.quantity) * Number(p.buying_price), 0) || 0
    const sellingValue = allProducts?.reduce((s, p) => s + Number(p.quantity) * Number(p.selling_price), 0) || 0
    setStockValuation({ buyingValue, sellingValue, potentialProfit: sellingValue - buyingValue })

    // Cashier performance
    const cashierMap: Record<string, { sales: number; revenue: number }> = {}
    sales?.forEach(s => {
      if (!s.cashier_id) return
      if (!cashierMap[s.cashier_id]) cashierMap[s.cashier_id] = { sales: 0, revenue: 0 }
      cashierMap[s.cashier_id].sales += 1
      cashierMap[s.cashier_id].revenue += Number(s.total)
    })
    const cashierIds = Object.keys(cashierMap)
    if (cashierIds.length) {
      const { data: profiles } = await supabase.from('profiles').select('id, full_name').in('id', cashierIds)
      setCashierPerf(
        cashierIds.map(id => ({
          name: profiles?.find(p => p.id === id)?.full_name || 'Unknown',
          ...cashierMap[id],
        })).sort((a, b) => b.revenue - a.revenue)
      )
    }

    setLoading(false)
  }

  useEffect(() => { fetchReports() }, [shop?.id, dateFilter])

  const exportPDF = async () => {
    setExporting(true)
    const { start, end } = getDateRange()
    await generateReportPDF({
      shopName: shop!.name,
      dateRange: `${format(new Date(start), 'dd MMM yyyy')} – ${format(new Date(end), 'dd MMM yyyy')}`,
      sections: [
        {
          title: 'Revenue by Payment Method',
          headers: ['Method', 'Amount (₦)', '% Share'],
          rows: revenueByMethod.map(m => [
            m.name,
            formatNaira(m.value),
            `${((m.value / totals.revenue) * 100).toFixed(1)}%`,
          ]),
        },
        {
          title: 'Top Selling Products',
          headers: ['Product', 'Qty Sold', 'Revenue (₦)'],
          rows: topProducts.map(p => [p.name, p.qty, formatNaira(p.revenue)]),
        },
        {
          title: 'Stock Valuation',
          headers: ['Metric', 'Value'],
          rows: [
            ['Buying Value', formatNaira(stockValuation.buyingValue)],
            ['Selling Value', formatNaira(stockValuation.sellingValue)],
            ['Potential Profit', formatNaira(stockValuation.potentialProfit)],
          ],
        },
        {
          title: 'Cashier Performance',
          headers: ['Name', 'Sales Count', 'Revenue (₦)'],
          rows: cashierPerf.map(c => [c.name, c.sales, formatNaira(c.revenue)]),
        },
      ],
    })
    setExporting(false)
  }

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <Select value={dateFilter} onValueChange={setDateFilter}>
          <SelectTrigger className="w-[150px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="week">This Week</SelectItem>
            <SelectItem value="month">This Month</SelectItem>
            <SelectItem value="3months">Last 3 Months</SelectItem>
            <SelectItem value="year">This Year</SelectItem>
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
          { label: 'Total Revenue', value: formatNaira(totals.revenue), color: 'text-northcode-blue' },
          { label: 'Est. Profit', value: formatNaira(totals.profit), color: 'text-green-600' },
          { label: 'Transactions', value: String(totals.sales), color: 'text-foreground' },
        ].map(item => (
          <Card key={item.label} className="border-0 shadow-sm">
            <CardContent className="p-3 text-center">
              <p className="text-xs text-muted-foreground">{item.label}</p>
              <p className={`text-lg font-bold mt-0.5 ${item.color}`}>{loading ? '…' : item.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {loading ? (
        <div className="space-y-4">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-48" />)}</div>
      ) : (
        <>
          {/* Revenue by payment method - pie chart */}
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
                      <Pie data={revenueByMethod} cx="50%" cy="50%" innerRadius={50} outerRadius={80} dataKey="value" label={({ name }) => name}>
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
                      <TableHead>#</TableHead>
                      <TableHead>Product</TableHead>
                      <TableHead className="text-right">Qty</TableHead>
                      <TableHead className="text-right">Revenue</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {topProducts.map((p, idx) => (
                      <TableRow key={p.name}>
                        <TableCell className="text-muted-foreground text-sm">{idx + 1}</TableCell>
                        <TableCell className="text-sm font-medium">{p.name}</TableCell>
                        <TableCell className="text-right text-sm">{p.qty}</TableCell>
                        <TableCell className="text-right text-sm font-medium text-northcode-blue">{formatNaira(p.revenue)}</TableCell>
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
                  { label: t('reports.selling_value'), value: formatNaira(stockValuation.sellingValue), color: 'text-northcode-blue' },
                  { label: t('reports.potential_profit'), value: formatNaira(stockValuation.potentialProfit), color: 'text-green-600' },
                ].map(item => (
                  <div key={item.label} className="rounded-lg bg-muted/30 p-3">
                    <p className="text-xs text-muted-foreground">{item.label}</p>
                    <p className={`text-sm font-bold mt-1 ${item.color}`}>{item.value}</p>
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
                      <TableHead>Cashier</TableHead>
                      <TableHead className="text-right">Sales</TableHead>
                      <TableHead className="text-right">Revenue</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {cashierPerf.map(c => (
                      <TableRow key={c.name}>
                        <TableCell className="font-medium text-sm">{c.name}</TableCell>
                        <TableCell className="text-right">{c.sales}</TableCell>
                        <TableCell className="text-right font-medium text-northcode-blue">{formatNaira(c.revenue)}</TableCell>
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

'use client'

import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { Download, Receipt, TrendingDown, Banknote } from 'lucide-react'
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
import { generateReportPDF } from '@/lib/utils/pdf'
import { format, startOfDay, endOfDay, startOfMonth, startOfWeek, startOfQuarter, startOfYear } from 'date-fns'

const PIE_COLORS = ['#60a5fa', '#D4AF37', '#16A34A', '#DC2626', '#a78bfa']

export default function ReportsPage() {
  const t = useTranslations()
  const { shop, effectiveShopIds, userShops, profile, roleInActiveShop } = useAuth()
  const effectiveRole = roleInActiveShop ?? profile?.role
  const isCashier = effectiveRole === 'cashier'
  const isMultiShop = effectiveShopIds.length > 1
  const { fmt: formatNaira, symbol: currencySymbol } = useCurrency()
  const supabase = createClient() as any

  const [dateFilter, setDateFilter] = useState('month')
  const today = format(new Date(), 'yyyy-MM-dd')
  const [customStart, setCustomStart] = useState(today)
  const [customEnd, setCustomEnd] = useState(today)
  const [loading, setLoading] = useState(true)
  const [exporting, setExporting] = useState(false)

  const [revenueByMethod, setRevenueByMethod] = useState<{ name: string; value: number }[]>([])
  const [topProducts, setTopProducts] = useState<{ name: string; qty: number; revenue: number }[]>([])
  const [stockValuation, setStockValuation] = useState({ buyingValue: 0, sellingValue: 0, potentialProfit: 0 })
  const [cashierPerf, setCashierPerf] = useState<{ id: string; name: string; shopName?: string; sales: number; revenue: number; shopId: string }[]>([])
  const [totals, setTotals] = useState({ revenue: 0, profit: 0, sales: 0 })
  const [outstandingDebt, setOutstandingDebt] = useState(0)
  const [allInventory, setAllInventory] = useState<{ name: string; quantity: number; buying_price: number; selling_price: number; soldQty: number; soldRevenue: number }[]>([])
  const [expenses, setExpenses] = useState<{ id: string; amount: number; description: string; date: string }[]>([])
  const [totalExpenses, setTotalExpenses] = useState(0)

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
      case 'custom':   return {
        start: startOfDay(new Date(customStart)).toISOString(),
        end: endOfDay(new Date(customEnd)).toISOString(),
      }
      default:         start = startOfMonth(now)
    }
    return { start: start.toISOString(), end: end.toISOString() }
  }

  const fetchReports = async () => {
    if (!effectiveShopIds.length) return
    setLoading(true)
    const { start, end } = getDateRange()

    // Sales in period
    const { data: salesRaw } = await supabase
      .from('sales')
      .select('id, total, amount_paid, payment_method, created_at, cashier_id, shop_id')
      .in('shop_id', effectiveShopIds)
      .eq('sale_status', 'active')
      .gte('created_at', start)
      .lte('created_at', end)
    const sales = (salesRaw || []) as Array<{ id: string; total: number; amount_paid: number; payment_method: string; created_at: string; cashier_id: string | null; shop_id: string }>

    // Actual payments received in period (new sales + debt repayments)
    const { data: paymentsRaw } = await supabase
      .from('payments')
      .select('amount, method, sales!inner(shop_id)')
      .gte('paid_at', start)
      .lte('paid_at', end)
    const paymentsInPeriod = (paymentsRaw || []).filter((p: any) => effectiveShopIds.includes(p.sales?.shop_id)) as Array<{ amount: number; method: string }>

    // Revenue by payment method (from actual payments)
    const byMethod: Record<string, number> = {}
    paymentsInPeriod.forEach(p => { byMethod[p.method] = (byMethod[p.method] || 0) + Number(p.amount) })
    setRevenueByMethod(
      Object.entries(byMethod).map(([name, value]) => ({
        name: name.charAt(0).toUpperCase() + name.slice(1),
        value,
      }))
    )

    const totalRevenue = paymentsInPeriod.reduce((s, p) => s + Number(p.amount), 0)

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
      const productIds = Array.from(new Set(safeItems.map(i => i.product_id).filter(Boolean) as string[]))
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

    // Stock valuation + full inventory
    const [{ data: allProducts }, { data: debtCustomers }, { data: expensesRaw }] = await Promise.all([
      supabase
        .from('products').select('id, name, quantity, buying_price, selling_price')
        .in('shop_id', effectiveShopIds).eq('is_active', true).order('name'),
      supabase
        .from('customers').select('total_debt')
        .in('shop_id', effectiveShopIds),
      supabase
        .from('expenses').select('id, amount, description, date')
        .in('shop_id', effectiveShopIds)
        .gte('date', start.slice(0, 10))
        .lte('date', end.slice(0, 10))
        .order('date', { ascending: false }),
    ])
    const expensesList = (expensesRaw || []) as { id: string; amount: number; description: string; date: string }[]
    const expTotal = expensesList.reduce((s, e) => s + Number(e.amount), 0)
    setExpenses(expensesList)
    setTotalExpenses(expTotal)
    const buyingValue = (allProducts || []).reduce((s: number, p: any) => s + Number(p.quantity) * Number(p.buying_price), 0)
    const sellingValue = (allProducts || []).reduce((s: number, p: any) => s + Number(p.quantity) * Number(p.selling_price), 0)
    setStockValuation({ buyingValue, sellingValue, potentialProfit: sellingValue - buyingValue })

    const totalOutstandingDebt = (debtCustomers || []).reduce((s: number, c: any) => s + Number(c.total_debt), 0)
    setOutstandingDebt(totalOutstandingDebt)

    // Full inventory: all active products, enriched with sold qty/revenue for the period
    const inventoryList = (allProducts || []).map((p: any) => ({
      name: p.name,
      quantity: Number(p.quantity),
      buying_price: Number(p.buying_price),
      selling_price: Number(p.selling_price),
      soldQty: prodTotals[p.name]?.qty || 0,
      soldRevenue: prodTotals[p.name]?.revenue || 0,
    })).sort((a: { soldRevenue: number; name: string }, b: { soldRevenue: number; name: string }) => (b.soldRevenue - a.soldRevenue) || a.name.localeCompare(b.name))
    setAllInventory(inventoryList)

    // Cashier performance — build sales map from actual sales
    const cashierMap: Record<string, { sales: number; revenue: number; shopId: string }> = {}
    sales.forEach(s => {
      if (!s.cashier_id) return
      if (!cashierMap[s.cashier_id]) cashierMap[s.cashier_id] = { sales: 0, revenue: 0, shopId: s.shop_id }
      cashierMap[s.cashier_id].sales += 1
      cashierMap[s.cashier_id].revenue += Number(s.amount_paid)
    })

    // Fetch ALL active shop members so we include those with 0 sales in the ranking
    const { data: membersRaw } = await supabase
      .from('shop_members').select('user_id, shop_id')
      .in('shop_id', effectiveShopIds).eq('is_active', true)
    const allMembers = (membersRaw || []) as { user_id: string; shop_id: string }[]
    const memberShopMap: Record<string, string> = {}
    allMembers.forEach(m => { memberShopMap[m.user_id] = m.shop_id })

    // Union: members who sold + all active members
    const allUserIds = Array.from(new Set([...Object.keys(cashierMap), ...allMembers.map(m => m.user_id)]))

    if (allUserIds.length > 0) {
      const { data: profiles } = await supabase.from('profiles').select('id, full_name').in('id', allUserIds)
      const shopNameMap: Record<string, string> = {}
      userShops.forEach((s: any) => { shopNameMap[s.id] = s.name })
      setCashierPerf(
        allUserIds.map(id => ({
          id,
          name: (profiles || []).find((p: any) => p.id === id)?.full_name || 'Unknown',
          shopName: shopNameMap[cashierMap[id]?.shopId || memberShopMap[id] || ''],
          sales: cashierMap[id]?.sales || 0,
          revenue: cashierMap[id]?.revenue || 0,
          shopId: cashierMap[id]?.shopId || memberShopMap[id] || '',
        })).sort((a, b) => b.revenue - a.revenue)
      )
    } else {
      setCashierPerf([])
    }

    setLoading(false)
  }

  useEffect(() => {
    if (dateFilter === 'custom' && (!customStart || !customEnd)) return
    fetchReports()
  }, [effectiveShopIds.join(','), dateFilter, dateFilter === 'custom' ? customStart : '', dateFilter === 'custom' ? customEnd : ''])

  const exportPDF = async () => {
    if (!shop) {
      toast({ title: t('reports.error_no_shop'), variant: 'destructive' })
      return
    }
    setExporting(true)
    try {
      const { start, end } = getDateRange()
      const dateRange = `${format(new Date(start), 'dd MMM yyyy')} – ${format(new Date(end), 'dd MMM yyyy')}`
      await generateReportPDF({
        shopName: shop.name,
        dateRange,
        labels: {
          businessReport: t('reports.pdf_business_report'),
          generatedBy: t('reports.pdf_generated_by'),
          page: t('reports.pdf_page'),
          of: t('reports.pdf_of'),
        },
        sections: [
          {
            title: t('reports.encaisse') + ' / ' + t('reports.cash_in_register'),
            headers: [t('reports.col_metric'), t('reports.col_value')],
            rows: [
              [t('reports.encaisse'), formatNaira(totals.revenue)],
              ['Marge brute sur ventes', formatNaira(totals.profit)],
              [t('expenses.title'), formatNaira(totalExpenses)],
              [t('expenses.net_profit'), formatNaira(totals.profit - totalExpenses)],
              [t('reports.outstanding_debt'), formatNaira(outstandingDebt)],
              [t('reports.transactions'), String(totals.sales)],
            ],
          },
          {
            title: t('reports.revenue_by_method'),
            headers: [t('reports.col_method'), currencySymbol, t('reports.col_share')],
            rows: revenueByMethod.map(m => [
              m.name,
              formatNaira(m.value),
              totals.revenue > 0 ? `${((m.value / totals.revenue) * 100).toFixed(1)}%` : '0%',
            ]),
          },
          {
            title: t('reports.full_inventory'),
            headers: isCashier
              ? [t('reports.col_product'), t('reports.col_stock'), t('reports.col_sold_qty'), t('reports.col_selling_price')]
              : [t('reports.col_product'), t('reports.col_stock'), t('reports.col_sold_qty'), t('reports.col_buying_price'), t('reports.col_selling_price')],
            rows: allInventory.map(p => isCashier
              ? [p.name, p.quantity, p.soldQty || '—', formatNaira(p.selling_price)]
              : [p.name, p.quantity, p.soldQty || '—', formatNaira(p.buying_price), formatNaira(p.selling_price)]
            ),
          },
          ...(!isCashier ? [{
            title: t('reports.stock_valuation'),
            headers: [t('reports.col_metric'), t('reports.col_value')],
            rows: [
              [t('reports.buying_value'), formatNaira(stockValuation.buyingValue)],
              [t('reports.selling_value'), formatNaira(stockValuation.sellingValue)],
              [t('reports.potential_profit'), formatNaira(stockValuation.potentialProfit)],
            ],
          }] : []),
          ...(expenses.length > 0 ? [{
            title: t('expenses.title'),
            headers: ['Date', 'Description', 'Montant'],
            rows: [
              ...expenses.map(e => [format(new Date(e.date), 'dd MMM yyyy'), e.description, formatNaira(e.amount)]),
              ['', 'Total', formatNaira(totalExpenses)],
            ],
          }] : []),
          {
            title: t('reports.cashier_performance'),
            headers: isMultiShop
              ? [t('reports.col_rank'), t('reports.col_cashier'), t('nav.shops'), t('reports.col_sales'), t('reports.col_revenue')]
              : [t('reports.col_rank'), t('reports.col_cashier'), t('reports.col_sales'), t('reports.col_revenue')],
            rows: (isCashier ? cashierPerf.filter(c => c.id === profile?.id) : cashierPerf).map((c, idx) => isMultiShop
              ? [isCashier ? '—' : c.sales > 0 ? idx + 1 : '—', c.name, c.shopName || '', c.sales, c.sales > 0 ? formatNaira(c.revenue) : '—']
              : [isCashier ? '—' : c.sales > 0 ? idx + 1 : '—', c.name, c.sales, c.sales > 0 ? formatNaira(c.revenue) : '—']
            ),
          },
        ],
      })
    } catch (err) {
      console.error('[exportPDF]', err)
      toast({ title: t('reports.error_pdf'), description: String(err), variant: 'destructive' })
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="space-y-3 pb-6">
      {/* Controls */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <Select value={dateFilter} onValueChange={setDateFilter}>
            <SelectTrigger className="w-[150px] sm:w-[175px] text-xs sm:text-sm h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="today">{t('reports.today')}</SelectItem>
              <SelectItem value="week">{t('reports.this_week')}</SelectItem>
              <SelectItem value="month">{t('reports.this_month')}</SelectItem>
              <SelectItem value="quarter">{t('reports.this_quarter')}</SelectItem>
              <SelectItem value="semester">{t('reports.this_semester')}</SelectItem>
              <SelectItem value="year">{t('reports.this_year')}</SelectItem>
              <SelectItem value="custom">Période personnalisée</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" onClick={exportPDF} loading={exporting} className="gap-1.5 h-9 px-3 text-xs sm:text-sm">
            <Download className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">{t('actions.download_pdf')}</span>
            <span className="sm:hidden">PDF</span>
          </Button>
        </div>

        {dateFilter === 'custom' && (
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 flex-1">
              <span className="text-xs text-muted-foreground flex-shrink-0">Du</span>
              <input
                type="date"
                value={customStart}
                max={customEnd}
                onChange={e => setCustomStart(e.target.value)}
                className="flex-1 h-9 rounded-md border border-input bg-background px-2 text-xs sm:text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
            <div className="flex items-center gap-1.5 flex-1">
              <span className="text-xs text-muted-foreground flex-shrink-0">Au</span>
              <input
                type="date"
                value={customEnd}
                min={customStart}
                max={today}
                onChange={e => setCustomEnd(e.target.value)}
                className="flex-1 h-9 rounded-md border border-input bg-background px-2 text-xs sm:text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
          </div>
        )}
      </div>

      {/* KPI — ligne 1 : Encaissé · Dépenses · Transactions */}
      <div className="grid grid-cols-3 gap-2">
        {[
          { label: t('reports.encaisse'), amount: totals.revenue, color: 'text-blue-500', isNum: false, sub: t('reports.cash_in_register') },
          { label: t('expenses.title'), amount: totalExpenses, color: 'text-red-500', isNum: false, sub: null },
          { label: t('reports.transactions'), amount: totals.sales, color: 'text-foreground', isNum: true, sub: null },
        ].map(item => (
          <Card key={item.label} className="border-0 shadow-sm">
            <CardContent className="p-2 sm:p-3 text-center">
              <p className="text-[10px] sm:text-xs text-muted-foreground leading-tight truncate">{item.label}</p>
              <p className={`text-sm sm:text-base font-bold mt-0.5 truncate ${item.color}`}>
                {loading ? '…' : item.isNum ? item.amount : formatNaira(item.amount as number)}
              </p>
              {item.sub && <p className="text-[9px] sm:text-[10px] text-muted-foreground mt-0.5 leading-tight hidden sm:block">{item.sub}</p>}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* KPI — ligne 2 : Marge brute · Bénéfice net · Dettes */}
      <div className="grid grid-cols-3 gap-2">
        <Card className="border-0 shadow-sm">
          <CardContent className="p-2 sm:p-3 text-center">
            <p className="text-[10px] sm:text-xs text-muted-foreground leading-tight">Marge brute</p>
            <p className={`text-sm sm:text-base font-bold mt-0.5 truncate ${totals.profit >= 0 ? 'text-blue-400' : 'text-red-500'}`}>
              {loading ? '…' : formatNaira(totals.profit)}
            </p>
            <p className="text-[9px] text-muted-foreground mt-0.5 hidden sm:block">Ventes − coût achat</p>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm ring-1 ring-green-500/40">
          <CardContent className="p-2 sm:p-3 text-center">
            <p className="text-[10px] sm:text-xs text-muted-foreground leading-tight font-semibold">{t('expenses.net_profit')}</p>
            <p className={`text-sm sm:text-base font-bold mt-0.5 truncate ${totals.profit - totalExpenses >= 0 ? 'text-green-500' : 'text-red-500'}`}>
              {loading ? '…' : formatNaira(totals.profit - totalExpenses)}
            </p>
            <p className="text-[9px] text-muted-foreground mt-0.5 hidden sm:block">Marge − dépenses</p>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm">
          <CardContent className="p-2 sm:p-3 text-center">
            <p className="text-[10px] sm:text-xs text-muted-foreground leading-tight">{t('reports.outstanding_debt')}</p>
            <p className="text-sm sm:text-base font-bold mt-0.5 truncate text-orange-500">
              {loading ? '…' : formatNaira(outstandingDebt)}
            </p>
          </CardContent>
        </Card>
      </div>

      {loading ? (
        <div className="space-y-3">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-32" />)}</div>
      ) : (
        <>
          {/* Revenue by payment method */}
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-2 px-3 sm:px-6">
              <CardTitle className="text-sm">{t('reports.revenue_by_method')}</CardTitle>
            </CardHeader>
            <CardContent className="px-3 sm:px-6">
              {revenueByMethod.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">{t('reports.no_data')}</p>
              ) : (
                <div className="flex flex-col sm:flex-row items-center gap-4">
                  <div className="w-full sm:w-[200px] flex-shrink-0">
                    <ResponsiveContainer width="100%" height={180}>
                      <PieChart>
                        <Pie data={revenueByMethod} cx="50%" cy="50%" innerRadius={45} outerRadius={70} dataKey="value">
                          {revenueByMethod.map((_, idx) => <Cell key={idx} fill={PIE_COLORS[idx % PIE_COLORS.length]} />)}
                        </Pie>
                        <Tooltip formatter={(v: any) => formatNaira(v)} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="w-full space-y-1.5">
                    {revenueByMethod.map((m, idx) => (
                      <div key={m.name} className="flex items-center gap-2 text-sm">
                        <span className="h-2.5 w-2.5 rounded-full flex-shrink-0" style={{ background: PIE_COLORS[idx % PIE_COLORS.length] }} />
                        <span className="text-muted-foreground text-xs flex-1">{m.name}</span>
                        <span className="font-medium text-xs">{formatNaira(m.value)}</span>
                        <span className="text-muted-foreground text-[10px] w-9 text-right">
                          {totals.revenue > 0 ? `${((m.value / totals.revenue) * 100).toFixed(0)}%` : ''}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Top selling products */}
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-2 px-3 sm:px-6">
              <CardTitle className="text-sm">{t('reports.top_products')}</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {topProducts.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">{t('reports.no_data')}</p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-7 px-2 sm:px-4">#</TableHead>
                        <TableHead className="px-2 sm:px-4">{t('reports.col_product')}</TableHead>
                        <TableHead className="text-right px-2 sm:px-4">{t('reports.col_qty')}</TableHead>
                        <TableHead className="text-right px-2 sm:px-4">{t('reports.col_revenue')}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {topProducts.map((p, idx) => (
                        <TableRow key={p.name}>
                          <TableCell className="text-muted-foreground text-xs px-2 sm:px-4">{idx + 1}</TableCell>
                          <TableCell className="text-xs sm:text-sm font-medium px-2 sm:px-4 max-w-[140px] truncate">{p.name}</TableCell>
                          <TableCell className="text-right text-xs sm:text-sm px-2 sm:px-4">{p.qty}</TableCell>
                          <TableCell className="text-right text-xs sm:text-sm font-medium text-blue-500 px-2 sm:px-4 whitespace-nowrap">{formatNaira(p.revenue)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Full inventory */}
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-2 px-3 sm:px-6">
              <CardTitle className="text-sm">{t('reports.full_inventory')}</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {allInventory.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">{t('reports.no_data')}</p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="px-2 sm:px-4">{t('reports.col_product')}</TableHead>
                        <TableHead className="text-right px-2 sm:px-4">{t('reports.col_stock')}</TableHead>
                        <TableHead className="text-right px-2 sm:px-4 hidden sm:table-cell">{t('reports.col_sold_qty')}</TableHead>
                        {!isCashier && <TableHead className="text-right px-2 sm:px-4 hidden sm:table-cell">{t('reports.col_buying_price')}</TableHead>}
                        <TableHead className="text-right px-2 sm:px-4">{t('reports.col_selling_price')}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {allInventory.map(p => (
                        <TableRow key={p.name} className={p.quantity === 0 ? 'opacity-50' : ''}>
                          <TableCell className="text-xs sm:text-sm font-medium px-2 sm:px-4 max-w-[120px] truncate">{p.name}</TableCell>
                          <TableCell className={`text-right text-xs sm:text-sm font-medium px-2 sm:px-4 ${p.quantity === 0 ? 'text-red-500' : p.quantity <= 5 ? 'text-orange-500' : 'text-foreground'}`}>
                            {p.quantity}
                          </TableCell>
                          <TableCell className="text-right text-xs text-muted-foreground px-2 sm:px-4 hidden sm:table-cell">{p.soldQty > 0 ? p.soldQty : '—'}</TableCell>
                          {!isCashier && <TableCell className="text-right text-xs text-muted-foreground px-2 sm:px-4 hidden sm:table-cell">{formatNaira(p.buying_price)}</TableCell>}
                          <TableCell className="text-right text-xs sm:text-sm text-blue-500 px-2 sm:px-4 whitespace-nowrap">{formatNaira(p.selling_price)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Stock valuation — hidden for cashiers (exposes buying costs) */}
          {!isCashier && (
            <Card className="border-0 shadow-sm">
              <CardHeader className="pb-2 px-3 sm:px-6">
                <CardTitle className="text-sm">{t('reports.stock_valuation')}</CardTitle>
              </CardHeader>
              <CardContent className="px-3 sm:px-6">
                <div className="grid grid-cols-3 gap-2 text-center">
                  {[
                    { label: t('reports.buying_value'), value: formatNaira(stockValuation.buyingValue), color: 'text-muted-foreground' },
                    { label: t('reports.selling_value'), value: formatNaira(stockValuation.sellingValue), color: 'text-blue-500' },
                    { label: t('reports.potential_profit'), value: formatNaira(stockValuation.potentialProfit), color: 'text-green-600' },
                  ].map(item => (
                    <div key={item.label} className="rounded-lg bg-muted/30 p-2 sm:p-3">
                      <p className="text-[10px] sm:text-xs text-muted-foreground leading-tight">{item.label}</p>
                      <p className={`text-[11px] sm:text-sm font-bold mt-1 truncate ${item.color}`}>{item.value}</p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Expenses list */}
          {expenses.length > 0 && (
            <Card className="border-0 shadow-sm">
              <CardHeader className="pb-2 px-3 sm:px-6">
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Receipt className="h-4 w-4 text-red-500" />
                    {t('expenses.title')}
                  </CardTitle>
                  <span className="text-sm font-bold text-red-500">{formatNaira(totalExpenses)}</span>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="px-2 sm:px-4 whitespace-nowrap">Date</TableHead>
                        <TableHead className="px-2 sm:px-4">Description</TableHead>
                        <TableHead className="text-right px-2 sm:px-4">Montant</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {expenses.map(e => (
                        <TableRow key={e.id}>
                          <TableCell className="text-xs text-muted-foreground whitespace-nowrap px-2 sm:px-4">
                            {format(new Date(e.date), 'dd MMM yy')}
                          </TableCell>
                          <TableCell className="text-xs sm:text-sm px-2 sm:px-4 max-w-[150px] truncate">{e.description}</TableCell>
                          <TableCell className="text-right text-xs sm:text-sm font-medium text-red-500 px-2 sm:px-4 whitespace-nowrap">
                            {formatNaira(e.amount)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Cashier performance — cashier sees only their own row */}
          {(isCashier ? cashierPerf.filter(c => c.id === profile?.id) : cashierPerf).length > 0 && (
            <Card className="border-0 shadow-sm">
              <CardHeader className="pb-2 px-3 sm:px-6">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <CardTitle className="text-sm">{t('reports.cashier_performance')}</CardTitle>
                  {isMultiShop ? (
                    <span className="text-[11px] font-medium text-blue-500 bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800 rounded-full px-2 py-0.5">
                      {t('reports.all_shops_ranking')}
                    </span>
                  ) : shop?.name ? (
                    <span className="text-[11px] text-muted-foreground bg-muted rounded-full px-2 py-0.5 truncate max-w-[120px]">
                      {shop.name}
                    </span>
                  ) : null}
                </div>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-7 px-2 sm:px-4">#</TableHead>
                        <TableHead className="px-2 sm:px-4">{t('reports.col_cashier')}</TableHead>
                        {isMultiShop && <TableHead className="text-muted-foreground px-2 sm:px-4 hidden sm:table-cell">{t('nav.shops')}</TableHead>}
                        <TableHead className="text-right px-2 sm:px-4">{t('reports.col_sales')}</TableHead>
                        <TableHead className="text-right px-2 sm:px-4">{t('reports.col_revenue')}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(isCashier ? cashierPerf.filter(c => c.id === profile?.id) : cashierPerf).map((c, idx) => (
                        <TableRow key={c.id} className={c.sales === 0 ? 'opacity-50' : ''}>
                          <TableCell className="text-muted-foreground text-xs font-medium px-2 sm:px-4">
                            {isCashier ? '—' : c.sales > 0 ? (idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : idx + 1) : '—'}
                          </TableCell>
                          <TableCell className="font-medium text-xs sm:text-sm px-2 sm:px-4 max-w-[100px] truncate">{c.name}</TableCell>
                          {isMultiShop && <TableCell className="text-xs text-muted-foreground px-2 sm:px-4 hidden sm:table-cell">{c.shopName}</TableCell>}
                          <TableCell className="text-right text-xs sm:text-sm px-2 sm:px-4">{c.sales}</TableCell>
                          <TableCell className={`text-right text-xs sm:text-sm font-medium px-2 sm:px-4 whitespace-nowrap ${c.sales > 0 ? 'text-blue-500' : 'text-muted-foreground'}`}>
                            {c.sales > 0 ? formatNaira(c.revenue) : '—'}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  )
}

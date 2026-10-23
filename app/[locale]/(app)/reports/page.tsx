'use client'

import { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { usePersistedFilters } from '@/lib/hooks/use-persisted-filters'
import { useLocale, useTranslations } from 'next-intl'
import { dateFnsLocale } from '@/lib/i18n/date-format'
import { getPaymentMethodLabel } from '@/lib/saas/countries'
import { Download, Receipt, TrendingDown, Banknote, X, Loader2 } from 'lucide-react'
import {
  PieChart, Pie, Cell,
  Tooltip, ResponsiveContainer,
} from 'recharts'
import { useAuthContext as useAuth } from '@/lib/contexts/auth-context'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { useCurrency } from '@/lib/hooks/use-currency'
import { useToast } from '@/components/ui/use-toast'
import { generateReportPDFBlob, savePDF } from '@/lib/utils/pdf'
import { cn } from '@/lib/utils/cn'
import { format, subDays, startOfDay, endOfDay, startOfMonth, startOfWeek, startOfQuarter, startOfYear } from 'date-fns'
import { useOffline } from '@/lib/offline/use-offline'
import { useRefetchOnReconnect } from '@/lib/hooks/use-refetch-on-reconnect'
import { useRefetchOnVisible } from '@/lib/hooks/use-refetch-on-visible'
import { useRolePermissions, type PermFeature } from '@/lib/hooks/use-role-permissions'
import { withTimeout } from '@/lib/utils/with-timeout'
import { queryKeys } from '@/lib/query-keys'

const PIE_COLORS = ['#60a5fa', '#D4AF37', '#16A34A', '#DC2626', '#a78bfa']

interface ReportsData {
  revenueByMethod: { name: string; value: number }[]
  topProducts: { name: string; qty: number; revenue: number }[]
  stockValuation: { sellingValue: number }
  cashierPerf: { id: string; name: string; shopName?: string; sales: number; revenue: number; shopId: string }[]
  totals: { revenue: number; sales: number }
  /** Ventes de la période : envoyées au serveur pour le calcul de la marge (jamais de coût ici) */
  saleIds: string[]
  outstandingDebt: number
  allInventory: { id: string; name: string; quantity: number; selling_price: number; soldQty: number; soldRevenue: number }[]
  expenses: { id: string; amount: number; description: string; date: string }[]
  totalExpenses: number
}

const EMPTY_REPORTS: ReportsData = {
  revenueByMethod: [],
  topProducts: [],
  stockValuation: { sellingValue: 0 },
  cashierPerf: [],
  totals: { revenue: 0, sales: 0 },
  saleIds: [],
  outstandingDebt: 0,
  allInventory: [],
  expenses: [],
  totalExpenses: 0,
}

export default function ReportsPage() {
  const t = useTranslations()
  const locale = useLocale()
  const { shop, effectiveShopIds, userShops, profile, roleInActiveShop } = useAuth()
  const effectiveRole = roleInActiveShop ?? profile?.role
  const isCashier = effectiveRole === 'cashier'
  const isMultiShop = effectiveShopIds.length > 1
  const { fmt: formatNaira, symbol: currencySymbol } = useCurrency()
  const { canAccess, canViewCost } = useRolePermissions()
  // Garde d'entrée : la page elle-même exige l'accès aux Rapports (plus seulement le menu)
  const canSeeReports = canAccess('reports')
  const { isOnline } = useOffline()
  const { toast } = useToast()

  const today = format(new Date(), 'yyyy-MM-dd')
  const [{ dateFilter, customStart, customEnd }, setFilter] = usePersistedFilters(
    'reports', shop?.id, { dateFilter: 'today', customStart: today, customEnd: today }
  )
  const [exporting, setExporting] = useState(false)
  const [pdfSheet, setPdfSheet] = useState<{ blob: Blob; url: string; name: string } | null>(null)
  const [downloading, setDownloading] = useState(false)
  const closePdfSheet = () => {
    if (pdfSheet) { URL.revokeObjectURL(pdfSheet.url); setPdfSheet(null) }
  }

  const getDateRange = () => {
    const now = new Date()
    let start: Date
    let end = endOfDay(now)
    switch (dateFilter) {
      case 'today':     start = startOfDay(now); break
      case 'yesterday':
        start = startOfDay(subDays(now, 1))
        end   = endOfDay(subDays(now, 1))
        break
      case 'week':     start = startOfWeek(now, { weekStartsOn: 1 }); break
      case 'month':    start = startOfMonth(now); break
      case 'quarter':  start = startOfQuarter(now); break
      case 'semester': start = new Date(now.getFullYear(), now.getMonth() < 6 ? 0 : 6, 1); break
      case 'year':     start = startOfYear(now); break
      case 'custom':   return {
        start: startOfDay(new Date(customStart)).toISOString(),
        end: endOfDay(new Date(customEnd)).toISOString(),
      }
      default:         start = startOfDay(now)
    }
    return { start: start.toISOString(), end: end.toISOString() }
  }

  const getDateLabel = () => {
    if (dateFilter === 'custom') {
      return `${format(new Date(customStart), 'dd MMM yyyy', { locale: dateFnsLocale(locale) })} – ${format(new Date(customEnd), 'dd MMM yyyy', { locale: dateFnsLocale(locale) })}`
    }
    const { start, end } = getDateRange()
    const s = new Date(start)
    const e = new Date(end)
    if (s.toDateString() === e.toDateString()) return format(s, 'dd MMM yyyy', { locale: dateFnsLocale(locale) })
    if (s.getFullYear() === e.getFullYear()) return `${format(s, 'dd MMM', { locale: dateFnsLocale(locale) })} – ${format(e, 'dd MMM yyyy', { locale: dateFnsLocale(locale) })}`
    return `${format(s, 'dd MMM yyyy', { locale: dateFnsLocale(locale) })} – ${format(e, 'dd MMM yyyy', { locale: dateFnsLocale(locale) })}`
  }

  // Données calculées par le SERVEUR (/api/reports/summary) : droit « Rapports » et widgets évalués boutique par
  // boutique, vendeur limité à ses ventes décidé par le serveur, aucun coût ni marge (réservés à /api/reports/margin).
  // Avant : lues directement par le navigateur, la base ne contrôlant que l'appartenance à la boutique.
  const loadFreshReportData = async (start: string, end: string): Promise<ReportsData> => {
    const res = await fetch(`/api/reports/summary?${new URLSearchParams({ shop_ids: effectiveShopIds.join(','), start, end })}`)
    const j = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(j.error || t('errors.generic'))
    // Libellé lisible : traduit (Espèces, Carte, Crédit…) ou nom de marque (Orange Money, MTN MoMo…)
    const methodName = (id: string) => id === 'mixed'
      ? t('receipt.method_mixed')
      : t.has(`payment.${id}` as any) ? t(`payment.${id}` as any) : (getPaymentMethodLabel(id) ?? id)
    const shopNameMap: Record<string, string> = {}
    userShops.forEach((x: any) => { shopNameMap[x.id] = x.name })
    return {
      revenueByMethod: Object.entries(j.revenue_by_method || {}).map(([name, value]) => ({ name: methodName(name), value: Number(value) })),
      topProducts: j.top_products || [],
      stockValuation: j.stock_valuation || { sellingValue: 0 },
      totals: j.totals || { revenue: 0, sales: 0 },
      saleIds: j.sale_ids || [],
      outstandingDebt: Number(j.outstanding_debt || 0),
      allInventory: j.all_inventory || [],
      expenses: j.expenses || [],
      totalExpenses: Number(j.total_expenses || 0),
      // Une ligne par vendeur ET par boutique (jamais de boutiques mélangées sur une ligne)
      cashierPerf: (j.cashier_perf || []).map((c: any) => ({ ...c, shopName: shopNameMap[c.shopId] || '' })),
    }
  }

  const filtersReady = !(dateFilter === 'custom' && (!customStart || !customEnd))
  const shopKey = effectiveShopIds.join(',')
  const { data, isLoading: loading, refetch } = useQuery({
    queryKey: queryKeys.reports(shopKey, `${dateFilter}_${customStart}_${customEnd}`),
    queryFn: () => {
      const { start, end } = getDateRange()
      // A stale connection/session after the app sat backgrounded for a
      // while (JWT/socket gone stale) could otherwise leave one of these
      // sequential Supabase calls hanging forever — bound the whole fetch
      // so it always falls back to whatever was last cached instead.
      return withTimeout(loadFreshReportData(start, end), 20_000, 'Chargement des rapports trop lent — réessayez.')
    },
    enabled: effectiveShopIds.length > 0 && filtersReady && canSeeReports,
  })
  const {
    revenueByMethod, topProducts, stockValuation, cashierPerf,
    totals, outstandingDebt, allInventory, expenses, totalExpenses,
  } = data ?? EMPTY_REPORTS

  // Marge, bénéfice, valeur d'achat du stock, prix d'achat : calculés par le SERVEUR, pour qui a l'accès aux
  // Rapports ET le droit de voir les coûts (lib/permissions → canViewCost). Sans ce droit l'écran ne demande
  // rien et n'affiche ni marge ni bénéfice. Cette réponse n'est jamais rangée dans le cache local (clé à part).
  const saleIds = data?.saleIds ?? []
  const { data: margin } = useQuery({
    queryKey: ['reports-margin', shopKey, `${dateFilter}_${customStart}_${customEnd}`, saleIds.length, totals.revenue],
    queryFn: async (): Promise<{ cogs: number; stock_buying_value: number; product_costs: Record<string, number> } | null> => {
      const res = await withTimeout(fetch('/api/reports/margin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shop_ids: effectiveShopIds, sale_ids: saleIds }),
      }), 20_000)
      if (!res.ok) return null
      return res.json()
    },
    enabled: canSeeReports && canViewCost && !!data && effectiveShopIds.length > 0,
  })
  const showMargin = canViewCost && !!margin
  const profit = margin ? totals.revenue - margin.cogs : 0
  const buyingValue = margin?.stock_buying_value ?? 0
  const costOf = (id: string) => margin?.product_costs[id] ?? 0

  // Refresh when the user comes back to this tab or regains connectivity —
  // financial reports deserve the same freshness as the dashboard.
  useRefetchOnVisible(refetch)
  useRefetchOnReconnect(refetch, isOnline)

  const buildPdfParams = () => {
    const { start, end } = getDateRange()
    const dateRange = `${format(new Date(start), 'dd MMM yyyy', { locale: dateFnsLocale(locale) })} – ${format(new Date(end), 'dd MMM yyyy', { locale: dateFnsLocale(locale) })}`
    return {
      shopName: shop!.name,
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
            ...(showMargin ? [[t('reports.gross_margin_sales_pdf'), formatNaira(profit)]] : []),
            [t('expenses.title'), formatNaira(totalExpenses)],
            ...(showMargin ? [[t('expenses.net_profit'), formatNaira(profit - totalExpenses)]] : []),
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
          headers: !showMargin
            ? [t('reports.col_product'), t('reports.col_stock'), t('reports.col_sold_qty'), t('reports.col_selling_price')]
            : [t('reports.col_product'), t('reports.col_stock'), t('reports.col_sold_qty'), t('reports.col_buying_price'), t('reports.col_selling_price')],
          rows: allInventory.map(p => !showMargin
            ? [p.name, p.quantity, p.soldQty || '—', formatNaira(p.selling_price)]
            : [p.name, p.quantity, p.soldQty || '—', formatNaira(costOf(p.id)), formatNaira(p.selling_price)]
          ),
        },
        ...(showMargin ? [{
          title: t('reports.stock_valuation'),
          headers: [t('reports.col_metric'), t('reports.col_value')],
          rows: [
            [t('reports.buying_value'), formatNaira(buyingValue)],
            [t('reports.selling_value'), formatNaira(stockValuation.sellingValue)],
            [t('reports.potential_profit'), formatNaira(stockValuation.sellingValue - buyingValue)],
          ],
        }] : []),
        ...(expenses.length > 0 ? [{
          title: t('expenses.title'),
          headers: ['Date', 'Description', 'Montant'],
          rows: [
            ...expenses.map(e => [format(new Date(e.date), 'dd MMM yyyy', { locale: dateFnsLocale(locale) }), e.description, formatNaira(e.amount)]),
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
    }
  }

  const exportPDF = async () => {
    if (!shop) { toast({ title: t('reports.error_no_shop'), variant: 'destructive' }); return }
    setExporting(true)
    try {
      const timeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('PDF generation timed out — please try again')), 45_000)
      )
      const { blob, fileName } = await Promise.race([generateReportPDFBlob(buildPdfParams()), timeout])
      const { isCapacitor } = await import('@/lib/utils/native-share')
      const isMobile = /Android|iPad|iPhone|iPod/i.test(navigator.userAgent)
      if (isCapacitor() || !isMobile) {
        // Capacitor natif ou desktop : savePDF gère directement Filesystem+Share
        await savePDF(blob, fileName)
      } else {
        // PWA mobile : action sheet pour contourner les restrictions de téléchargement
        const url = URL.createObjectURL(blob)
        setPdfSheet({ blob, url, name: fileName })
      }
    } catch (err) {
      console.error('[exportPDF]', err)
      toast({ title: t('reports.error_pdf'), description: String(err), variant: 'destructive' })
    } finally {
      setExporting(false)
    }
  }

  // Accès direct par l'adresse sans le droit « Rapports » : rien n'est chargé ni affiché
  if (!canSeeReports) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center" data-testid="reports-no-access">
        <p className="text-sm text-muted-foreground">{t('nav.no_access')}</p>
      </div>
    )
  }

  return (
    <div className="space-y-3 pb-6">
      {/* Controls */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex flex-col gap-0.5">
            <Label className="text-[10px] font-normal text-muted-foreground px-0.5">{t('reports.date_range')}</Label>
            <Select value={dateFilter} onValueChange={v => setFilter({ dateFilter: v })}>
              <SelectTrigger className="w-[165px] sm:w-[190px] text-xs sm:text-sm h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="today">{t('reports.today')}</SelectItem>
                <SelectItem value="yesterday">{t('reports.yesterday')}</SelectItem>
                <SelectItem value="week">{t('reports.this_week')}</SelectItem>
                <SelectItem value="month">{t('reports.this_month')}</SelectItem>
                <SelectItem value="quarter">{t('reports.this_quarter')}</SelectItem>
                <SelectItem value="semester">{t('reports.this_semester')}</SelectItem>
                <SelectItem value="year">{t('reports.this_year')}</SelectItem>
                <SelectItem value="custom">{t('sales.filter_custom')}</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-[10px] text-muted-foreground px-1">{getDateLabel()}</p>
          </div>
          <Button
            variant="outline"
            onClick={exportPDF}
            loading={exporting}
            className="gap-1.5 h-9 px-3 text-xs sm:text-sm"
          >
            <Download className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">{t('actions.download_pdf')}</span>
            <span className="sm:hidden">PDF</span>
          </Button>
        </div>

        {dateFilter === 'custom' && (
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 flex-1">
              <span className="text-xs text-muted-foreground flex-shrink-0">{t('reports.from_date')}</span>
              <input
                type="date"
                value={customStart}
                max={customEnd}
                onChange={e => setFilter({ customStart: e.target.value })}
                className="flex-1 h-9 rounded-md border border-input bg-background px-2 text-xs sm:text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
            <div className="flex items-center gap-1.5 flex-1">
              <span className="text-xs text-muted-foreground flex-shrink-0">{t('reports.to_date')}</span>
              <input
                type="date"
                value={customEnd}
                min={customStart}
                max={today}
                onChange={e => setFilter({ customEnd: e.target.value })}
                className="flex-1 h-9 rounded-md border border-input bg-background px-2 text-xs sm:text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
          </div>
        )}
      </div>

      {/* KPI — ligne 1 : Encaissé · Dépenses · Transactions */}
      <div className="grid grid-cols-3 gap-2">
        {[
          { key: 'widget_rep_encaisse', label: t('reports.encaisse'), amount: totals.revenue, color: 'text-stockshop-blue dark:text-blue-400', isNum: false, sub: t('reports.cash_in_register') },
          { key: 'widget_rep_depenses', label: t('expenses.title'), amount: totalExpenses, color: 'text-red-500', isNum: false, sub: null },
          { key: 'widget_rep_transactions', label: t('reports.transactions'), amount: totals.sales, color: 'text-foreground', isNum: true, sub: null },
        ].filter(item => canAccess(item.key as PermFeature)).map(item => (
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

      {/* KPI — ligne 2 : Marge brute · Bénéfice net · Crédits */}
      <div className="grid grid-cols-3 gap-2">
        {canAccess('widget_rep_marge_brute') && showMargin && (
          <Card className="border-0 shadow-sm">
            <CardContent className="p-2 sm:p-3 text-center">
              <p className="text-[10px] sm:text-xs text-muted-foreground leading-tight">{t('reports.gross_margin')}</p>
              <p className={`text-sm sm:text-base font-bold mt-0.5 truncate ${profit >= 0 ? 'text-blue-400' : 'text-red-500'}`} data-testid="reports-gross-margin">
                {loading ? '…' : formatNaira(profit)}
              </p>
              <p className="text-[9px] text-muted-foreground mt-0.5 hidden sm:block">{t('reports.gross_margin_hint')}</p>
            </CardContent>
          </Card>
        )}
        {canAccess('widget_rep_benefice_net') && showMargin && (
          <Card className="border-0 shadow-sm ring-1 ring-green-500/40">
            <CardContent className="p-2 sm:p-3 text-center">
              <p className="text-[10px] sm:text-xs text-muted-foreground leading-tight font-semibold">{t('expenses.net_profit')}</p>
              <p className={`text-sm sm:text-base font-bold mt-0.5 truncate ${profit - totalExpenses >= 0 ? 'text-green-500' : 'text-red-500'}`} data-testid="reports-net-profit">
                {loading ? '…' : formatNaira(profit - totalExpenses)}
              </p>
              <p className="text-[9px] text-muted-foreground mt-0.5 hidden sm:block">{t('reports.net_profit_hint')}</p>
            </CardContent>
          </Card>
        )}
        {canAccess('widget_rep_credits') && (
          <Card className="border-0 shadow-sm">
            <CardContent className="p-2 sm:p-3 text-center">
              <p className="text-[10px] sm:text-xs text-muted-foreground leading-tight">{t('reports.outstanding_debt')}</p>
              <p className="text-sm sm:text-base font-bold mt-0.5 truncate text-orange-500">
                {loading ? '…' : formatNaira(outstandingDebt)}
              </p>
            </CardContent>
          </Card>
        )}
      </div>

      {loading ? (
        <div className="space-y-3">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-32" />)}</div>
      ) : (
        <>
          {/* Revenue by payment method */}
          {canAccess('widget_rep_payment_chart') && (
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
          )}

          {/* Top selling products */}
          {canAccess('widget_rep_top_products') && (
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-2 px-3 sm:px-6">
              <CardTitle className="text-sm">{t('reports.top_products')}</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {topProducts.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">{t('reports.no_data')}</p>
              ) : (
                <div className="relative overflow-x-auto">
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
                          <TableCell className="text-right text-xs sm:text-sm font-medium text-stockshop-blue dark:text-blue-400 px-2 sm:px-4 whitespace-nowrap">{formatNaira(p.revenue)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
          )}

          {/* Full inventory */}
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-2 px-3 sm:px-6">
              <CardTitle className="text-sm">{t('reports.full_inventory')}</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {allInventory.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">{t('reports.no_data')}</p>
              ) : (
                <div className="relative overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="px-2 sm:px-4">{t('reports.col_product')}</TableHead>
                        <TableHead className="text-right px-2 sm:px-4">{t('reports.col_stock')}</TableHead>
                        <TableHead className="text-right px-2 sm:px-4 hidden sm:table-cell">{t('reports.col_sold_qty')}</TableHead>
                        {showMargin && <TableHead className="text-right px-2 sm:px-4 hidden sm:table-cell">{t('reports.col_buying_price')}</TableHead>}
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
                          {showMargin && <TableCell className="text-right text-xs text-muted-foreground px-2 sm:px-4 hidden sm:table-cell">{formatNaira(costOf(p.id))}</TableCell>}
                          <TableCell className="text-right text-xs sm:text-sm text-stockshop-blue dark:text-blue-400 px-2 sm:px-4 whitespace-nowrap">{formatNaira(p.selling_price)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Valorisation du stock : valeur d'achat et marge potentielle — seulement avec le droit de voir les coûts */}
          {showMargin && (
            <Card className="border-0 shadow-sm">
              <CardHeader className="pb-2 px-3 sm:px-6">
                <CardTitle className="text-sm">{t('reports.stock_valuation')}</CardTitle>
              </CardHeader>
              <CardContent className="px-3 sm:px-6">
                <div className="grid grid-cols-3 gap-2 text-center">
                  {[
                    { label: t('reports.buying_value'), value: formatNaira(buyingValue), color: 'text-muted-foreground' },
                    { label: t('reports.selling_value'), value: formatNaira(stockValuation.sellingValue), color: 'text-stockshop-blue dark:text-blue-400' },
                    { label: t('reports.potential_profit'), value: formatNaira(stockValuation.sellingValue - buyingValue), color: 'text-green-600 dark:text-green-400' },
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
                <div className="relative overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="px-2 sm:px-4 whitespace-nowrap">{t('sales.date')}</TableHead>
                        <TableHead className="px-2 sm:px-4">{t('expenses.description')}</TableHead>
                        <TableHead className="text-right px-2 sm:px-4">{t('payment.amount')}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {expenses.map(e => (
                        <TableRow key={e.id}>
                          <TableCell className="text-xs text-muted-foreground whitespace-nowrap px-2 sm:px-4">
                            {format(new Date(e.date), 'dd MMM yy', { locale: dateFnsLocale(locale) })}
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
          {canAccess('widget_rep_cashier_perf') && (isCashier ? cashierPerf.filter(c => c.id === profile?.id) : cashierPerf).length > 0 && (
            <Card className="border-0 shadow-sm">
              <CardHeader className="pb-2 px-3 sm:px-6">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <CardTitle className="text-sm">{t('reports.cashier_performance')}</CardTitle>
                  {isMultiShop ? (
                    <span className="text-[11px] font-medium text-stockshop-blue dark:text-blue-400 bg-stockshop-blue-muted dark:bg-blue-950/40 border border-stockshop-blue/20 dark:border-blue-800 rounded-full px-2 py-0.5">
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
                <div className="relative overflow-x-auto">
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
                        <TableRow key={`${c.id}:${c.shopId}`} className={c.sales === 0 ? 'opacity-50' : ''}>
                          <TableCell className="text-muted-foreground text-xs font-medium px-2 sm:px-4">
                            {isCashier ? '—' : c.sales > 0 ? (idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : idx + 1) : '—'}
                          </TableCell>
                          <TableCell className="font-medium text-xs sm:text-sm px-2 sm:px-4 max-w-[100px] truncate">{c.name}</TableCell>
                          {isMultiShop && <TableCell className="text-xs text-muted-foreground px-2 sm:px-4 hidden sm:table-cell">{c.shopName}</TableCell>}
                          <TableCell className="text-right text-xs sm:text-sm px-2 sm:px-4">{c.sales}</TableCell>
                          <TableCell className={`text-right text-xs sm:text-sm font-medium px-2 sm:px-4 whitespace-nowrap ${c.sales > 0 ? 'text-stockshop-blue dark:text-blue-400' : 'text-muted-foreground'}`}>
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

      {/* PDF action sheet — mobile only */}
      {pdfSheet && (
        <div
          className="fixed inset-0 z-50 flex flex-col justify-end bg-black/60 backdrop-blur-sm"
          onClick={closePdfSheet}
        >
          <div
            className="bg-background rounded-t-2xl shadow-2xl overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            {/* Gradient header */}
            <div
              className="relative overflow-hidden px-5 pt-5 pb-4"
              style={{ background: 'linear-gradient(135deg, #073e8a 0%, #0d52b8 100%)' }}
            >
              <div className="absolute -top-6 -right-6 h-24 w-24 rounded-full bg-white/5" />
              <div className="absolute -bottom-4 -left-4 h-16 w-16 rounded-full bg-white/5" />
              <div className="relative flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="flex h-7 w-7 items-center justify-center rounded-full bg-white/15">
                      <Download className="h-3.5 w-3.5 text-white" />
                    </div>
                    <span className="text-xs font-semibold text-blue-200 uppercase tracking-wider">{t('reports.title')}</span>
                  </div>
                  <p className="text-lg font-bold text-white leading-tight">{t('reports.pdf_ready')}</p>
                  <p className="text-xs text-blue-200/70 mt-0.5 truncate max-w-[240px]">{pdfSheet.name}</p>
                </div>
                <button
                  onClick={closePdfSheet}
                  className="flex-shrink-0 flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-white/70 hover:bg-white/20 hover:text-white transition-colors"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
            <div className="p-5 space-y-3 pb-10">

            {/* Télécharger — même mécanisme que tous les autres exports de l'app */}
            <button
              disabled={downloading}
              className="flex items-center gap-4 w-full p-4 rounded-xl bg-stockshop-blue-muted dark:bg-blue-950/40 text-stockshop-blue dark:text-blue-300 active:opacity-70 disabled:opacity-60"
              onClick={async () => {
                setDownloading(true)
                try {
                  await savePDF(pdfSheet.blob, pdfSheet.name)
                  closePdfSheet()
                } catch (err: any) {
                  if (err?.name === 'OfflineError') {
                    toast({ title: t('expenses.no_connection'), description: t('expenses.no_connection_download'), variant: 'destructive' })
                  } else if (err?.name !== 'AbortError') {
                    toast({ title: t('expenses.download_error'), description: String(err), variant: 'destructive' })
                  }
                } finally {
                  setDownloading(false)
                }
              }}
            >
              <div className="h-10 w-10 flex items-center justify-center rounded-full bg-stockshop-blue-muted dark:bg-blue-900/50 flex-shrink-0">
                {downloading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Download className="h-5 w-5" />}
              </div>
              <div className="text-left">
                <p className="font-semibold text-sm">{downloading ? t('reports.preparing') : t('actions.download')}</p>
                <p className="text-xs opacity-70">{t('reports.save_to_files')}</p>
              </div>
            </button>



            <button onClick={closePdfSheet} className="w-full py-2 text-sm text-muted-foreground">
              Annuler
            </button>
          </div>
        </div>
      </div>
      )}
    </div>
  )
}

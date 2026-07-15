'use client'

import { useState, useEffect, useMemo, Fragment, useRef } from 'react'
import { usePersistedFilters } from '@/lib/hooks/use-persisted-filters'
import { useTranslations } from 'next-intl'
import {
  Search, FileDown, FileText, ChevronDown, ChevronUp,
  XCircle, CheckCircle2, Printer, Share2, Store, CornerDownLeft, Activity, Edit2, Trash2, Plus, Clock,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useAuthContext as useAuth } from '@/lib/contexts/auth-context'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Skeleton } from '@/components/ui/skeleton'
import { PremiumDialog, PremiumDialogBody, PremiumDialogFooter } from '@/components/ui/premium-dialog'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { useToast } from '@/components/ui/use-toast'
import { useCurrency } from '@/lib/hooks/use-currency'
import { printPDFNative, downloadOrShareCSV, isCapacitor } from '@/lib/utils/native-share'
import { getCountry } from '@/lib/saas/countries'
import { normalize } from '@/lib/utils/normalize'
import { withTimeout } from '@/lib/utils/with-timeout'
import { format, startOfDay, endOfDay, subDays, subMonths, startOfWeek, startOfMonth, startOfYear } from 'date-fns'
import type { Sale } from '@/lib/types/database'
import { setPageCache, getPageCache, getPageCacheAge } from '@/lib/offline/page-cache'
import { useOffline } from '@/lib/offline/use-offline'
import { useRefetchOnReconnect } from '@/lib/hooks/use-refetch-on-reconnect'
import { getPendingSales, type PendingSale } from '@/lib/offline/db'


const supabase = createClient() as any

const statusVariant: Record<string, any> = {
  paid: 'success', partial: 'warning', pending: 'danger',
}

type DialogType = 'cancel' | 'validate'

export default function SalesHistoryPage() {
  const t = useTranslations()
  const { profile, shop, effectiveShopIds, userShops, roleInActiveShop } = useAuth()
  const isMultiShop = effectiveShopIds.length > 1

  // Resolve a payment method ID to its human-readable label using the country config
  const payMethodLabel = useMemo(() => {
    const labels = Object.fromEntries(
      getCountry(shop?.country).paymentMethods.map(m => [m.id, m.label])
    )
    return (method: string) => labels[method] ?? method
  }, [shop?.country])

  // Collect all mobile-money method IDs across every shop the user has access to
  const mobileMoneyIds = useMemo(() => {
    const shops = userShops?.length ? userShops : (shop ? [shop] : [])
    const ids = new Set<string>()
    for (const s of shops) {
      getCountry(s.country).paymentMethods
        .filter(m => m.type === 'mobile_money')
        .forEach(m => ids.add(m.id))
    }
    return Array.from(ids)
  }, [userShops, shop])

  const receiptLabels = {
    receipt: t('receipt.receipt'),
    cashier: t('receipt.cashier'),
    customer: t('receipt.customer'),
    colItem: t('receipt.col_item'),
    colQty: t('receipt.col_qty'),
    colUnitPrice: t('receipt.col_unit_price'),
    colTotal: t('receipt.col_total'),
    subtotal: t('receipt.subtotal'),
    discount: t('receipt.discount'),
    tax: t('receipt.tax'),
    total: t('receipt.total'),
    paid: t('receipt.paid'),
    via: t('receipt.via'),
    balanceDue: t('receipt.balance_due'),
    thankYou: t('receipt.thank_you'),
  }

  const printSale = async (sale: Sale) => {
    if (!shop) return
    const { generateReceiptPDFBlob } = await import('@/lib/utils/pdf')
    const blob = await generateReceiptPDFBlob({
      sale: sale as any,
      shop,
      cashierName: cashierMap[(sale as any).cashier_id] || t('sales.cashier'),
      customerName: (sale as any).customers?.name || undefined,
      labels: receiptLabels,
    })
    await printPDFNative(blob, `Recu-${sale.sale_number}.pdf`)
  }
  const { fmt: formatNaira, symbol } = useCurrency()
  const { toast } = useToast()

  const PAGE_SIZE = 100
  const SEARCH_LIMIT = 500

  const [view, setView] = useState<'sales' | 'repayments' | 'logs'>('sales')
  const [cashierMap, setCashierMap] = useState<Record<string, string>>({})
  const [repayments, setRepayments] = useState<any[]>([])
  const [loadingMore, setLoadingMore] = useState(false)
  const [salesOffset, setSalesOffset] = useState(0)
  const [hasMoreSales, setHasMoreSales] = useState(false)
  const [periodStats, setPeriodStats] = useState<{ count: number; ca: number; collected: number; balance: number } | null>(null)
  const [{ search, dateFilter, methodFilter, statusFilter, saleStatusFilter, customStart, customEnd }, setFilter] = usePersistedFilters(
    'sales_history', shop?.id,
    { search: '', dateFilter: 'today', methodFilter: 'all', statusFilter: 'all', saleStatusFilter: 'all' as 'all' | 'active' | 'cancelled', customStart: '', customEnd: '' }
  )
  // Lazy initializers: read cache synchronously so first render shows cached data, not a skeleton.
  const _sfx = dateFilter === 'custom' ? `_${customStart}_${customEnd}` : ''
  const _salesCacheKey = `sales_history_v2_${effectiveShopIds.join(',')}_${dateFilter}${_sfx}_${methodFilter}_${statusFilter}_${saleStatusFilter}`
  const [sales, setSales] = useState<Sale[]>(() => getPageCache<Sale[]>(_salesCacheKey) || [])
  const [loading, setLoading] = useState(() => !getPageCache(_salesCacheKey))
  const [expandedId, setExpandedId] = useState<string | null>(null)

  // Dialog state
  const [dialog, setDialog] = useState<{ type: DialogType; sale: Sale } | null>(null)
  const [cancelReason, setCancelReason] = useState('')
  const [validateAmount, setValidateAmount] = useState('')
  const [validateMethod, setValidateMethod] = useState('cash')
  const [actionLoading, setActionLoading] = useState(false)
  const [exportingPDF, setExportingPDF] = useState(false)
  const { isOnline, pendingCount } = useOffline()
  const [pendingSales, setPendingSales] = useState<PendingSale[]>([])
  const [logs, setLogs] = useState<any[]>([])
  const [loadingLogs, setLoadingLogs] = useState(false)
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isFirstSearchRender = useRef(true)

  // Edit dialog state
  type EditItem = { product_id: string | null; product_name: string; quantity: number; unit_price: number }
  const [editDialog, setEditDialog] = useState<Sale | null>(null)
  const [editItems, setEditItems] = useState<EditItem[]>([])
  const [editCustomerId, setEditCustomerId] = useState<string | null>(null)
  const [editCustomerQuery, setEditCustomerQuery] = useState('')
  const [editPaymentMethod, setEditPaymentMethod] = useState('cash')
  const [editNotes, setEditNotes] = useState('')
  const [editProductQuery, setEditProductQuery] = useState('')
  const [editProducts, setEditProducts] = useState<any[]>([])
  const [editCustomers, setEditCustomers] = useState<any[]>([])
  const [editSaving, setEditSaving] = useState(false)


  const effectiveRole = roleInActiveShop ?? profile?.role
  const isOwner = effectiveRole === 'owner' || effectiveRole === 'manager' || effectiveRole === 'shop_manager' || effectiveRole === 'super_admin'
  const isCashier = effectiveRole === 'cashier'

  const getDateBounds = () => {
    const now = new Date()
    let start: Date
    let end = endOfDay(now)
    switch (dateFilter) {
      case 'today': start = startOfDay(now); break
      case 'week': start = startOfWeek(now, { weekStartsOn: 1 }); break
      case 'month': start = startOfMonth(now); break
      case 'quarter': start = subMonths(now, 3); break
      case 'semester': start = subMonths(now, 6); break
      case 'year': start = startOfYear(now); break
      case 'yesterday':
        start = startOfDay(subDays(now, 1))
        end   = endOfDay(subDays(now, 1))
        break
      case 'custom':
        start = customStart ? startOfDay(new Date(customStart)) : startOfDay(subDays(now, 1))
        end   = customEnd   ? endOfDay(new Date(customEnd))     : endOfDay(now)
        break
      default: start = startOfDay(now)
    }
    return { start, end }
  }

  const buildSalesQuery = (start: Date, end: Date, offset: number, searchMode = false) => {
    let query = supabase
      .from('sales')
      .select('*, customers(name, phone), sale_items(product_id, product_name, quantity, unit_price, subtotal, products(image_url))')
      .in('shop_id', effectiveShopIds)
      .gte('created_at', start.toISOString())
      .lte('created_at', end.toISOString())
      .order('created_at', { ascending: false })

    if (searchMode) {
      query = query.limit(SEARCH_LIMIT)
    } else {
      query = query.range(offset, offset + PAGE_SIZE - 1)
    }

    if (isCashier) query = query.eq('cashier_id', profile!.id)
    if (methodFilter === 'mobile_money') query = query.in('payment_method', mobileMoneyIds.length ? mobileMoneyIds : ['__none__'])
    else if (methodFilter !== 'all') query = query.eq('payment_method', methodFilter)
    if (statusFilter !== 'all') query = query.eq('payment_status', statusFilter)
    if (saleStatusFilter !== 'all') query = query.eq('sale_status', saleStatusFilter)
    return query
  }

  // Aggregate query for accurate period totals (not limited by page size)
  const buildStatsQuery = (start: Date, end: Date) => {
    let q = supabase
      .from('sales')
      .select('total, amount_paid, balance')
      .in('shop_id', effectiveShopIds)
      .eq('sale_status', 'active')
      .gte('created_at', start.toISOString())
      .lte('created_at', end.toISOString())
    if (isCashier) q = q.eq('cashier_id', profile!.id)
    if (methodFilter === 'mobile_money') q = q.in('payment_method', mobileMoneyIds.length ? mobileMoneyIds : ['__none__'])
    else if (methodFilter !== 'all') q = q.eq('payment_method', methodFilter)
    if (statusFilter !== 'all') q = q.eq('payment_status', statusFilter)
    return q
  }

  // Cash actually collected during the period — sourced from the payments
  // ledger (paid_at), not from sales.amount_paid (created_at). A debt
  // repayment collected today retroactively bumps the ORIGINAL sale's
  // amount_paid, which stays dated to when the sale was created — so a
  // stats query keyed on sales.created_at silently attributes that cash to
  // the wrong day (or misses it entirely from "today"). Querying payments
  // directly by paid_at attributes every cash-in event (initial payment or
  // later repayment alike) to the day it was actually received.
  const buildCollectedQuery = (start: Date, end: Date) => {
    let q = supabase
      .from('payments')
      .select('amount, sales!inner(shop_id, sale_status)')
      .in('sales.shop_id', effectiveShopIds)
      .eq('sales.sale_status', 'active')
      .gte('paid_at', start.toISOString())
      .lte('paid_at', end.toISOString())
    if (isCashier) q = q.eq('received_by', profile!.id)
    if (methodFilter === 'mobile_money') q = q.in('method', mobileMoneyIds.length ? mobileMoneyIds : ['__none__'])
    else if (methodFilter !== 'all') q = q.eq('method', methodFilter)
    return q
  }

  const enrichCashiers = async (salesData: Sale[], existingMap: Record<string, string> = {}) => {
    const ids = Array.from(new Set(salesData.map((s: any) => s.cashier_id).filter((id: string) => id && !existingMap[id]))) as string[]
    if (!ids.length) return existingMap
    const { data: profiles } = await supabase.from('profiles').select('id, full_name').in('id', ids)
    const map = { ...existingMap }
    for (const p of (profiles || [])) map[p.id] = p.full_name
    return map
  }

  const fetchSales = async () => {
    if (!effectiveShopIds.length) return
    setSalesOffset(0)
    const isSearchMode = search.trim().length > 0
    const customSuffix = dateFilter === 'custom' ? `_${customStart}_${customEnd}` : ''
    const cacheKey = `sales_history_v2_${effectiveShopIds.join(',')}_${dateFilter}${customSuffix}_${methodFilter}_${statusFilter}_${saleStatusFilter}`
    if (!isSearchMode) {
      const cached = getPageCache<Sale[]>(cacheKey)
      if (cached) {
        setSales(cached)
        setHasMoreSales(false)
        setLoading(false)
        // Enrich cashier names in background — don't block render
        enrichCashiers(cached).then(map => setCashierMap(map))
      } else {
        setLoading(true)
      }
    } else {
      setLoading(true)
    }
    if (!isOnline) return
    try {
      const { start, end } = getDateBounds()
      const [listResult, statsResult, collectedResult] = await Promise.all([
        buildSalesQuery(start, end, 0, isSearchMode),
        buildStatsQuery(start, end),
        buildCollectedQuery(start, end),
      ])
      if (listResult.error) throw listResult.error
      const salesData = (listResult.data || []) as Sale[]
      const statsRows = (statsResult.data || []) as Array<{ total: number; amount_paid: number; balance: number }>
      const collectedRows = (collectedResult.data || []) as Array<{ amount: number }>
      setSales(salesData)
      setHasMoreSales(!isSearchMode && salesData.length === PAGE_SIZE)
      setCashierMap(await enrichCashiers(salesData))
      if (!isSearchMode) setPageCache(cacheKey, salesData)
      setPeriodStats({
        count:     statsRows.length,
        ca:        statsRows.reduce((s, r) => s + Number(r.total), 0),
        collected: collectedRows.reduce((s, r) => s + Number(r.amount), 0),
        balance:   statsRows.reduce((s, r) => s + Number(r.balance), 0),
      })
    } catch {
      // cache already applied if available
    } finally {
      setLoading(false)
    }
  }

  const loadMoreSales = async () => {
    if (!effectiveShopIds.length || loadingMore) return
    setLoadingMore(true)
    const nextOffset = salesOffset + PAGE_SIZE
    const { start, end } = getDateBounds()
    const { data } = await buildSalesQuery(start, end, nextOffset)
    const more = (data || []) as Sale[]
    setSales(prev => [...prev, ...more])
    setSalesOffset(nextOffset)
    setHasMoreSales(more.length === PAGE_SIZE)
    setCashierMap(await enrichCashiers(more, cashierMap))
    setLoadingMore(false)
  }

  const fetchRepayments = async () => {
    if (!effectiveShopIds.length) return
    setLoading(true)
    const { start, end } = getDateBounds()

    let query = supabase
      .from('payments')
      .select('id, amount, paid_at, method, sales!inner(shop_id, sale_number, created_at, customers(name))')
      .in('sales.shop_id', effectiveShopIds)
      .eq('is_repayment', true)
      .gte('paid_at', start.toISOString())
      .lte('paid_at', end.toISOString())
      .order('paid_at', { ascending: false })

    if (methodFilter !== 'all') query = query.eq('method', methodFilter)

    const { data } = await query
    setRepayments((data || []).filter((p: any) => effectiveShopIds.includes(p.sales?.shop_id)))
    setLoading(false)
  }

  const openEditDialog = (sale: Sale) => {
    const s = sale as any
    setEditItems((s.sale_items || []).map((item: any) => ({
      product_id: item.product_id || null,
      product_name: item.product_name,
      quantity: item.quantity,
      unit_price: item.unit_price,
    })))
    setEditCustomerId(s.customer_id || null)
    setEditCustomerQuery(s.customers?.name || '')
    setEditPaymentMethod(s.payment_method || 'cash')
    setEditNotes(s.notes || '')
    setEditProductQuery('')
    setEditProducts([])
    setEditCustomers([])
    setEditDialog(sale)
  }

  const searchEditProducts = async (q: string) => {
    if (!q.trim() || !effectiveShopIds.length) { setEditProducts([]); return }
    const { data } = await supabase
      .from('products')
      .select('id, name, selling_price, quantity')
      .in('shop_id', effectiveShopIds)
      .eq('is_active', true)
      .ilike('name', `%${normalize(q)}%`)
      .order('name').limit(8)
    setEditProducts(data || [])
  }

  const searchEditCustomers = async (q: string) => {
    if (!q.trim()) { setEditCustomers([]); return }
    const { data } = await supabase
      .from('customers')
      .select('id, name, phone')
      .in('shop_id', effectiveShopIds)
      .ilike('name', `%${q}%`)
      .limit(6)
    setEditCustomers(data || [])
  }

  const doEdit = async () => {
    if (!editDialog || editItems.length === 0) return
    setEditSaving(true)
    try {
      const res = await withTimeout(fetch('/api/sales/edit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sale_id: editDialog.id,
          customer_id: editCustomerId,
          payment_method: editPaymentMethod,
          notes: editNotes,
          items: editItems,
        }),
      }))
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      toast({ title: json.message, variant: 'success' })
      setEditDialog(null)
      fetchSales()
    } catch (err: any) {
      toast({ title: err.message, variant: 'destructive' })
    } finally {
      setEditSaving(false)
    }
  }

  const fetchLogs = async () => {
    if (!effectiveShopIds.length || !isOwner) return
    setLoadingLogs(true)
    const { start, end } = getDateBounds()
    try {
      const params = new URLSearchParams({
        shop_ids: effectiveShopIds.join(','),
        from: start.toISOString(),
        to: end.toISOString(),
      })
      const res = await fetch(`/api/sales/logs?${params}`)
      const json = await res.json()
      setLogs(json.logs || [])
    } catch {
      // ignore
    } finally {
      setLoadingLogs(false)
    }
  }

  const shopKey = effectiveShopIds.join(',')

  useEffect(() => {
    if (view === 'sales') fetchSales()
    else if (view === 'repayments') fetchRepayments()
    else fetchLogs()
  }, [shopKey, dateFilter, customStart, customEnd, methodFilter, statusFilter, saleStatusFilter, view])

  // Ventes hors-ligne pas encore synchronisées — getPendingSales() ne renvoie
  // que les non-synchronisées, donc une vente disparaît naturellement d'ici
  // dès qu'elle a réellement rejoint la liste normale au-dessus.
  useEffect(() => {
    if (!effectiveShopIds.length) return
    let cancelled = false
    Promise.all(effectiveShopIds.map(id => getPendingSales(id))).then(results => {
      if (!cancelled) setPendingSales(results.flat())
    }).catch(() => {})
    return () => { cancelled = true }
  }, [shopKey, pendingCount])

  // Debounced re-fetch when search changes: skip first render (main effect handles it)
  useEffect(() => {
    if (isFirstSearchRender.current) { isFirstSearchRender.current = false; return }
    if (view !== 'sales') return
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
    searchTimerRef.current = setTimeout(() => { fetchSales() }, 350)
    return () => { if (searchTimerRef.current) clearTimeout(searchTimerRef.current) }
  }, [search])

  const filteredRepayments = repayments.filter(p => {
    if (!search) return true
    const q = normalize(search)
    return (
      normalize(p.sales?.customers?.name ?? '').includes(q) ||
      normalize(p.sales?.sale_number ?? '').includes(q)
    )
  })

  // Refresh when tab regains focus (e.g. after recording a payment on the debts page)
  useEffect(() => {
    const onFocus = () => { if (document.visibilityState === 'visible') fetchSales() }
    document.addEventListener('visibilitychange', onFocus)
    return () => document.removeEventListener('visibilitychange', onFocus)
  }, [shopKey, dateFilter, customStart, customEnd, methodFilter, statusFilter, saleStatusFilter, view])
  useRefetchOnReconnect(fetchSales, isOnline)

  const filtered = sales.filter(s => {
    if (!search) return true
    const q = normalize(search)
    return (
      normalize(s.sale_number ?? '').includes(q) ||
      normalize((s as any).customers?.name ?? '').includes(q) ||
      normalize(cashierMap[(s as any).cashier_id] ?? '').includes(q)
    )
  })

  const exportCSV = async () => {
    const pmLabels = Object.fromEntries(
      getCountry(shop?.country).paymentMethods.map(m => [m.id, m.label])
    )
    const translateMethod = (method: string) =>
      pmLabels[method] ?? (method ? t(`payment.${method}` as any, { defaultValue: method }) : '')

    const rows = [
      [t('sales.sale_number'), t('sales.date'), t('sales.customer'), t('sales.total'), t('payment.amount_paid'), t('payment.balance'), t('sales.col_payment_method'), t('sales.col_payment_status'), t('sales.col_sale_status')],
      ...filtered.map(s => [
        s.sale_number,
        format(new Date(s.created_at), 'dd/MM/yyyy HH:mm'),
        (s as any).customers?.name || t('sales.walk_in'),
        s.total, s.amount_paid, s.balance,
        translateMethod(s.payment_method),
        s.payment_status ? t(`status.${s.payment_status}` as any, { defaultValue: s.payment_status }) : '',
        s.sale_status ? t(`status.${s.sale_status}` as any, { defaultValue: s.sale_status }) : t('status.active'),
      ]),
    ]
    const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n')
    await downloadOrShareCSV(csv, `${t('actions.csv_sales')}-${dateFilter}-${Date.now()}.csv`)
  }

  const exportPDF = async () => {
    if (!shop || !filtered.length) return
    setExportingPDF(true)
    try {
      const { generateSalesReportPDF } = await import('@/lib/utils/pdf')
      const currency = shop.currency || 'XOF'
      const isNGN = currency === 'NGN'
      const fmtAmt = (n: number) => isNGN
        ? `NGN ${n.toLocaleString('en-NG', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
        : `${n.toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })} ${currency}`
      const now = new Date()
      const periodLabel = dateFilter === 'today'
        ? format(now, 'dd/MM/yyyy')
        : dateFilter === 'week'
        ? `${format(startOfWeek(now, { weekStartsOn: 1 }), 'dd/MM')} – ${format(now, 'dd/MM/yyyy')}`
        : dateFilter === 'month'
        ? format(startOfMonth(now), 'MMMM yyyy')
        : dateFilter === 'custom' && customStart && customEnd
        ? `${format(new Date(customStart), 'dd/MM/yyyy')} – ${format(new Date(customEnd), 'dd/MM/yyyy')}`
        : dateFilter === 'yesterday'
        ? format(subDays(new Date(), 1), 'dd/MM/yyyy')
        : t('sales.filter_today')
      await generateSalesReportPDF({
        shopName: shop.name,
        period: periodLabel,
        sales: filtered.map(s => ({
          date: s.created_at,
          sale_number: s.sale_number,
          customer: (s as any).customers?.name || t('sales.walk_in'),
          total: Number(s.total),
          amount_paid: Number(s.amount_paid),
          payment_method: s.payment_method,
          payment_status: s.payment_status,
          sale_status: s.sale_status || 'active',
        })),
        pmLabels: {
          cash: t('payment.cash'),
          transfer: t('payment.transfer'),
          mobile_money: t('payment.mobile_money'),
          credit: t('payment.credit'),
        },
        statusLabels: {
          paid: t('status.paid'),
          partial: t('status.partial'),
          pending: t('status.pending'),
        },
        fmtAmt,
        labels: {
          title: t('sales.pdf_title'),
          colDate: t('sales.date'),
          colSale: t('sales.pdf_col_sale'),
          colClient: t('sales.pdf_col_client'),
          colTotal: t('sales.total'),
          colPaid: t('payment.amount_paid'),
          colMethod: t('sales.pdf_col_method'),
          colStatus: t('sales.pdf_col_status'),
          summary: t('sales.pdf_summary'),
          totalSales: t('sales.pdf_total_sales'),
          totalRevenue: t('sales.pdf_total_revenue'),
          generatedBy: t('sales.pdf_generated_by'),
          page: t('sales.pdf_page'),
          of: t('sales.pdf_of'),
        },
      })
    } catch (err: any) {
      if (err?.name !== 'AbortError') toast({ title: err.message || 'Erreur export PDF', variant: 'destructive' })
    } finally {
      setExportingPDF(false)
    }
  }

  const doAction = async () => {
    if (!dialog) return
    setActionLoading(true)
    try {
      if (dialog.type === 'cancel') {
        const res = await withTimeout(fetch('/api/sales/cancel', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sale_id: dialog.sale.id, reason: cancelReason }),
        }))
        const json = await res.json()
        if (!res.ok) throw new Error(json.error)
        toast({ title: json.message, variant: 'success' })
      } else if (dialog.type === 'validate') {
        const res = await withTimeout(fetch('/api/sales/validate-payment', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sale_id: dialog.sale.id, amount: validateAmount, method: validateMethod }),
        }))
        const json = await res.json()
        if (!res.ok) throw new Error(json.error)
        toast({ title: json.message, variant: 'success' })
      }
      setDialog(null)
      setCancelReason(''); setValidateAmount('')
      fetchSales()
    } catch (err: any) {
      toast({ title: err.message, variant: 'destructive' })
    } finally {
      setActionLoading(false)
    }
  }

  const renderSaleRow = (sale: Sale) => {
    const isCancelled = sale.sale_status === 'cancelled'
    const isPending = sale.payment_status === 'pending' || sale.payment_status === 'partial'
    const canCancelThis = !isCancelled && (
      isOwner ||
      (isCashier && sale.cashier_id === profile?.id && new Date(sale.created_at) >= startOfDay(new Date()))
    )
    return (
      <Fragment key={sale.id}>
        <TableRow
          className={`cursor-pointer ${isCancelled ? 'opacity-50 bg-red-50/30 dark:bg-red-950/20' : 'hover:bg-muted/30'}`}
          onClick={() => setExpandedId(expandedId === sale.id ? null : sale.id)}
        >
          <TableCell className="font-mono text-xs font-medium text-stockshop-blue dark:text-blue-400">
            #{sale.sale_number}
            {isCancelled && (
              <span className="ml-1.5 text-[10px] font-semibold text-red-500 bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800 rounded px-1">{t('sales.cancelled_badge')}</span>
            )}
          </TableCell>
          <TableCell className="text-sm">{(sale as any).customers?.name || t('sales.walk_in_short')}</TableCell>
          <TableCell className="hidden lg:table-cell text-xs text-muted-foreground">
            {cashierMap[(sale as any).cashier_id] || '—'}
          </TableCell>
          <TableCell className="hidden sm:table-cell text-xs text-muted-foreground">
            {format(new Date(sale.created_at), 'dd MMM · HH:mm')}
          </TableCell>
          <TableCell className="text-right font-medium">{formatNaira(sale.total)}</TableCell>
          <TableCell className="hidden md:table-cell text-right text-green-600">{formatNaira(sale.amount_paid)}</TableCell>
          <TableCell className="hidden md:table-cell text-right">
            {Number(sale.balance) > 0
              ? <span className="text-red-500">{formatNaira(sale.balance)}</span>
              : <span className="text-muted-foreground">—</span>}
          </TableCell>
          <TableCell>
            <div className="flex gap-1 flex-wrap">
              {!isCancelled && (
                <Badge variant={statusVariant[sale.payment_status]} className="text-[10px] px-1.5">
                  {t(`status.${sale.payment_status}`)}
                </Badge>
              )}
              <Badge variant="outline" className="text-[10px] px-1.5 hidden sm:inline-flex">
                {payMethodLabel(sale.payment_method ?? '')}
              </Badge>
            </div>
          </TableCell>
          <TableCell>
            {expandedId === sale.id ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </TableCell>
        </TableRow>
        {expandedId === sale.id && (
          <TableRow key={`${sale.id}-expand`}>
            <TableCell colSpan={9} className="bg-muted/20 p-0">
              <div className="p-3 space-y-2">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{t('sales.items')}</p>
                {(sale as any).sale_items?.map((item: any) => (
                  <div key={item.id} className="flex items-center justify-between gap-2 text-xs">
                    <div className="flex items-center gap-2 min-w-0">
                      {item.products?.image_url && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={item.products.image_url} alt={item.product_name} loading="lazy" decoding="async" className="h-8 w-8 rounded object-cover border border-border shrink-0" />
                      )}
                      <span className="truncate">{item.product_name} × {item.quantity} @ {formatNaira(item.unit_price)}</span>
                    </div>
                    <span className="font-medium shrink-0">{formatNaira(item.subtotal)}</span>
                  </div>
                ))}
                {sale.notes && (
                  <p className="text-xs text-muted-foreground pt-2 border-t">{t('sales.note_label')}: {sale.notes}</p>
                )}
                {isCancelled && sale.cancel_reason && (
                  <p className="text-xs text-red-500 pt-2 border-t">{t('sales.cancel_reason_label')}: {sale.cancel_reason}</p>
                )}
                <div className="flex flex-wrap gap-2 pt-2 border-t" onClick={e => e.stopPropagation()}>
                  {!isCancelled && isPending && (isOwner || isCashier) && (
                    <Button
                      size="sm" variant="outline"
                      className="gap-1.5 text-xs h-7 border-green-300 text-green-600 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-950/40"
                      onClick={() => { setDialog({ type: 'validate', sale }); setValidateAmount(String(sale.balance)) }}
                    >
                      <CheckCircle2 className="h-3 w-3" /> {t('sales.validate_payment_action')}
                    </Button>
                  )}
                  {canCancelThis && (
                    <Button
                      size="sm" variant="outline"
                      className="gap-1.5 text-xs h-7 border-blue-300 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/40"
                      onClick={() => openEditDialog(sale)}
                    >
                      <Edit2 className="h-3 w-3" /> {t('actions.edit')}
                    </Button>
                  )}
                  {canCancelThis && (
                    <Button
                      size="sm" variant="outline"
                      className="gap-1.5 text-xs h-7 border-amber-300 text-amber-600 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-950/40"
                      onClick={() => { setDialog({ type: 'cancel', sale }); setCancelReason('') }}
                    >
                      <XCircle className="h-3 w-3" /> {t('actions.cancel')}
                    </Button>
                  )}
                  {!isCancelled && (
                    <Button size="sm" variant="outline" className="gap-1.5 text-xs h-7" onClick={() => printSale(sale)}>
                      {isCapacitor() ? <Share2 className="h-3 w-3" /> : <Printer className="h-3 w-3" />}
                      {isCapacitor() ? t('actions.share') : t('actions.print')}
                    </Button>
                  )}
                </div>
              </div>
            </TableCell>
          </TableRow>
        )}
      </Fragment>
    )
  }

  const salesTableHeader = (
    <TableHeader>
      <TableRow>
        <TableHead>{t('sales.sale_number')}</TableHead>
        <TableHead>{t('sales.customer')}</TableHead>
        <TableHead className="hidden lg:table-cell">{t('sales.cashier')}</TableHead>
        <TableHead className="hidden sm:table-cell">{t('sales.date')}</TableHead>
        <TableHead className="text-right">{t('sales.total')}</TableHead>
        <TableHead className="hidden md:table-cell text-right">{t('payment.amount_paid')}</TableHead>
        <TableHead className="hidden md:table-cell text-right">{t('payment.balance')}</TableHead>
        <TableHead>{t('status.active')}</TableHead>
        <TableHead className="w-8"></TableHead>
      </TableRow>
    </TableHeader>
  )

  return (
    <div className="space-y-4">
      {/* View toggle */}
      <div className="flex gap-1 rounded-lg border bg-muted/30 p-1 w-fit">
        <button
          onClick={() => setView('sales')}
          className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${view === 'sales' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
        >
          {t('sales.sales_tab')}
        </button>
        <button
          onClick={() => setView('repayments')}
          className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors flex items-center gap-1.5 ${view === 'repayments' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
        >
          <CornerDownLeft className="h-3.5 w-3.5" /> {t('sales.repayments_tab')}
        </button>
        {isOwner && (
          <button
            onClick={() => setView('logs')}
            className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors flex items-center gap-1.5 ${view === 'logs' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
          >
            <Activity className="h-3.5 w-3.5" /> {t('sales.logs_tab')}
          </button>
        )}
      </div>

      {/* Filters row */}
      <div className="flex flex-wrap items-end gap-2">
        <div className="relative flex-1 min-w-[160px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input value={search} onChange={e => setFilter({ search: e.target.value })} placeholder={t('sales.search_history')} className="pl-9 h-9" />
        </div>

        <div className="flex flex-col gap-0.5">
          <Label className="text-[10px] font-normal text-muted-foreground px-0.5">{t('reports.date_range')}</Label>
          <Select
            value={dateFilter}
            onValueChange={v => {
              if (v === 'custom') {
                const today = format(new Date(), 'yyyy-MM-dd')
                const monthStart = format(startOfMonth(new Date()), 'yyyy-MM-dd')
                setFilter({
                  dateFilter: v,
                  customStart: customStart || monthStart,
                  customEnd:   customEnd   || today,
                })
              } else {
                setFilter({ dateFilter: v })
              }
            }}
          >
            <SelectTrigger className="w-[150px] h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="today">{t('sales.filter_today')}</SelectItem>
              <SelectItem value="yesterday">{t('sales.filter_yesterday')}</SelectItem>
              <SelectItem value="week">{t('sales.filter_week')}</SelectItem>
              <SelectItem value="month">{t('sales.filter_month')}</SelectItem>
              <SelectItem value="quarter">{t('sales.filter_quarter')}</SelectItem>
              <SelectItem value="semester">{t('sales.filter_semester')}</SelectItem>
              <SelectItem value="year">{t('sales.filter_year')}</SelectItem>
              <SelectItem value="custom">{t('sales.filter_custom')}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {dateFilter === 'custom' && (
          <>
            <Input
              type="date"
              value={customStart}
              max={customEnd || format(new Date(), 'yyyy-MM-dd')}
              onChange={e => setFilter({ customStart: e.target.value })}
              className="h-9 w-[140px]"
            />
            <Input
              type="date"
              value={customEnd}
              min={customStart}
              max={format(new Date(), 'yyyy-MM-dd')}
              onChange={e => setFilter({ customEnd: e.target.value })}
              className="h-9 w-[140px]"
            />
          </>
        )}

        <div className="flex flex-col gap-0.5">
          <Label className="text-[10px] font-normal text-muted-foreground px-0.5">Méthode</Label>
          <Select value={methodFilter} onValueChange={v => setFilter({ methodFilter: v })}>
            <SelectTrigger className="w-[140px] h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('sales.all_methods')}</SelectItem>
              <SelectItem value="cash">{t('payment.cash')}</SelectItem>
              <SelectItem value="mobile_money">{t('payment.mobile_money')}</SelectItem>
              <SelectItem value="transfer">{t('payment.transfer')}</SelectItem>
              <SelectItem value="credit">{t('payment.credit')}</SelectItem>
              <SelectItem value="paystack">{t('payment.paystack')}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {view === 'sales' && (
          <>
            <div className="flex flex-col gap-0.5">
              <Label className="text-[10px] font-normal text-muted-foreground px-0.5">Statut</Label>
              <Select value={statusFilter} onValueChange={v => setFilter({ statusFilter: v })}>
                <SelectTrigger className="w-[130px] h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('sales.all_statuses')}</SelectItem>
                  <SelectItem value="paid">{t('status.paid')}</SelectItem>
                  <SelectItem value="partial">{t('status.partial')}</SelectItem>
                  <SelectItem value="pending">{t('status.pending')}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-0.5">
              <Label className="text-[10px] font-normal text-muted-foreground px-0.5">Vente</Label>
              <Select value={saleStatusFilter} onValueChange={v => setFilter({ saleStatusFilter: v as any })}>
                <SelectTrigger className="w-[130px] h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('sales.filter_all')}</SelectItem>
                  <SelectItem value="active">{t('sales.filter_active')}</SelectItem>
                  <SelectItem value="cancelled">{t('sales.filter_cancelled')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </>
        )}

        {isOwner && (
          <>
            <Button variant="outline" size="sm" onClick={exportCSV} className="h-9 gap-1">
              <FileDown className="h-3.5 w-3.5" /> CSV
            </Button>
            <Button variant="outline" size="sm" onClick={exportPDF} disabled={exportingPDF} className="h-9 gap-1">
              <FileText className="h-3.5 w-3.5" />
              {exportingPDF ? t('expenses.exporting') : 'PDF'}
            </Button>
          </>
        )}
      </div>

      {/* Date range label */}
      {dateFilter !== 'custom' && (() => {
        const { start, end } = getDateBounds()
        const fmt = (d: Date) => format(d, 'd MMM yyyy')
        const startStr = fmt(start)
        const endStr   = fmt(end)
        const label = startStr === endStr ? startStr : `${startStr} – ${endStr}`
        return <p className="text-xs text-muted-foreground -mt-1">{label}</p>
      })()}

      {/* ── Repayments view ─────────────────────────────────── */}
      {view === 'repayments' && (() => {
        const repaymentTableHeader = (
          <TableHeader>
            <TableRow>
              <TableHead>{t('sales.customer')}</TableHead>
              <TableHead className="hidden sm:table-cell">{t('sales.sale_number')}</TableHead>
              <TableHead className="hidden sm:table-cell">{t('sales.date')}</TableHead>
              <TableHead>{t('payment.method')}</TableHead>
              <TableHead className="text-right">{t('sales.total')}</TableHead>
            </TableRow>
          </TableHeader>
        )
        const renderRepaymentRow = (p: any) => (
          <TableRow key={p.id}>
            <TableCell className="font-medium text-sm">
              <CornerDownLeft className="inline h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400 mr-1.5" />
              {p.sales?.customers?.name || '—'}
            </TableCell>
            <TableCell className="hidden sm:table-cell font-mono text-xs text-stockshop-blue dark:text-blue-400">
              #{p.sales?.sale_number}
            </TableCell>
            <TableCell className="hidden sm:table-cell text-xs text-muted-foreground">
              {format(new Date(p.paid_at), 'dd MMM · HH:mm')}
            </TableCell>
            <TableCell>
              <Badge variant="outline" className="text-[10px] px-1.5 border-emerald-300 text-emerald-600 dark:text-emerald-400">
                {payMethodLabel(p.method)}
              </Badge>
            </TableCell>
            <TableCell className="text-right font-semibold text-emerald-600 dark:text-emerald-400">
              +{formatNaira(p.amount)}
            </TableCell>
          </TableRow>
        )
        if (loading) return (
          <div className="rounded-lg border bg-card shadow-sm overflow-hidden">
            <div className="p-4 space-y-2">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
          </div>
        )

        const repaymentTotal = filteredRepayments.reduce((s: number, p: any) => s + Number(p.amount), 0)

        return (
          <div className="space-y-2">
            {isOwner && filteredRepayments.length > 0 && (
              <div className="flex gap-4 text-sm flex-wrap">
                <span className="text-muted-foreground">
                  {filteredRepayments.length} {t('sales.repayments_tab').toLowerCase()} ·{' '}
                  <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                    +{formatNaira(repaymentTotal)}
                  </span>
                </span>
              </div>
            )}

            {filteredRepayments.length === 0 ? (
              <div className="rounded-lg border bg-card shadow-sm overflow-hidden">
                <div className="flex h-32 items-center justify-center text-muted-foreground text-sm">{t('sales.no_repayments')}</div>
              </div>
            ) : isMultiShop ? (
              <div className="space-y-4">
                {userShops.filter(s => effectiveShopIds.includes(s.id)).map(shopEntry => {
                  const shopRepayments = filteredRepayments.filter((p: any) => p.sales?.shop_id === shopEntry.id)
                  if (!shopRepayments.length) return null
                  const shopTotal = shopRepayments.reduce((s: number, p: any) => s + Number(p.amount), 0)
                  return (
                    <div key={shopEntry.id} className="space-y-2">
                      <div className="flex items-center gap-2 pt-1">
                        <Store className="h-3.5 w-3.5 text-stockshop-blue dark:text-blue-400 flex-shrink-0" />
                        <span className="text-xs font-semibold text-stockshop-blue dark:text-blue-400 uppercase tracking-wide">{shopEntry.name}</span>
                        <span className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">+{formatNaira(shopTotal)}</span>
                        <div className="flex-1 h-px bg-border" />
                      </div>
                      <div className="rounded-lg border bg-card shadow-sm overflow-hidden">
                        <Table>{repaymentTableHeader}<TableBody>{shopRepayments.map(renderRepaymentRow)}</TableBody></Table>
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : (
              <div className="rounded-lg border bg-card shadow-sm overflow-hidden">
                <Table>{repaymentTableHeader}<TableBody>{filteredRepayments.map(renderRepaymentRow)}</TableBody></Table>
              </div>
            )}
          </div>
        )
      })()}

      {/* ── Sales view ──────────────────────────────────────── */}
      {view === 'sales' && isOwner && periodStats !== null && (
        <div className="flex gap-x-4 gap-y-0.5 text-sm flex-wrap">
          <span className="text-muted-foreground">
            {periodStats.count} {t('sales.sales_count_label')} ·{' '}
            <span className="font-semibold text-foreground">{formatNaira(periodStats.collected)}</span>
            <span className="text-muted-foreground font-normal"> encaissé</span>
          </span>
          {periodStats.ca !== periodStats.collected && (
            <span className="text-muted-foreground text-xs self-center">
              CA : {formatNaira(periodStats.ca)}
            </span>
          )}
          {periodStats.balance > 0 && (
            <span className="text-red-500">
              {t('sales.balance_summary')}: {formatNaira(periodStats.balance)}
            </span>
          )}
        </div>
      )}

      {/* Ventes hors-ligne en attente de synchronisation */}
      {view === 'sales' && pendingSales.length > 0 && (
        <div className="rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/20 overflow-hidden">
          <div className="px-3 py-2 flex items-center gap-2 border-b border-amber-200 dark:border-amber-800">
            <Clock className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400 flex-shrink-0" />
            <span className="text-xs font-semibold text-amber-700 dark:text-amber-400 uppercase tracking-wide">
              {t('sales.pending_sync_title', { count: pendingSales.length })}
            </span>
          </div>
          <div className="divide-y divide-amber-100 dark:divide-amber-900">
            {pendingSales.map(sale => (
              <div key={sale.local_id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                <div className="min-w-0">
                  <p className="font-medium truncate">{sale.customer_name || t('sales.walk_in_short')}</p>
                  <p className="text-xs text-muted-foreground">{format(new Date(sale.created_at), 'dd MMM · HH:mm')}</p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className="font-medium">{formatNaira(sale.total)}</span>
                  <Badge variant="warning" className="text-[10px] px-1.5">{t('sales.pending_sync_badge')}</Badge>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Table */}
      {view === 'sales' && (
        loading ? (
          <div className="rounded-lg border bg-card shadow-sm overflow-hidden">
            <div className="p-4 space-y-2">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
          </div>
        ) : filtered.length === 0 ? (
          <div className="rounded-lg border bg-card shadow-sm overflow-hidden">
            <div className="flex h-32 items-center justify-center text-muted-foreground text-sm">{t('sales.no_sales')}</div>
          </div>
        ) : isMultiShop ? (
          <div className="space-y-4">
            {userShops.filter(s => effectiveShopIds.includes(s.id)).map(shopEntry => {
              const shopSales = filtered.filter(s => (s as any).shop_id === shopEntry.id)
              if (!shopSales.length) return null
              return (
                <div key={shopEntry.id} className="space-y-2">
                  <div className="flex items-center gap-2 pt-1">
                    <Store className="h-3.5 w-3.5 text-stockshop-blue dark:text-blue-400 flex-shrink-0" />
                    <span className="text-xs font-semibold text-stockshop-blue dark:text-blue-400 uppercase tracking-wide">{shopEntry.name}</span>
                    <span className="text-xs text-muted-foreground ml-1">
                      {shopSales.filter(s => (s.sale_status || 'active') === 'active').length} {t('sales.sales_count_label')} ·{' '}
                      {formatNaira(shopSales.filter(s => (s.sale_status || 'active') === 'active').reduce((acc, s) => acc + Number(s.total), 0))}
                    </span>
                    <div className="flex-1 h-px bg-border" />
                  </div>
                  <div className="rounded-lg border bg-card shadow-sm overflow-hidden">
                    <Table>
                      {salesTableHeader}
                      <TableBody>{shopSales.map(renderSaleRow)}</TableBody>
                    </Table>
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          <div className="rounded-lg border bg-card shadow-sm overflow-hidden">
            <Table>
              {salesTableHeader}
              <TableBody>{filtered.map(renderSaleRow)}</TableBody>
            </Table>
          </div>
        )
      )}

      {/* Load more */}
      {view === 'sales' && !loading && hasMoreSales && (
        <div className="flex justify-center pt-1">
          <Button variant="outline" size="sm" onClick={loadMoreSales} loading={loadingMore}>
            {t('actions.load_more')}
          </Button>
        </div>
      )}

      {/* ── Activity log view ───────────────────────────────── */}
      {view === 'logs' && (
        loadingLogs ? (
          <div className="space-y-2">
            {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-16 rounded-lg" />)}
          </div>
        ) : logs.length === 0 ? (
          <div className="rounded-lg border bg-card shadow-sm flex h-32 items-center justify-center text-muted-foreground text-sm">
            {t('sales.no_logs')}
          </div>
        ) : (
          <div className="rounded-lg border bg-card shadow-sm divide-y overflow-hidden">
            {logs.map(log => {
              const isCancel   = log.action === 'sale.cancel'
              const isValidate = log.action === 'sale.validate_payment'
              const isEdit     = log.action === 'sale.edit'
              const saleNum = log.metadata?.sale_number || log.target_id
              const iconCls = isCancel
                ? 'bg-red-100 dark:bg-red-950/50 text-red-600 dark:text-red-400'
                : isEdit
                  ? 'bg-blue-100 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400'
                  : 'bg-green-100 dark:bg-green-950/50 text-green-600 dark:text-green-400'
              const actionLabel = isCancel
                ? t('sales.log_action_cancel')
                : isEdit
                  ? t('sales.log_action_edit')
                  : t('sales.log_action_validate')
              return (
                <div key={log.id} className="flex items-start gap-3 p-3">
                  <div className={`mt-0.5 flex-shrink-0 rounded-full p-1.5 ${iconCls}`}>
                    {isCancel ? <XCircle className="h-3.5 w-3.5" /> : isEdit ? <Edit2 className="h-3.5 w-3.5" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm leading-snug">
                        <span className="font-medium">{log.actor_name}</span>{' '}
                        <span className="text-muted-foreground">{actionLabel}</span>{' '}
                        <span className="font-mono text-xs font-semibold text-stockshop-blue dark:text-blue-400">
                          #{saleNum}
                        </span>
                      </p>
                      <span className="text-xs text-muted-foreground whitespace-nowrap flex-shrink-0 mt-0.5">
                        {format(new Date(log.created_at), 'dd MMM · HH:mm')}
                      </span>
                    </div>
                    {isCancel && log.metadata?.reason && (
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {t('sales.log_reason_label')} {log.metadata.reason}
                      </p>
                    )}
                    {isValidate && log.metadata?.amount != null && (
                      <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-0.5">
                        +{formatNaira(log.metadata.amount)}
                        {log.metadata.method ? ` · ${payMethodLabel(log.metadata.method)}` : ''}
                      </p>
                    )}
                    {isEdit && log.metadata?.new_total != null && (
                      <p className="text-xs text-blue-600 dark:text-blue-400 mt-0.5">
                        {formatNaira(log.metadata.old_total)} → {formatNaira(log.metadata.new_total)}
                      </p>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )
      )}

      {/* ── Edit sale dialog ───────────────────────────────── */}
      <Dialog open={!!editDialog} onOpenChange={open => !open && setEditDialog(null)}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Edit2 className="h-4 w-4" />
              {t('sales.edit_sale_title')} <span className="font-mono text-stockshop-blue dark:text-blue-400">#{(editDialog as any)?.sale_number}</span>
            </DialogTitle>
          </DialogHeader>

          {editDialog && (() => {
            const amountPaid = Number((editDialog as any).amount_paid || 0)
            const editNewTotal = editItems.reduce((s, i) => s + i.quantity * i.unit_price, 0)
            const overCollected = amountPaid > editNewTotal && editItems.length > 0

            return (
              <div className="space-y-4 py-2">
                {/* Items */}
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    {t('sales.edit_items_section')}
                  </p>
                  {editItems.map((item, idx) => (
                    <div key={idx} className="flex items-center gap-2 text-sm">
                      <span className="flex-1 truncate text-xs">{item.product_name}</span>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          className="h-6 w-6 rounded border flex items-center justify-center text-muted-foreground hover:bg-muted"
                          onClick={() => setEditItems(prev => prev.map((it, i) => i === idx && it.quantity > 1 ? { ...it, quantity: it.quantity - 1 } : it))}
                        >−</button>
                        <input
                          type="number"
                          min={1}
                          value={item.quantity}
                          onChange={e => setEditItems(prev => prev.map((it, i) => i === idx ? { ...it, quantity: Math.max(1, Number(e.target.value) || 1) } : it))}
                          className="w-12 h-6 rounded border text-center text-xs bg-background"
                        />
                        <button
                          type="button"
                          className="h-6 w-6 rounded border flex items-center justify-center text-muted-foreground hover:bg-muted"
                          onClick={() => setEditItems(prev => prev.map((it, i) => i === idx ? { ...it, quantity: it.quantity + 1 } : it))}
                        >+</button>
                      </div>
                      <input
                        type="number"
                        min={0}
                        value={item.unit_price}
                        onChange={e => setEditItems(prev => prev.map((it, i) => i === idx ? { ...it, unit_price: Number(e.target.value) || 0 } : it))}
                        className="w-24 h-6 rounded border text-right text-xs bg-background px-1"
                      />
                      <span className="w-20 text-right text-xs font-medium shrink-0">
                        {formatNaira(item.quantity * item.unit_price)}
                      </span>
                      <button
                        type="button"
                        className="text-red-400 hover:text-red-600 flex-shrink-0"
                        onClick={() => setEditItems(prev => prev.filter((_, i) => i !== idx))}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}

                  {/* Product search to add items */}
                  <div className="relative mt-1">
                    <div className="relative">
                      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                      <Input
                        value={editProductQuery}
                        onChange={e => { setEditProductQuery(e.target.value); searchEditProducts(e.target.value) }}
                        placeholder={t('sales.edit_product_search')}
                        className="pl-8 h-8 text-xs"
                      />
                    </div>
                    {editProducts.length > 0 && (
                      <div className="absolute z-50 top-full mt-1 w-full rounded-lg border bg-popover shadow-lg overflow-hidden">
                        {editProducts.map(p => (
                          <button
                            key={p.id}
                            type="button"
                            className="w-full flex items-center justify-between px-3 py-2 text-xs hover:bg-muted text-left"
                            onClick={() => {
                              setEditItems(prev => {
                                const existing = prev.findIndex(it => it.product_id === p.id)
                                if (existing >= 0) return prev.map((it, i) => i === existing ? { ...it, quantity: it.quantity + 1 } : it)
                                return [...prev, { product_id: p.id, product_name: p.name, quantity: 1, unit_price: p.selling_price }]
                              })
                              setEditProductQuery('')
                              setEditProducts([])
                            }}
                          >
                            <span className="truncate">{p.name}</span>
                            <span className="text-muted-foreground ml-2 shrink-0">{formatNaira(p.selling_price)} · stock: {p.quantity}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* New total */}
                <div className={`flex items-center justify-between rounded-lg px-3 py-2 text-sm font-semibold ${overCollected ? 'bg-red-50 dark:bg-red-950/30 text-red-600 dark:text-red-400' : 'bg-muted/50'}`}>
                  <span>{t('sales.edit_new_total')}</span>
                  <span>{formatNaira(editNewTotal)}</span>
                </div>
                {overCollected && (
                  <p className="text-xs text-red-500">{t('sales.edit_amount_paid_warning')}</p>
                )}

                {/* Customer */}
                <div className="space-y-1">
                  <Label className="text-xs">{t('sales.edit_customer_section')}</Label>
                  <div className="relative">
                    <Input
                      value={editCustomerQuery}
                      onChange={e => {
                        setEditCustomerQuery(e.target.value)
                        if (!e.target.value) { setEditCustomerId(null); setEditCustomers([]) }
                        else searchEditCustomers(e.target.value)
                      }}
                      placeholder={t('sales.edit_customer_placeholder')}
                      className="h-8 text-xs"
                    />
                    {editCustomers.length > 0 && (
                      <div className="absolute z-50 top-full mt-1 w-full rounded-lg border bg-popover shadow-lg overflow-hidden">
                        {editCustomers.map(c => (
                          <button
                            key={c.id}
                            type="button"
                            className="w-full flex items-center justify-between px-3 py-2 text-xs hover:bg-muted text-left"
                            onClick={() => { setEditCustomerId(c.id); setEditCustomerQuery(c.name); setEditCustomers([]) }}
                          >
                            <span>{c.name}</span>
                            {c.phone && <span className="text-muted-foreground">{c.phone}</span>}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* Payment method */}
                <div className="space-y-1">
                  <Label className="text-xs">{t('payment.method')}</Label>
                  <Select value={editPaymentMethod} onValueChange={setEditPaymentMethod}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {(shop?.country ? getCountry(shop.country).paymentMethods : []).map(m => (
                        <SelectItem key={m.id} value={m.id}>{m.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Notes */}
                <div className="space-y-1">
                  <Label className="text-xs">{t('sales.note_label')}</Label>
                  <Input
                    value={editNotes}
                    onChange={e => setEditNotes(e.target.value)}
                    placeholder={t('sales.edit_notes_placeholder')}
                    className="h-8 text-xs"
                  />
                </div>
              </div>
            )
          })()}

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setEditDialog(null)}>{t('actions.cancel')}</Button>
            <Button
              onClick={doEdit}
              disabled={editSaving || editItems.length === 0 || Number((editDialog as any)?.amount_paid || 0) > editItems.reduce((s, i) => s + i.quantity * i.unit_price, 0)}
              loading={editSaving}
              className="bg-blue-600 hover:bg-blue-700 text-white border-0"
            >
              {t('sales.edit_save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Action dialog */}
      <PremiumDialog
        open={!!dialog}
        onOpenChange={open => !open && setDialog(null)}
        category="Ventes"
        title={dialog?.type === 'cancel' ? t('sales.cancel_sale_dialog_title') : t('sales.validate_payment_dialog_title')}
        icon={dialog?.type === 'cancel' ? <XCircle className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
      >
        <PremiumDialogBody className="space-y-3">
          {dialog?.type === 'cancel' && (
            <>
              <p className="text-sm text-muted-foreground">
                {t('confirm.cancel_sale')} <strong>#{dialog.sale.sale_number}</strong>
              </p>
              <div className="space-y-1">
                <Label className="text-xs">{t('sales.cancel_reason_label')} ({t('form.optional')})</Label>
                <Input
                  value={cancelReason}
                  onChange={e => setCancelReason(e.target.value)}
                  placeholder={t('sales.cancel_reason_placeholder')}
                  autoFocus
                />
              </div>
            </>
          )}

          {dialog?.type === 'validate' && dialog.sale && (
            <>
              <p className="text-sm text-muted-foreground">
                {t('sales.remaining_balance_label')}: <strong>{formatNaira(dialog.sale.balance)}</strong>
              </p>
              <div className="space-y-1">
                <Label className="text-xs">{t('payment.amount_paid')}</Label>
                <Input
                  type="number"
                  value={validateAmount}
                  onChange={e => setValidateAmount(e.target.value)}
                  autoFocus
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">{t('payment.method')}</Label>
                <Select value={validateMethod} onValueChange={setValidateMethod}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cash">{t('payment.cash')}</SelectItem>
                    <SelectItem value="transfer">{t('payment.transfer')}</SelectItem>
                    <SelectItem value="paystack">{t('payment.paystack')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </>
          )}
        </PremiumDialogBody>
        <PremiumDialogFooter
          onCancel={() => setDialog(null)}
          cancelLabel={t('actions.cancel')}
        >
          <Button
            className={`flex-1 h-11 rounded-xl font-semibold text-white border-0 ${dialog?.type === 'cancel' ? 'bg-amber-600 hover:bg-amber-700' : 'bg-green-600 hover:bg-green-700'}`}
            loading={actionLoading}
            onClick={doAction}
          >
            {dialog?.type === 'cancel' ? t('actions.confirm') : t('sales.validate_payment_action')}
          </Button>
        </PremiumDialogFooter>
      </PremiumDialog>
    </div>
  )
}

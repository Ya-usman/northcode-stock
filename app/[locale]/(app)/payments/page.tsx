'use client'

import { useState, useEffect, useRef, useMemo } from 'react'
import { useTranslations } from 'next-intl'
import { useAuthContext as useAuth } from '@/lib/contexts/auth-context'
import { generateDebtReceiptPDFBlob } from '@/lib/utils/pdf'
import { sharePDFNative, printPDFNative, isCapacitor } from '@/lib/utils/native-share'
import { normalize } from '@/lib/utils/normalize'
import { withTimeout } from '@/lib/utils/with-timeout'
import { useToast } from '@/components/ui/use-toast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { PremiumDialog, PremiumDialogBody, PremiumDialogFooter } from '@/components/ui/premium-dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { useCurrency } from '@/lib/hooks/use-currency'
import type { Customer, Supplier } from '@/lib/types/database'
import {
  ChevronDown, ChevronUp, Clock, CheckCircle2,
  History, User, RefreshCw, Banknote, Store,
  Printer, Share2, Search, CalendarDays,
} from 'lucide-react'
import { DebtGauge } from '@/components/dashboard/recent-sales-feed'
import { getCountry, getMethodType } from '@/lib/saas/countries'
import { formatInputValue } from '@/lib/utils/currency'
import { format } from 'date-fns'
import { fr } from 'date-fns/locale'
import { setPageCache, getPageCache } from '@/lib/offline/page-cache'
import { useOffline } from '@/lib/offline/use-offline'
import { useRefetchOnReconnect } from '@/lib/hooks/use-refetch-on-reconnect'

interface UnpaidSale {
  id: string
  sale_number: string
  created_at: string
  total: number
  balance: number
  amount_paid: number
  payment_status: string
  cashier_name?: string | null
  sale_items?: { product_name: string; quantity: number; subtotal: number }[]
}

interface CustomerDebt {
  customer: Customer
  unpaidSales: UnpaidSale[]
  totalDebt: number
}

interface PaymentRecord {
  id: string
  sale_id: string
  paid_at: string
  amount: number
  method: string
  reference: string | null
  notes: string | null
  received_by_name: string | null
}

interface SaleRecord {
  id: string
  sale_number: string
  created_at: string
  total: number
  amount_paid: number
  balance: number
  payment_status: string
  payment_method: string
  cashier_name: string | null
  sale_items: { product_name: string; quantity: number; unit_price: number; subtotal: number }[]
}

interface FifoLine {
  sale: UnpaidSale
  applying: number
  fullyCovered: boolean
}

interface HistCustomerEntry {
  customer: Customer
  sales: {
    id: string
    sale_number: string
    created_at: string
    total: number
    amount_paid: number
    balance: number
    payment_status: string
    cashier_name: string | null
    sale_items: { product_name: string; quantity: number; subtotal: number }[]
  }[]
  totalOwed: number
  totalPaid: number
  totalRemaining: number
  isSolde: boolean
}

const STATUS_VARIANTS: Record<string, 'destructive' | 'warning' | 'success'> = {
  pending: 'destructive',
  partial: 'warning',
  paid: 'success',
}

function calcFifo(amount: number, sales: UnpaidSale[]): FifoLine[] {
  let remaining = amount
  const lines: FifoLine[] = []
  for (const sale of sales) {
    if (remaining <= 0) break
    const applying = Math.min(remaining, sale.balance)
    remaining -= applying
    lines.push({ sale, applying, fullyCovered: applying >= sale.balance - 0.01 })
  }
  return lines
}

// ── Comptes fournisseurs (accounts payable) — miroir du système client
// ci-dessus (customers.total_debt / sales / payments), appliqué à ce que
// la boutique doit à ses fournisseurs. Voir migration 093.
interface UnpaidPO {
  id: string
  reference: string
  created_at: string
  total_amount: number
  balance: number
  amount_paid: number
  payment_status: string
  status: string
  purchase_order_items?: { product_name: string; quantity_ordered: number; quantity_received: number | null; unit_price: number | null }[]
}

interface SupplierDebt {
  supplier: Supplier
  unpaidPOs: UnpaidPO[]
  totalOwed: number
}

interface SupplierPaymentRecord {
  id: string
  purchase_order_id: string
  paid_at: string
  amount: number
  method: string
  reference: string | null
  notes: string | null
  paid_by_name: string | null
}

interface POFifoLine {
  po: UnpaidPO
  applying: number
  fullyCovered: boolean
}

interface HistSupplierEntry {
  supplier: Supplier
  purchaseOrders: UnpaidPO[]
  totalOwed: number
  totalPaid: number
  totalRemaining: number
  isSolde: boolean
}

function calcFifoPOs(amount: number, pos: UnpaidPO[]): POFifoLine[] {
  let remaining = amount
  const lines: POFifoLine[] = []
  for (const po of pos) {
    if (remaining <= 0) break
    const applying = Math.min(remaining, po.balance)
    remaining -= applying
    lines.push({ po, applying, fullyCovered: applying >= po.balance - 0.01 })
  }
  return lines
}

function DebtorCard({ customer, unpaidSales, totalDebt, isExpanded, setExpandedId, openRepayDialog, openHistory, fmt, t, saving }: any) {
  const paidTotal = unpaidSales.reduce((s: number, sale: UnpaidSale) => s + sale.amount_paid, 0)
  const grandTotal = unpaidSales.reduce((s: number, sale: UnpaidSale) => s + sale.total, 0)
  const progress = grandTotal > 0 ? Math.min(100, (paidTotal / grandTotal) * 100) : 0

  return (
    <Card className="border-0 shadow-sm overflow-hidden">
      <CardContent className="p-0">
        <div className="p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0 flex-1">
              <div className="h-9 w-9 rounded-full bg-red-100 dark:bg-red-950/40 flex items-center justify-center flex-shrink-0">
                <User className="h-4 w-4 text-red-600" />
              </div>
              <div className="min-w-0">
                <p className="font-semibold text-sm truncate">{customer.name}</p>
                {customer.phone && <p className="text-xs text-muted-foreground">{customer.phone}</p>}
                {customer.city && <Badge variant="outline" className="text-[10px] px-1.5 mt-0.5">{customer.city}</Badge>}
              </div>
            </div>
            <div className="text-right flex-shrink-0">
              <p className="text-lg font-bold text-red-600">{fmt(totalDebt)}</p>
              <p className="text-xs text-muted-foreground">{t('payments.invoices_count', { count: unpaidSales.length })}</p>
            </div>
          </div>

          {/* Progress bar */}
          {grandTotal > 0 && (
            <div className="mt-3">
              <div className="flex justify-between text-[10px] text-muted-foreground mb-1">
                <span>{t('payment.already_paid')}: {fmt(paidTotal)}</span>
              </div>
              <DebtGauge pct={progress} remaining={totalDebt} fmt={fmt} t={t} />
            </div>
          )}

          <div className="flex gap-2 mt-3">
            <Button variant="stockshop" size="sm" className="flex-1 h-9 text-xs gap-1"
              disabled={saving}
              onClick={() => openRepayDialog({ customer, unpaidSales, totalDebt })}>
              <Banknote className="h-3.5 w-3.5" /> {t('payments.repay')}
            </Button>
            <Button size="sm" variant="outline" className="flex-1 h-9 text-xs gap-1"
              disabled={saving}
              onClick={() => openHistory({ customer, unpaidSales, totalDebt })}>
              <History className="h-3.5 w-3.5" /> {t('payments.history_btn')}
            </Button>
            <Button size="sm" variant="ghost" className="h-9 w-9 p-0 flex-shrink-0"
              onClick={() => setExpandedId(isExpanded ? null : customer.id)}>
              {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </Button>
          </div>
        </div>

        {isExpanded && (
          <div className="border-t bg-muted/40 px-4 py-3 space-y-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{t('payments.unpaid_invoices')}</p>
            {unpaidSales.map((sale: UnpaidSale) => (
              <div key={sale.id} className="bg-card rounded-lg border p-3 space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-stockshop-blue dark:text-blue-400 font-semibold text-sm">#{sale.sale_number}</span>
                  <Badge variant={sale.payment_status === 'partial' ? 'warning' : 'destructive'} className="text-[10px]">
                    {sale.payment_status === 'partial' ? t('payments.partial_label') : t('payments.unpaid_label')}
                  </Badge>
                </div>
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>{format(new Date(sale.created_at), 'dd MMM yyyy', { locale: fr })}</span>
                  <span>Total: {fmt(sale.total)}</span>
                </div>
                {sale.amount_paid > 0 && (
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-green-600">{t('payment.already_paid')}: {fmt(sale.amount_paid)}</span>
                    <span className="font-bold text-red-600">{t('payment.remaining')}: {fmt(sale.balance)}</span>
                  </div>
                )}
                {sale.amount_paid === 0 && (
                  <div className="flex justify-end">
                    <span className="text-xs font-bold text-red-600">{t('payment.due')}: {fmt(sale.balance)}</span>
                  </div>
                )}
                {sale.cashier_name && <p className="text-[11px] text-muted-foreground">{t('payments.sold_by')} : <strong>{sale.cashier_name}</strong></p>}
                {sale.sale_items && sale.sale_items.length > 0 && (
                  <div className="pt-1 border-t space-y-0.5">
                    {sale.sale_items.map((item: any, idx: number) => (
                      <div key={idx} className="flex justify-between text-[11px] text-muted-foreground">
                        <span>{item.product_name} × {item.quantity}</span>
                        <span>{fmt(item.subtotal)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function SupplierDebtorCard({ supplier, unpaidPOs, totalOwed, isExpanded, setExpandedId, openRepayDialog, openHistory, fmt, t, saving }: any) {
  const paidTotal = unpaidPOs.reduce((s: number, po: UnpaidPO) => s + po.amount_paid, 0)
  const grandTotal = unpaidPOs.reduce((s: number, po: UnpaidPO) => s + po.total_amount, 0)
  const progress = grandTotal > 0 ? Math.min(100, (paidTotal / grandTotal) * 100) : 0

  return (
    <Card className="border-0 shadow-sm overflow-hidden">
      <CardContent className="p-0">
        <div className="p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0 flex-1">
              <div className="h-9 w-9 rounded-full bg-amber-100 dark:bg-amber-950/40 flex items-center justify-center flex-shrink-0">
                <Store className="h-4 w-4 text-amber-600" />
              </div>
              <div className="min-w-0">
                <p className="font-semibold text-sm truncate">{supplier.name}</p>
                {supplier.phone && <p className="text-xs text-muted-foreground">{supplier.phone}</p>}
                {supplier.city && <Badge variant="outline" className="text-[10px] px-1.5 mt-0.5">{supplier.city}</Badge>}
              </div>
            </div>
            <div className="text-right flex-shrink-0">
              <p className="text-lg font-bold text-amber-600">{fmt(totalOwed)}</p>
              <p className="text-xs text-muted-foreground">{t('payments.orders_count', { count: unpaidPOs.length })}</p>
            </div>
          </div>

          {grandTotal > 0 && (
            <div className="mt-3">
              <div className="flex justify-between text-[10px] text-muted-foreground mb-1">
                <span>{t('payment.already_paid')}: {fmt(paidTotal)}</span>
              </div>
              <DebtGauge pct={progress} remaining={totalOwed} fmt={fmt} t={t} />
            </div>
          )}

          <div className="flex gap-2 mt-3">
            <Button variant="stockshop" size="sm" className="flex-1 h-9 text-xs gap-1"
              disabled={saving}
              onClick={() => openRepayDialog({ supplier, unpaidPOs, totalOwed })}>
              <Banknote className="h-3.5 w-3.5" /> {t('payments.repay')}
            </Button>
            <Button size="sm" variant="outline" className="flex-1 h-9 text-xs gap-1"
              disabled={saving}
              onClick={() => openHistory({ supplier, unpaidPOs, totalOwed })}>
              <History className="h-3.5 w-3.5" /> {t('payments.history_btn')}
            </Button>
            <Button size="sm" variant="ghost" className="h-9 w-9 p-0 flex-shrink-0"
              onClick={() => setExpandedId(isExpanded ? null : supplier.id)}>
              {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </Button>
          </div>
        </div>

        {isExpanded && (
          <div className="border-t bg-muted/40 px-4 py-3 space-y-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{t('payments.unpaid_orders')}</p>
            {unpaidPOs.map((po: UnpaidPO) => (
              <div key={po.id} className="bg-card rounded-lg border p-3 space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-stockshop-blue dark:text-blue-400 font-semibold text-sm">{po.reference}</span>
                  <Badge variant={po.payment_status === 'partial' ? 'warning' : 'destructive'} className="text-[10px]">
                    {po.payment_status === 'partial' ? t('payments.partial_label') : t('payments.unpaid_label')}
                  </Badge>
                </div>
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>{format(new Date(po.created_at), 'dd MMM yyyy', { locale: fr })}</span>
                  <span>Total: {fmt(po.total_amount)}</span>
                </div>
                {po.amount_paid > 0 && (
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-green-600">{t('payment.already_paid')}: {fmt(po.amount_paid)}</span>
                    <span className="font-bold text-red-600">{t('payment.remaining')}: {fmt(po.balance)}</span>
                  </div>
                )}
                {po.amount_paid === 0 && (
                  <div className="flex justify-end">
                    <span className="text-xs font-bold text-red-600">{t('payment.due')}: {fmt(po.balance)}</span>
                  </div>
                )}
                {po.purchase_order_items && po.purchase_order_items.length > 0 && (
                  <div className="pt-1 border-t space-y-0.5">
                    {po.purchase_order_items.map((item: any, idx: number) => (
                      <div key={idx} className="flex justify-between text-[11px] text-muted-foreground">
                        <span>{item.product_name} × {item.quantity_received ?? item.quantity_ordered}</span>
                        <span>{fmt((item.unit_price || 0) * (item.quantity_received ?? item.quantity_ordered))}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

export default function CreditsPage() {
  const t = useTranslations()
  const { shop, profile, effectiveShopIds, userShops } = useAuth()
  const isMultiShop = effectiveShopIds.length > 1
  const { fmt, symbol } = useCurrency()
  const { toast } = useToast()
  const { isOnline } = useOffline()

  const [debtors, setDebtors] = useState<CustomerDebt[]>(() =>
    (getPageCache<any[]>(`debtors_${effectiveShopIds.join(',')}`) || []) as CustomerDebt[]
  )
  const [loading, setLoading] = useState(() =>
    !getPageCache(`debtors_${effectiveShopIds.join(',')}`)
  )
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [search, setSearch] = useState('')

  // ── Repayment dialog ─────────────────────────────────────
  const [repayDebtor, setRepayDebtor] = useState<CustomerDebt | null>(null)
  const [repayAmount, setRepayAmount] = useState('')
  const [repayMethod, setRepayMethod] = useState('cash')
  const [repayRef, setRepayRef] = useState('')
  const [repayNotes, setRepayNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [receiptResult, setReceiptResult] = useState<{ blob: Blob; fileName: string; customerName: string; phone?: string } | null>(null)

  // ── History dialog ───────────────────────────────────────
  const [historyDebtor, setHistoryDebtor] = useState<CustomerDebt | null>(null)
  const [historySales, setHistorySales] = useState<SaleRecord[]>([])
  const [historyPayments, setHistoryPayments] = useState<PaymentRecord[]>([])
  const [expandedSaleId, setExpandedSaleId] = useState<string | null>(null)
  const [loadingHistory, setLoadingHistory] = useState(false)
  const historyCache = useRef<Map<string, { sales: SaleRecord[]; payments: PaymentRecord[] }>>(new Map())

  // ── Historique des crédits tab ────────────────────────────
  const [activeTab, setActiveTab] = useState<'en-cours' | 'historique'>('en-cours')
  const [histAll, setHistAll] = useState<HistCustomerEntry[]>(() =>
    getPageCache<HistCustomerEntry[]>(`payments_hist_${effectiveShopIds.join(',')}`) || []
  )
  const [loadingHistAll, setLoadingHistAll] = useState(false)
  const [histAllSearch, setHistAllSearch] = useState('')
  const [histAllDateFrom, setHistAllDateFrom] = useState('')
  const [histAllDateTo, setHistAllDateTo] = useState('')
  const [histAllExpandedId, setHistAllExpandedId] = useState<string | null>(null)
  const [histAllFetched, setHistAllFetched] = useState(() =>
    !!getPageCache(`payments_hist_${effectiveShopIds.join(',')}`)
  )

  // ── Comptes fournisseurs (accounts payable) — miroir du bloc client
  // ci-dessus, état séparé pour ne jamais mélanger les deux flux d'argent.
  const [debtSide, setDebtSide] = useState<'receivable' | 'payable'>('receivable')

  const [supplierDebtors, setSupplierDebtors] = useState<SupplierDebt[]>(() =>
    (getPageCache<any[]>(`supplier_debtors_${effectiveShopIds.join(',')}`) || []) as SupplierDebt[]
  )
  const [loadingSuppliers, setLoadingSuppliers] = useState(() =>
    !getPageCache(`supplier_debtors_${effectiveShopIds.join(',')}`)
  )
  const [expandedSupplierId, setExpandedSupplierId] = useState<string | null>(null)
  const [refreshingSuppliers, setRefreshingSuppliers] = useState(false)
  const [supplierSearch, setSupplierSearch] = useState('')

  const [repaySupplier, setRepaySupplier] = useState<SupplierDebt | null>(null)
  const [supplierRepayAmount, setSupplierRepayAmount] = useState('')
  const [supplierRepayMethod, setSupplierRepayMethod] = useState('cash')
  const [supplierRepayRef, setSupplierRepayRef] = useState('')
  const [supplierRepayNotes, setSupplierRepayNotes] = useState('')
  const [savingSupplierPayment, setSavingSupplierPayment] = useState(false)

  const [historySupplier, setHistorySupplier] = useState<SupplierDebt | null>(null)
  const [historyPOs, setHistoryPOs] = useState<UnpaidPO[]>([])
  const [historySupplierPayments, setHistorySupplierPayments] = useState<SupplierPaymentRecord[]>([])
  const [expandedPoId, setExpandedPoId] = useState<string | null>(null)
  const [loadingSupplierHistory, setLoadingSupplierHistory] = useState(false)
  const supplierHistoryCache = useRef<Map<string, { pos: UnpaidPO[]; payments: SupplierPaymentRecord[] }>>(new Map())

  const [supplierActiveTab, setSupplierActiveTab] = useState<'en-cours' | 'historique'>('en-cours')
  const [supplierHistAll, setSupplierHistAll] = useState<HistSupplierEntry[]>(() =>
    getPageCache<HistSupplierEntry[]>(`supplier_payments_hist_${effectiveShopIds.join(',')}`) || []
  )
  const [loadingSupplierHistAll, setLoadingSupplierHistAll] = useState(false)
  const [supplierHistAllSearch, setSupplierHistAllSearch] = useState('')
  const [supplierHistAllDateFrom, setSupplierHistAllDateFrom] = useState('')
  const [supplierHistAllDateTo, setSupplierHistAllDateTo] = useState('')
  const [supplierHistAllExpandedId, setSupplierHistAllExpandedId] = useState<string | null>(null)
  const [supplierHistAllFetched, setSupplierHistAllFetched] = useState(() =>
    !!getPageCache(`supplier_payments_hist_${effectiveShopIds.join(',')}`)
  )

  const fetchSupplierDebtors = async (quiet = false) => {
    if (!effectiveShopIds.length) return
    const cacheKey = `supplier_debtors_${effectiveShopIds.join(',')}`
    const cached = getPageCache<any[]>(cacheKey)
    if (cached) { setSupplierDebtors(cached); setLoadingSuppliers(false) }
    if (!cached && !quiet) setLoadingSuppliers(true)
    setRefreshingSuppliers(true)
    try {
      const res = await fetch(`/api/supplier-payments/debts?shop_ids=${effectiveShopIds.join(',')}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setSupplierDebtors(data.debtors || [])
      setPageCache(cacheKey, data.debtors || [])
    } catch {
      // cache already shown if available
    } finally {
      setLoadingSuppliers(false)
      setRefreshingSuppliers(false)
    }
  }

  useEffect(() => { if (debtSide === 'payable') fetchSupplierDebtors() }, [debtSide, effectiveShopIds.join(',')]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === 'visible' && debtSide === 'payable') fetchSupplierDebtors(true) }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [debtSide, effectiveShopIds.join(',')]) // eslint-disable-line react-hooks/exhaustive-deps
  // navigator 'online' is unreliable in the Capacitor Android WebView —
  // useRefetchOnReconnect uses useOffline()'s actively-verified isOnline instead.
  useRefetchOnReconnect(() => { if (debtSide === 'payable') fetchSupplierDebtors(true) }, isOnline)

  const totalOwedOutstanding = supplierDebtors.reduce((s, d) => s + d.totalOwed, 0)

  const filteredSupplierDebtors = useMemo(() => {
    if (!supplierSearch.trim()) return supplierDebtors
    const q = normalize(supplierSearch)
    return supplierDebtors.filter(d =>
      normalize(d.supplier.name).includes(q) ||
      d.supplier.phone?.includes(q) ||
      normalize(d.supplier.city ?? '').includes(q)
    )
  }, [supplierDebtors, supplierSearch])

  const supplierAmount = Number(supplierRepayAmount) || 0
  const supplierFifoLines = useMemo(
    () => repaySupplier ? calcFifoPOs(supplierAmount, repaySupplier.unpaidPOs) : [],
    [supplierAmount, repaySupplier]
  )
  const supplierRemaining = repaySupplier ? Math.max(0, repaySupplier.totalOwed - supplierAmount) : 0

  const supplierRepayIdRef = useRef<string | null>(null)

  const openSupplierRepayDialog = (debtor: SupplierDebt) => {
    setHistorySupplier(null)
    setRepaySupplier(debtor)
    setSupplierRepayAmount(String(Math.round(debtor.totalOwed)))
    setSupplierRepayMethod('cash')
    setSupplierRepayRef('')
    setSupplierRepayNotes('')
    supplierRepayIdRef.current = null
  }

  const recordSupplierPayment = async () => {
    if (!repaySupplier || supplierAmount <= 0) {
      toast({ title: t('toast.payment_amount_required'), variant: 'destructive' })
      return
    }
    if (supplierAmount > repaySupplier.totalOwed + 0.01) {
      toast({ title: t('toast.payment_exceeds_debt', { amount: fmt(repaySupplier.totalOwed) }), variant: 'destructive' })
      return
    }
    setSavingSupplierPayment(true)
    try {
      const clientRequestId = supplierRepayIdRef.current ?? (supplierRepayIdRef.current = crypto.randomUUID())
      const res = await withTimeout(fetch('/api/supplier-payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          purchase_order_ids: repaySupplier.unpaidPOs.map(po => po.id),
          amount: supplierAmount,
          method: supplierRepayMethod,
          reference: supplierRepayRef || null,
          notes: supplierRepayNotes || null,
          shop_id: shop!.id,
          client_request_id: clientRequestId,
        }),
      }))
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      supplierRepayIdRef.current = null
      toast({ title: t('toast.payment_recorded'), variant: 'success' })
      supplierHistoryCache.current.delete(repaySupplier.supplier.id)
      setRepaySupplier(null)
      setSupplierRepayAmount('')
      setTimeout(() => fetchSupplierDebtors(true), 300)
    } catch (e: any) {
      toast({ title: e.message, variant: 'destructive' })
    } finally {
      setSavingSupplierPayment(false)
    }
  }

  const openSupplierHistory = async (debtor: SupplierDebt) => {
    setRepaySupplier(null)
    setHistorySupplier(debtor)
    setExpandedPoId(null)
    const cached = supplierHistoryCache.current.get(debtor.supplier.id)
    if (cached) {
      setHistoryPOs(cached.pos)
      setHistorySupplierPayments(cached.payments)
      setLoadingSupplierHistory(false)
      return
    }
    setHistoryPOs([])
    setHistorySupplierPayments([])
    setLoadingSupplierHistory(true)
    try {
      const res = await fetch(`/api/supplier-payments/history?shop_id=${shop!.id}&supplier_id=${debtor.supplier.id}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      supplierHistoryCache.current.set(debtor.supplier.id, { pos: data.purchaseOrders || [], payments: data.payments || [] })
      setHistoryPOs(data.purchaseOrders || [])
      setHistorySupplierPayments(data.payments || [])
    } catch (e: any) {
      toast({ title: e.message, variant: 'destructive' })
    } finally {
      setLoadingSupplierHistory(false)
    }
  }

  // quiet: skip the loading spinner — used for the silent background
  // refresh that follows an instant cache-first render, so a stale cached
  // entry never stays stuck until the 7-day page-cache TTL expires.
  const fetchSupplierHistAll = async (from = supplierHistAllDateFrom, to = supplierHistAllDateTo, quiet = false) => {
    if (!effectiveShopIds.length) return
    if (!quiet) setLoadingSupplierHistAll(true)
    try {
      const params = new URLSearchParams({ shop_ids: effectiveShopIds.join(',') })
      if (from) params.set('date_from', from)
      if (to) params.set('date_to', to)
      const res = await fetch(`/api/supplier-payments/history-all?${params}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      const supps = data.suppliers || []
      setSupplierHistAll(supps)
      setSupplierHistAllFetched(true)
      if (!from && !to) setPageCache(`supplier_payments_hist_${effectiveShopIds.join(',')}`, supps)
    } catch (e: any) {
      if (!quiet) toast({ title: e.message, variant: 'destructive' })
    } finally {
      if (!quiet) setLoadingSupplierHistAll(false)
    }
  }

  useEffect(() => {
    if (debtSide === 'payable' && supplierActiveTab === 'historique') fetchSupplierHistAll(supplierHistAllDateFrom, supplierHistAllDateTo, supplierHistAllFetched)
  }, [debtSide, supplierActiveTab, effectiveShopIds.join(',')]) // eslint-disable-line react-hooks/exhaustive-deps
  useRefetchOnReconnect(() => {
    if (debtSide === 'payable' && supplierActiveTab === 'historique') fetchSupplierHistAll(supplierHistAllDateFrom, supplierHistAllDateTo, true)
  }, isOnline)

  const filteredSupplierHistAll = useMemo(() => {
    if (!supplierHistAllSearch.trim()) return supplierHistAll
    const q = normalize(supplierHistAllSearch)
    return supplierHistAll.filter(e => normalize(e.supplier.name).includes(q) || e.supplier.phone?.includes(q))
  }, [supplierHistAll, supplierHistAllSearch])

  const supplierHistAllSoldeCount = useMemo(() => supplierHistAll.filter(e => e.isSolde).length, [supplierHistAll])

  // ── Fetch ────────────────────────────────────────────────
  const fetchDebtors = async (quiet = false) => {
    if (!effectiveShopIds.length) return
    const cacheKey = `debtors_${effectiveShopIds.join(',')}`
    // Always serve cache immediately — before any loading state change
    const cached = getPageCache<any[]>(cacheKey)
    if (cached) { setDebtors(cached); setLoading(false) }
    if (!cached && !quiet) setLoading(true)
    setRefreshing(true)
    try {
      const res = await fetch(`/api/payments/debts?shop_ids=${effectiveShopIds.join(',')}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setDebtors(data.debtors || [])
      setPageCache(cacheKey, data.debtors || [])
    } catch {
      // cache already shown if available
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  const shopKey = effectiveShopIds.join(',')
  useEffect(() => { fetchDebtors() }, [shopKey])
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === 'visible') fetchDebtors(true) }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [shopKey])
  // Refresh on reconnect — debts/repayments are money-critical like the
  // dashboard, so a stale debt total right after coming back online is risky.
  // navigator 'online' is unreliable in the Capacitor Android WebView —
  // useRefetchOnReconnect uses useOffline()'s actively-verified isOnline instead.
  useRefetchOnReconnect(() => fetchDebtors(true), isOnline)

  const totalOutstanding = debtors.reduce((s, d) => s + d.totalDebt, 0)

  const filteredDebtors = useMemo(() => {
    if (!search.trim()) return debtors
    const q = normalize(search)
    return debtors.filter(d =>
      normalize(d.customer.name).includes(q) ||
      d.customer.phone?.includes(q) ||
      normalize(d.customer.city ?? '').includes(q)
    )
  }, [debtors, search])

  // ── FIFO preview ─────────────────────────────────────────
  const amount = Number(repayAmount) || 0
  const fifoLines = useMemo(
    () => repayDebtor ? calcFifo(amount, repayDebtor.unpaidSales) : [],
    [amount, repayDebtor]
  )
  const remaining = repayDebtor ? Math.max(0, repayDebtor.totalDebt - amount) : 0

  // Idempotency key for the current repayment attempt — generated once and
  // reused across retries (including a manual re-click after an apparent
  // failure), same pattern as sales/new. Reset when opening the dialog for a
  // (possibly different) repayment.
  const repayIdRef = useRef<string | null>(null)

  // ── Open repay dialog ────────────────────────────────────
  const openRepayDialog = (debtor: CustomerDebt) => {
    setHistoryDebtor(null)
    setRepayDebtor(debtor)
    setRepayAmount(String(Math.round(debtor.totalDebt)))
    setRepayMethod('cash')
    setRepayRef('')
    setRepayNotes('')
    repayIdRef.current = null
  }

  // ── Record repayment ─────────────────────────────────────
  const recordRepayment = async () => {
    if (!repayDebtor || amount <= 0) {
      toast({ title: t('toast.payment_amount_required'), variant: 'destructive' })
      return
    }
    if (amount > repayDebtor.totalDebt + 0.01) {
      toast({ title: t('toast.payment_exceeds_debt', { amount: fmt(repayDebtor.totalDebt) }), variant: 'destructive' })
      return
    }
    setSaving(true)
    try {
      const clientRequestId = repayIdRef.current ?? (repayIdRef.current = crypto.randomUUID())
      const res = await withTimeout(fetch('/api/payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          unpaid_sale_ids: repayDebtor.unpaidSales.map(s => s.id),
          amount,
          method: repayMethod,
          reference: repayRef || null,
          notes: repayNotes || null,
          shop_id: shop!.id,
          client_request_id: clientRequestId,
        }),
      }))
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      repayIdRef.current = null // this attempt succeeded — any further action is a new one
      toast({ title: t('toast.payment_recorded'), variant: 'success' })
      historyCache.current.delete(repayDebtor.customer.id)

      if (shop && data.applied?.length > 0) {
        const shopCountry = getCountry(shop?.country)
        const selectedMethod = shopCountry.paymentMethods.find(m => m.id === repayMethod)
        const result = await generateDebtReceiptPDFBlob({
          customerName: repayDebtor.customer.name,
          amount,
          method: repayMethod,
          methodLabel: selectedMethod?.label,
          reference: repayRef || null,
          notes: repayNotes || null,
          receivedBy: profile?.full_name || t('receipt.cashier'),
          shop,
          appliedSales: data.applied.map((a: any) => ({ sale_number: a.sale_number, amount: a.amount })),
          remainingBalance: Math.max(0, remaining),
          labels: {
            title: t('receipt.debt_title'),
            client: t('receipt.customer'),
            receivedBy: t('receipt.received_by'),
            mode: t('receipt.mode'),
            ref: t('receipt.ref'),
            invoicesSettled: t('receipt.invoices_settled'),
            colInvoice: t('receipt.col_invoice'),
            colAmountSettled: t('receipt.col_amount_settled'),
            totalPaid: t('receipt.total_paid'),
            remainingBalance: t('receipt.remaining_balance'),
            debtCleared: t('receipt.debt_cleared'),
            thankYou: t('receipt.thank_you'),
            methodCash: t('receipt.method_cash'),
            methodTransfer: t('receipt.method_transfer'),
            methodMobile: t('receipt.method_mobile'),
            methodPaystack: t('receipt.method_paystack'),
          },
        })
        setReceiptResult({ ...result, customerName: repayDebtor.customer.name, phone: repayDebtor.customer.phone || undefined })
      } else {
        setRepayDebtor(null)
      }

      setRepayAmount('')
      setTimeout(() => fetchDebtors(true), 300)
    } catch (e: any) {
      toast({ title: e.message, variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  // ── Open history dialog ──────────────────────────────────
  const openHistory = async (debtor: CustomerDebt) => {
    setRepayDebtor(null)
    setReceiptResult(null)
    setHistoryDebtor(debtor)
    setExpandedSaleId(null)
    const cached = historyCache.current.get(debtor.customer.id)
    if (cached) {
      setHistorySales(cached.sales)
      setHistoryPayments(cached.payments)
      setLoadingHistory(false)
      return
    }
    setHistorySales([])
    setHistoryPayments([])
    setLoadingHistory(true)
    try {
      const res = await fetch(`/api/payments/history?shop_id=${shop!.id}&customer_id=${debtor.customer.id}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      historyCache.current.set(debtor.customer.id, { sales: data.sales || [], payments: data.payments || [] })
      setHistorySales(data.sales || [])
      setHistoryPayments(data.payments || [])
    } catch (e: any) {
      toast({ title: e.message, variant: 'destructive' })
    } finally {
      setLoadingHistory(false)
    }
  }

  // ── Fetch all debt history ───────────────────────────────
  // quiet: skip the loading spinner — used for the silent background
  // refresh that follows an instant cache-first render, so a stale cached
  // "Soldé" entry (e.g. from before a backend backfill) never stays stuck
  // until the 7-day page-cache TTL expires.
  const fetchHistAll = async (from = histAllDateFrom, to = histAllDateTo, quiet = false) => {
    if (!effectiveShopIds.length) return
    if (!quiet) setLoadingHistAll(true)
    try {
      const params = new URLSearchParams({ shop_ids: effectiveShopIds.join(',') })
      if (from) params.set('date_from', from)
      if (to) params.set('date_to', to)
      const res = await fetch(`/api/payments/history-all?${params}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      const customers = data.customers || []
      setHistAll(customers)
      setHistAllFetched(true)
      if (!from && !to) setPageCache(`payments_hist_${effectiveShopIds.join(',')}`, customers)
    } catch (e: any) {
      if (!quiet) toast({ title: e.message, variant: 'destructive' })
    } finally {
      if (!quiet) setLoadingHistAll(false)
    }
  }

  useEffect(() => {
    if (activeTab === 'historique') fetchHistAll(histAllDateFrom, histAllDateTo, histAllFetched)
  }, [activeTab, shopKey]) // eslint-disable-line react-hooks/exhaustive-deps
  useRefetchOnReconnect(() => { if (activeTab === 'historique') fetchHistAll(histAllDateFrom, histAllDateTo, true) }, isOnline)

  const filteredHistAll = useMemo(() => {
    if (!histAllSearch.trim()) return histAll
    const q = normalize(histAllSearch)
    return histAll.filter(e =>
      normalize(e.customer.name).includes(q) || e.customer.phone?.includes(q)
    )
  }, [histAll, histAllSearch])

  const histAllSoldeCount = useMemo(() => histAll.filter(e => e.isSolde).length, [histAll])

  // ── Render ───────────────────────────────────────────────
  return (
    <div className="space-y-4">

      {/* Bascule créances / dettes */}
      <div className="flex gap-1 p-1 bg-muted rounded-xl">
        <button
          onClick={() => setDebtSide('receivable')}
          className={`flex-1 py-2 px-3 rounded-lg text-sm font-semibold transition-all duration-200 ${
            debtSide === 'receivable' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          {t('payments.side_receivable')}
        </button>
        <button
          onClick={() => setDebtSide('payable')}
          className={`flex-1 py-2 px-3 rounded-lg text-sm font-semibold transition-all duration-200 ${
            debtSide === 'payable' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          {t('payments.side_payable')}
        </button>
      </div>

      {debtSide === 'receivable' && (
      <>
      {/* Summary */}
      <Card className="border-0 shadow-sm bg-stockshop-blue text-white">
        <CardContent className="p-4">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm opacity-80">{t('payments.total_outstanding_label')}</p>
              <p className="text-3xl font-bold mt-1">{fmt(totalOutstanding)}</p>
              <p className="text-sm opacity-70 mt-1">{t('payments.clients_with_debt', { count: debtors.length })}</p>
            </div>
            <button onClick={() => fetchDebtors(true)} className="p-2 rounded-full bg-white/20 hover:bg-white/30 transition-colors" disabled={refreshing}>
              <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </CardContent>
      </Card>

      {/* Tab switcher */}
      <div className="flex gap-1 p-1 bg-muted rounded-xl">
        <button
          onClick={() => setActiveTab('en-cours')}
          className={`flex-1 py-2 px-3 rounded-lg text-sm font-semibold transition-all duration-200 ${
            activeTab === 'en-cours'
              ? 'bg-card text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          Crédits en cours
          {debtors.length > 0 && (
            <span className={`ml-1.5 text-xs px-1.5 py-0.5 rounded-full ${activeTab === 'en-cours' ? 'bg-red-100 text-red-600' : 'bg-muted-foreground/20 text-muted-foreground'}`}>
              {debtors.length}
            </span>
          )}
        </button>
        <button
          onClick={() => setActiveTab('historique')}
          className={`flex-1 py-2 px-3 rounded-lg text-sm font-semibold transition-all duration-200 ${
            activeTab === 'historique'
              ? 'bg-card text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          Historique
          {histAllFetched && histAll.length > 0 && (
            <span className={`ml-1.5 text-xs px-1.5 py-0.5 rounded-full ${activeTab === 'historique' ? 'bg-blue-100 text-blue-600 dark:bg-blue-900/40 dark:text-blue-400' : 'bg-muted-foreground/20 text-muted-foreground'}`}>
              {histAll.length}
            </span>
          )}
        </button>
      </div>

      {activeTab === 'en-cours' && (
        <>
          {/* Search */}
          {!loading && debtors.length > 0 && (
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input value={search} onChange={e => setSearch(e.target.value)} placeholder={t('actions.search')} className="pl-9 h-9" />
            </div>
          )}

          {/* Debtors list */}
          {loading ? (
            <div className="space-y-3">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-32" />)}</div>
          ) : debtors.length === 0 ? (
            <div className="flex h-48 flex-col items-center justify-center text-muted-foreground">
              <CheckCircle2 className="h-12 w-12 mb-3 opacity-30" />
              <p className="font-medium">{t('payments.no_debts')}</p>
              <p className="text-sm mt-1 opacity-70">{t('payments.no_debts_detail')}</p>
            </div>
          ) : filteredDebtors.length === 0 ? (
            <div className="flex h-24 items-center justify-center text-muted-foreground text-sm">
              {t('customers.no_customers')}
            </div>
          ) : isMultiShop ? (
            <div className="space-y-4">
              {userShops.filter(s => effectiveShopIds.includes(s.id)).map(shopEntry => {
                const shopDebtors = filteredDebtors.filter(d => d.customer.shop_id === shopEntry.id)
                if (!shopDebtors.length) return null
                const shopTotal = shopDebtors.reduce((s, d) => s + d.totalDebt, 0)
                return (
                  <div key={shopEntry.id} className="space-y-3">
                    <div className="flex items-center gap-2 pt-1">
                      <Store className="h-3.5 w-3.5 text-stockshop-blue dark:text-blue-400 flex-shrink-0" />
                      <span className="text-xs font-semibold text-stockshop-blue dark:text-blue-400 uppercase tracking-wide">{shopEntry.name}</span>
                      <span className="text-xs text-red-500 font-medium ml-1">{fmt(shopTotal)}</span>
                      <div className="flex-1 h-px bg-border" />
                    </div>
                    {shopDebtors.map(({ customer, unpaidSales, totalDebt }) => (
                      <DebtorCard key={customer.id} customer={customer} unpaidSales={unpaidSales} totalDebt={totalDebt}
                        isExpanded={expandedId === customer.id} setExpandedId={setExpandedId}
                        openRepayDialog={openRepayDialog} openHistory={openHistory} fmt={fmt} t={t} saving={saving} />
                    ))}
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="space-y-3">
              {filteredDebtors.map(({ customer, unpaidSales, totalDebt }) => (
                <DebtorCard key={customer.id} customer={customer} unpaidSales={unpaidSales} totalDebt={totalDebt}
                  isExpanded={expandedId === customer.id} setExpandedId={setExpandedId}
                  openRepayDialog={openRepayDialog} openHistory={openHistory} fmt={fmt} t={t} />
              ))}
            </div>
          )}
        </>
      )}

      {activeTab === 'historique' && (
        <div className="space-y-3">
          {/* Filters */}
          <div className="space-y-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={histAllSearch}
                onChange={e => setHistAllSearch(e.target.value)}
                placeholder="Rechercher par nom..."
                className="pl-9 h-9"
              />
            </div>
            <div className="flex gap-2 items-center">
              <CalendarDays className="h-4 w-4 text-muted-foreground flex-shrink-0" />
              <input
                type="date"
                value={histAllDateFrom}
                onChange={e => setHistAllDateFrom(e.target.value)}
                className="flex-1 h-9 rounded-md border border-input bg-card px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
              <span className="text-muted-foreground text-sm">→</span>
              <input
                type="date"
                value={histAllDateTo}
                onChange={e => setHistAllDateTo(e.target.value)}
                className="flex-1 h-9 rounded-md border border-input bg-card px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
              <Button
                size="sm"
                variant="stockshop"
                className="h-9 px-3 text-xs flex-shrink-0"
                onClick={() => { setHistAllFetched(false); fetchHistAll(histAllDateFrom, histAllDateTo) }}
                disabled={loadingHistAll}
              >
                {loadingHistAll ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : 'Filtrer'}
              </Button>
            </div>
          </div>

          {/* Stats bar */}
          {histAllFetched && histAll.length > 0 && (
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-xl bg-green-50 dark:bg-green-950/20 border border-green-100 dark:border-green-900 px-3 py-2.5 text-center">
                <p className="text-lg font-bold text-green-600">{histAllSoldeCount}</p>
                <p className="text-[11px] text-green-700 dark:text-green-400 font-medium">Soldés ✓</p>
              </div>
              <div className="rounded-xl bg-red-50 dark:bg-red-950/20 border border-red-100 dark:border-red-900 px-3 py-2.5 text-center">
                <p className="text-lg font-bold text-red-600">{histAll.length - histAllSoldeCount}</p>
                <p className="text-[11px] text-red-700 dark:text-red-400 font-medium">En cours</p>
              </div>
            </div>
          )}

          {/* List */}
          {loadingHistAll ? (
            <div className="space-y-3">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-28" />)}</div>
          ) : !histAllFetched ? null : filteredHistAll.length === 0 ? (
            <div className="flex h-32 flex-col items-center justify-center text-muted-foreground">
              <History className="h-8 w-8 mb-2 opacity-30" />
              <p className="text-sm">Aucun résultat</p>
            </div>
          ) : (
            <div className="space-y-2">
              {filteredHistAll.map(entry => {
                const isExpanded = histAllExpandedId === entry.customer.id
                const pct = entry.totalOwed > 0 ? Math.min(100, (entry.totalPaid / entry.totalOwed) * 100) : 0
                return (
                  <Card key={entry.customer.id} className="border-0 shadow-sm overflow-hidden">
                    <CardContent className="p-0">
                      <button
                        className="w-full p-4 text-left hover:bg-accent/50 transition-colors"
                        onClick={() => setHistAllExpandedId(isExpanded ? null : entry.customer.id)}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex items-center gap-3 min-w-0 flex-1">
                            <div className={`h-9 w-9 rounded-full flex items-center justify-center flex-shrink-0 ${entry.isSolde ? 'bg-green-100 dark:bg-green-950/40' : 'bg-red-100 dark:bg-red-950/40'}`}>
                              {entry.isSolde
                                ? <CheckCircle2 className="h-4 w-4 text-green-600" />
                                : <User className="h-4 w-4 text-red-600" />
                              }
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2 flex-wrap">
                                <p className="font-semibold text-sm truncate">{entry.customer.name}</p>
                                <Badge
                                  variant={entry.isSolde ? 'success' : 'destructive'}
                                  className="text-[10px] px-1.5 flex-shrink-0"
                                >
                                  {entry.isSolde ? 'Soldé ✓' : 'En cours'}
                                </Badge>
                              </div>
                              {entry.customer.phone && <p className="text-xs text-muted-foreground">{entry.customer.phone}</p>}
                            </div>
                          </div>
                          <div className="text-right flex-shrink-0">
                            <p className="text-xs text-muted-foreground">Total : {fmt(entry.totalOwed)}</p>
                            {entry.isSolde
                              ? <p className="text-xs text-green-600 font-semibold">Payé : {fmt(entry.totalPaid)}</p>
                              : <p className="text-xs text-red-600 font-semibold">Restant : {fmt(entry.totalRemaining)}</p>
                            }
                          </div>
                        </div>
                        {/* Progress */}
                        <div className="mt-2.5">
                          <DebtGauge pct={pct} remaining={entry.isSolde ? undefined : entry.totalRemaining} fmt={fmt} t={t} />
                        </div>
                        <div className="flex items-center justify-between mt-1.5">
                          <p className="text-[11px] text-muted-foreground">{entry.sales.length} facture{entry.sales.length > 1 ? 's' : ''}</p>
                          <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                            {isExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                            {isExpanded ? 'Masquer' : 'Voir les factures'}
                          </div>
                        </div>
                      </button>

                      {isExpanded && (
                        <div className="border-t bg-muted/40 px-4 py-3 space-y-2">
                          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Factures</p>
                          {entry.sales.map(sale => (
                            <div key={sale.id} className="bg-card rounded-lg border p-3 space-y-1">
                              <div className="flex items-center justify-between gap-2">
                                <span className="font-mono text-stockshop-blue dark:text-blue-400 font-semibold text-sm">#{sale.sale_number}</span>
                                <Badge variant={STATUS_VARIANTS[sale.payment_status] || ('outline' as any)} className="text-[10px]">
                                  {sale.payment_status === 'paid' ? 'Payé ✓' : sale.payment_status === 'partial' ? 'Partiel' : 'Impayé'}
                                </Badge>
                              </div>
                              <div className="flex items-center justify-between text-xs text-muted-foreground">
                                <span>{format(new Date(sale.created_at), 'dd MMM yyyy', { locale: fr })}</span>
                                <span>Total : {fmt(sale.total)}</span>
                              </div>
                              {sale.amount_paid > 0 && (
                                <div className="flex items-center justify-between text-xs">
                                  <span className="text-green-600">Payé : {fmt(sale.amount_paid)}</span>
                                  {sale.balance > 0 && <span className="font-bold text-red-600">Restant : {fmt(sale.balance)}</span>}
                                </div>
                              )}
                              {sale.cashier_name && (
                                <p className="text-[11px] text-muted-foreground">{t('payments.sold_by')} : <strong>{sale.cashier_name}</strong></p>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                )
              })}
            </div>
          )}
        </div>
      )}
      </>
      )}

      {debtSide === 'payable' && (
      <>
      {/* Summary */}
      <Card className="border-0 shadow-sm bg-amber-600 text-white">
        <CardContent className="p-4">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm opacity-80">{t('payments.total_owed_label')}</p>
              <p className="text-3xl font-bold mt-1">{fmt(totalOwedOutstanding)}</p>
              <p className="text-sm opacity-70 mt-1">{t('payments.suppliers_owed_count', { count: supplierDebtors.length })}</p>
            </div>
            <button onClick={() => fetchSupplierDebtors(true)} className="p-2 rounded-full bg-white/20 hover:bg-white/30 transition-colors" disabled={refreshingSuppliers}>
              <RefreshCw className={`h-4 w-4 ${refreshingSuppliers ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </CardContent>
      </Card>

      {/* Tab switcher */}
      <div className="flex gap-1 p-1 bg-muted rounded-xl">
        <button
          onClick={() => setSupplierActiveTab('en-cours')}
          className={`flex-1 py-2 px-3 rounded-lg text-sm font-semibold transition-all duration-200 ${
            supplierActiveTab === 'en-cours' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          {t('payments.tab_en_cours')}
          {supplierDebtors.length > 0 && (
            <span className={`ml-1.5 text-xs px-1.5 py-0.5 rounded-full ${supplierActiveTab === 'en-cours' ? 'bg-amber-100 text-amber-600' : 'bg-muted-foreground/20 text-muted-foreground'}`}>
              {supplierDebtors.length}
            </span>
          )}
        </button>
        <button
          onClick={() => setSupplierActiveTab('historique')}
          className={`flex-1 py-2 px-3 rounded-lg text-sm font-semibold transition-all duration-200 ${
            supplierActiveTab === 'historique' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          {t('payments.tab_historique')}
          {supplierHistAllFetched && supplierHistAll.length > 0 && (
            <span className={`ml-1.5 text-xs px-1.5 py-0.5 rounded-full ${supplierActiveTab === 'historique' ? 'bg-blue-100 text-blue-600 dark:bg-blue-900/40 dark:text-blue-400' : 'bg-muted-foreground/20 text-muted-foreground'}`}>
              {supplierHistAll.length}
            </span>
          )}
        </button>
      </div>

      {supplierActiveTab === 'en-cours' && (
        <>
          {!loadingSuppliers && supplierDebtors.length > 0 && (
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input value={supplierSearch} onChange={e => setSupplierSearch(e.target.value)} placeholder={t('actions.search')} className="pl-9 h-9" />
            </div>
          )}

          {loadingSuppliers ? (
            <div className="space-y-3">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-32" />)}</div>
          ) : supplierDebtors.length === 0 ? (
            <div className="flex h-48 flex-col items-center justify-center text-muted-foreground">
              <CheckCircle2 className="h-12 w-12 mb-3 opacity-30" />
              <p className="font-medium">{t('payments.no_debts_owed')}</p>
              <p className="text-sm mt-1 opacity-70">{t('payments.no_debts_owed_detail')}</p>
            </div>
          ) : filteredSupplierDebtors.length === 0 ? (
            <div className="flex h-24 items-center justify-center text-muted-foreground text-sm">
              {t('suppliers.no_suppliers')}
            </div>
          ) : isMultiShop ? (
            <div className="space-y-4">
              {userShops.filter(s => effectiveShopIds.includes(s.id)).map(shopEntry => {
                const shopDebtors = filteredSupplierDebtors.filter(d => d.supplier.shop_id === shopEntry.id)
                if (!shopDebtors.length) return null
                const shopTotal = shopDebtors.reduce((s, d) => s + d.totalOwed, 0)
                return (
                  <div key={shopEntry.id} className="space-y-3">
                    <div className="flex items-center gap-2 pt-1">
                      <Store className="h-3.5 w-3.5 text-stockshop-blue dark:text-blue-400 flex-shrink-0" />
                      <span className="text-xs font-semibold text-stockshop-blue dark:text-blue-400 uppercase tracking-wide">{shopEntry.name}</span>
                      <span className="text-xs text-amber-600 font-medium ml-1">{fmt(shopTotal)}</span>
                      <div className="flex-1 h-px bg-border" />
                    </div>
                    {shopDebtors.map(({ supplier, unpaidPOs, totalOwed }) => (
                      <SupplierDebtorCard key={supplier.id} supplier={supplier} unpaidPOs={unpaidPOs} totalOwed={totalOwed}
                        isExpanded={expandedSupplierId === supplier.id} setExpandedId={setExpandedSupplierId}
                        openRepayDialog={openSupplierRepayDialog} openHistory={openSupplierHistory} fmt={fmt} t={t} saving={savingSupplierPayment} />
                    ))}
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="space-y-3">
              {filteredSupplierDebtors.map(({ supplier, unpaidPOs, totalOwed }) => (
                <SupplierDebtorCard key={supplier.id} supplier={supplier} unpaidPOs={unpaidPOs} totalOwed={totalOwed}
                  isExpanded={expandedSupplierId === supplier.id} setExpandedId={setExpandedSupplierId}
                  openRepayDialog={openSupplierRepayDialog} openHistory={openSupplierHistory} fmt={fmt} t={t} saving={savingSupplierPayment} />
              ))}
            </div>
          )}
        </>
      )}

      {supplierActiveTab === 'historique' && (
        <div className="space-y-3">
          <div className="space-y-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={supplierHistAllSearch}
                onChange={e => setSupplierHistAllSearch(e.target.value)}
                placeholder={t('payments.search_by_name')}
                className="pl-9 h-9"
              />
            </div>
            <div className="flex gap-2 items-center">
              <CalendarDays className="h-4 w-4 text-muted-foreground flex-shrink-0" />
              <input
                type="date"
                value={supplierHistAllDateFrom}
                onChange={e => setSupplierHistAllDateFrom(e.target.value)}
                className="flex-1 h-9 rounded-md border border-input bg-card px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
              <span className="text-muted-foreground text-sm">→</span>
              <input
                type="date"
                value={supplierHistAllDateTo}
                onChange={e => setSupplierHistAllDateTo(e.target.value)}
                className="flex-1 h-9 rounded-md border border-input bg-card px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
              <Button
                size="sm"
                variant="stockshop"
                className="h-9 px-3 text-xs flex-shrink-0"
                onClick={() => { setSupplierHistAllFetched(false); fetchSupplierHistAll(supplierHistAllDateFrom, supplierHistAllDateTo) }}
                disabled={loadingSupplierHistAll}
              >
                {loadingSupplierHistAll ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : t('payments.filter_btn')}
              </Button>
            </div>
          </div>

          {supplierHistAllFetched && supplierHistAll.length > 0 && (
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-xl bg-green-50 dark:bg-green-950/20 border border-green-100 dark:border-green-900 px-3 py-2.5 text-center">
                <p className="text-lg font-bold text-green-600">{supplierHistAllSoldeCount}</p>
                <p className="text-[11px] text-green-700 dark:text-green-400 font-medium">{t('payments.solde_label')}</p>
              </div>
              <div className="rounded-xl bg-amber-50 dark:bg-amber-950/20 border border-amber-100 dark:border-amber-900 px-3 py-2.5 text-center">
                <p className="text-lg font-bold text-amber-600">{supplierHistAll.length - supplierHistAllSoldeCount}</p>
                <p className="text-[11px] text-amber-700 dark:text-amber-400 font-medium">{t('payments.en_cours_label')}</p>
              </div>
            </div>
          )}

          {loadingSupplierHistAll ? (
            <div className="space-y-3">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-28" />)}</div>
          ) : !supplierHistAllFetched ? null : filteredSupplierHistAll.length === 0 ? (
            <div className="flex h-32 flex-col items-center justify-center text-muted-foreground">
              <History className="h-8 w-8 mb-2 opacity-30" />
              <p className="text-sm">{t('payments.no_results')}</p>
            </div>
          ) : (
            <div className="space-y-2">
              {filteredSupplierHistAll.map(entry => {
                const isExpanded = supplierHistAllExpandedId === entry.supplier.id
                const pct = entry.totalOwed > 0 ? Math.min(100, (entry.totalPaid / entry.totalOwed) * 100) : 0
                return (
                  <Card key={entry.supplier.id} className="border-0 shadow-sm overflow-hidden">
                    <CardContent className="p-0">
                      <button
                        className="w-full p-4 text-left hover:bg-accent/50 transition-colors"
                        onClick={() => setSupplierHistAllExpandedId(isExpanded ? null : entry.supplier.id)}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex items-center gap-3 min-w-0 flex-1">
                            <div className={`h-9 w-9 rounded-full flex items-center justify-center flex-shrink-0 ${entry.isSolde ? 'bg-green-100 dark:bg-green-950/40' : 'bg-amber-100 dark:bg-amber-950/40'}`}>
                              {entry.isSolde
                                ? <CheckCircle2 className="h-4 w-4 text-green-600" />
                                : <Store className="h-4 w-4 text-amber-600" />
                              }
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2 flex-wrap">
                                <p className="font-semibold text-sm truncate">{entry.supplier.name}</p>
                                <Badge variant={entry.isSolde ? 'success' : 'warning'} className="text-[10px] px-1.5 flex-shrink-0">
                                  {entry.isSolde ? t('payments.solde_badge') : t('payments.en_cours_label')}
                                </Badge>
                              </div>
                              {entry.supplier.phone && <p className="text-xs text-muted-foreground">{entry.supplier.phone}</p>}
                            </div>
                          </div>
                          <div className="text-right flex-shrink-0">
                            <p className="text-xs text-muted-foreground">{t('payments.total_label')} : {fmt(entry.totalOwed)}</p>
                            {entry.isSolde
                              ? <p className="text-xs text-green-600 font-semibold">{t('payments.paid_label')} : {fmt(entry.totalPaid)}</p>
                              : <p className="text-xs text-amber-600 font-semibold">{t('payments.remaining_label')} : {fmt(entry.totalRemaining)}</p>
                            }
                          </div>
                        </div>
                        <div className="mt-2.5">
                          <DebtGauge pct={pct} remaining={entry.isSolde ? undefined : entry.totalRemaining} fmt={fmt} t={t} />
                        </div>
                        <div className="flex items-center justify-between mt-1.5">
                          <p className="text-[11px] text-muted-foreground">{t('payments.orders_count', { count: entry.purchaseOrders.length })}</p>
                          <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                            {isExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                            {isExpanded ? t('payments.hide') : t('payments.view_orders')}
                          </div>
                        </div>
                      </button>

                      {isExpanded && (
                        <div className="border-t bg-muted/40 px-4 py-3 space-y-2">
                          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{t('suppliers.tab_purchase_orders')}</p>
                          {entry.purchaseOrders.map(po => (
                            <div key={po.id} className="bg-card rounded-lg border p-3 space-y-1">
                              <div className="flex items-center justify-between gap-2">
                                <span className="font-mono text-stockshop-blue dark:text-blue-400 font-semibold text-sm">{po.reference}</span>
                                <Badge variant={po.payment_status === 'paid' ? 'success' : po.payment_status === 'partial' ? 'warning' : 'destructive'} className="text-[10px]">
                                  {po.payment_status === 'paid' ? t('payments.solde_badge') : po.payment_status === 'partial' ? t('payments.partial_label') : t('payments.unpaid_label')}
                                </Badge>
                              </div>
                              <div className="flex items-center justify-between text-xs text-muted-foreground">
                                <span>{format(new Date(po.created_at), 'dd MMM yyyy', { locale: fr })}</span>
                                <span>{t('payments.total_label')} : {fmt(po.total_amount)}</span>
                              </div>
                              {po.amount_paid > 0 && (
                                <div className="flex items-center justify-between text-xs">
                                  <span className="text-green-600">{t('payments.paid_label')} : {fmt(po.amount_paid)}</span>
                                  {po.balance > 0 && <span className="font-bold text-amber-600">{t('payments.remaining_label')} : {fmt(po.balance)}</span>}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                )
              })}
            </div>
          )}
        </div>
      )}
      </>
      )}

      {/* ── Repayment Dialog ── */}
      <PremiumDialog
        open={!!repayDebtor || !!receiptResult}
        onOpenChange={open => { if (!open) { setRepayDebtor(null); setReceiptResult(null) } }}
        category={t('nav.payments')}
        title={receiptResult ? t('toast.payment_recorded') : t('payments.record_repayment_title')}
        icon={receiptResult ? <CheckCircle2 className="h-4 w-4" /> : <Banknote className="h-4 w-4" />}
      >
        {/* ── Receipt screen ── */}
        {receiptResult ? (
          <PremiumDialogBody>
            <div className="space-y-4">
              <div className="flex flex-col items-center gap-2 py-2">
                <div className="h-14 w-14 rounded-full bg-green-100 flex items-center justify-center">
                  <CheckCircle2 className="h-7 w-7 text-green-600" />
                </div>
                <p className="font-semibold text-base">{receiptResult.customerName}</p>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Button variant="outline" className="gap-2 h-11" onClick={() => printPDFNative(receiptResult.blob, receiptResult.fileName)}>
                  {isCapacitor() ? <Share2 className="h-4 w-4" /> : <Printer className="h-4 w-4" />}
                  {isCapacitor() ? t('actions.share') : t('actions.print_receipt')}
                </Button>
                <Button className="gap-2 h-11 bg-green-600 hover:bg-green-700" onClick={() => sharePDFNative(receiptResult.blob, receiptResult.fileName, `Reçu — ${receiptResult.customerName}`)}>
                  <Share2 className="h-4 w-4" />WhatsApp
                </Button>
              </div>
              {receiptResult.phone && (
                <a href={`https://wa.me/${receiptResult.phone.replace(/[^\d]/g, '').replace(/^0/, '234')}?text=${encodeURIComponent(`Bonjour ${receiptResult.customerName}, votre paiement a bien été enregistré. Merci !`)}`}
                  target="_blank" rel="noreferrer" className="block">
                  <Button variant="outline" className="w-full gap-2 border-green-300 text-green-700 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-950/30">
                    💬 {t('payments.open_whatsapp_chat')}
                  </Button>
                </a>
              )}
              <Button variant="stockshop" className="w-full h-11 rounded-xl font-semibold"
                onClick={() => { setRepayDebtor(null); setReceiptResult(null) }}>
                {t('actions.close')}
              </Button>
            </div>
          </PremiumDialogBody>
        ) : (
          <>
            <PremiumDialogBody>
              {repayDebtor && (
                <div className="flex items-center gap-2 -mt-1 mb-1">
                  <User className="h-4 w-4 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">{repayDebtor.customer.name}</p>
                  <Badge variant="destructive" className="text-[10px]">{fmt(repayDebtor.totalDebt)}</Badge>
                </div>
              )}

              {repayDebtor && repayDebtor.unpaidSales.length === 0 ? (
                <div className="rounded-lg bg-orange-50 border border-orange-200 p-3">
                  <p className="text-xs font-semibold text-orange-700 uppercase tracking-wide mb-1">{t('payments.data_to_fix')}</p>
                  <p className="text-sm text-orange-700">Le solde dû de {fmt(repayDebtor.totalDebt)} est enregistré mais aucune facture impayée n&apos;est trouvée.</p>
                </div>
              ) : null}

              {/* Amount input */}
              <div className="space-y-1">
                <Label>{t('payment.amount_given')}</Label>
                <div className="flex rounded-md border border-input overflow-hidden focus-within:ring-2 focus-within:ring-ring">
                  <span className="flex items-center px-3 bg-muted border-r text-sm font-medium text-muted-foreground whitespace-nowrap select-none">
                    {symbol}
                  </span>
                  <input type="text" inputMode="numeric"
                    value={formatInputValue(repayAmount, symbol)}
                    onChange={e => setRepayAmount(e.target.value.replace(/\D/g, ''))}
                    className="flex-1 h-12 px-3 text-lg font-bold bg-card outline-none" placeholder="0" autoFocus />
                </div>
              </div>

              {/* FIFO breakdown preview */}
              {repayDebtor && amount > 0 && fifoLines.length > 0 && (
                <div className="rounded-lg border bg-muted/30 overflow-hidden">
                  <div className="px-3 py-2 border-b bg-muted/60">
                    <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
                      {t('payments.payment_breakdown')} — FIFO
                    </p>
                  </div>
                  <div className="divide-y">
                    {fifoLines.map(({ sale, applying, fullyCovered }) => (
                      <div key={sale.id} className="flex items-center justify-between gap-2 px-3 py-2">
                        <div className="min-w-0">
                          <span className="font-mono text-xs font-semibold text-stockshop-blue dark:text-blue-400">#{sale.sale_number}</span>
                          <span className="text-[10px] text-muted-foreground ml-2">
                            {format(new Date(sale.created_at), 'dd/MM/yy')}
                          </span>
                          {fullyCovered && (
                            <Badge variant="success" className="ml-2 text-[9px] px-1 py-0">✓ {t('payments.paid_off')}</Badge>
                          )}
                        </div>
                        <div className="text-right flex-shrink-0">
                          <p className="text-xs font-bold text-green-600">+{fmt(applying)}</p>
                          {!fullyCovered && (
                            <p className="text-[10px] text-red-500">{t('payment.remaining')}: {fmt(sale.balance - applying)}</p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className={`flex items-center justify-between px-3 py-2 border-t ${remaining <= 0 ? 'bg-green-50 dark:bg-green-950/20' : 'bg-orange-50 dark:bg-orange-950/20'}`}>
                    <span className="text-xs font-semibold">
                      {remaining <= 0 ? `✓ ${t('payment.debt_settled')}` : t('payment.remaining')}
                    </span>
                    <span className={`text-sm font-bold ${remaining <= 0 ? 'text-green-600' : 'text-orange-600'}`}>
                      {remaining <= 0 ? t('payments.fully_settled') : fmt(remaining)}
                    </span>
                  </div>
                </div>
              )}

              {/* Payment method */}
              <div className="space-y-1">
                <Label>{t('payment.method')}</Label>
                <div className="grid grid-cols-3 gap-2.5">
                  {getCountry(shop?.country).paymentMethods
                    .filter(m => m.type !== 'credit')
                    .map(m => (
                      <button key={m.id} onClick={() => setRepayMethod(m.id)}
                        className={`relative rounded-2xl border-2 py-4 px-2 flex flex-col items-center gap-2 transition-all duration-200 active:scale-95 ${
                          repayMethod === m.id
                            ? 'border-blue-500 bg-gradient-to-b from-blue-50 to-blue-100/60 dark:from-blue-950/60 dark:to-blue-900/30 shadow-lg shadow-blue-200/60 dark:shadow-blue-900/40'
                            : 'border-input bg-card hover:border-blue-300 dark:hover:border-blue-700 hover:shadow-md hover:-translate-y-0.5'
                        }`}>
                        {repayMethod === m.id && (
                          <span className="absolute top-1.5 right-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-blue-500 text-white text-[9px] font-bold">✓</span>
                        )}
                        <div className={`rounded-xl p-2 transition-colors ${repayMethod === m.id ? 'bg-white dark:bg-white/15 shadow-sm' : 'bg-muted/40 dark:bg-white/5'}`}>
                          {m.logo
                            ? <img src={m.logo} alt={m.label} className="h-12 w-12 object-contain" />
                            : <span className="text-3xl leading-none block">{m.icon}</span>
                          }
                        </div>
                        <span className={`text-xs font-semibold text-center leading-tight ${repayMethod === m.id ? 'text-blue-600 dark:text-blue-400' : 'text-muted-foreground'}`}>
                          {m.label}
                        </span>
                      </button>
                    ))}
                </div>
              </div>

              {getMethodType(repayMethod, getCountry(shop?.country)) !== 'cash' && (
                <div className="space-y-1">
                  <Label>{t('payment.reference')}</Label>
                  <Input value={repayRef} onChange={e => setRepayRef(e.target.value)} placeholder={t('payment.reference_placeholder')} />
                </div>
              )}

              <div className="space-y-1">
                <Label>{t('sales.note_label')} <span className="text-muted-foreground font-normal">({t('form.optional')})</span></Label>
                <Input value={repayNotes} onChange={e => setRepayNotes(e.target.value)} placeholder={t('payment.notes_placeholder')} />
              </div>
            </PremiumDialogBody>
            <PremiumDialogFooter
              onCancel={() => setRepayDebtor(null)}
              cancelLabel={t('actions.cancel')}
              onConfirm={recordRepayment}
              confirmLabel={saving ? t('payment.saving') : `✓ ${t('payment.confirm_repayment')}`}
              confirmDisabled={saving || !repayDebtor || repayDebtor.unpaidSales.length === 0 || amount <= 0}
              confirmLoading={saving}
            />
          </>
        )}
      </PremiumDialog>

      {/* ── History Dialog ── */}
      <PremiumDialog
        open={!!historyDebtor}
        onOpenChange={open => { if (!open) { setHistoryDebtor(null); setHistorySales([]); setHistoryPayments([]) } }}
        category={t('nav.payments')}
        title={t('customers.payment_history')}
        icon={<History className="h-4 w-4" />}
        maxWidth="max-w-lg"
      >
        <div className="flex flex-col max-h-[65vh]">
          <div className="flex-1 overflow-y-auto">
            <PremiumDialogBody>
              {historyDebtor && (
                <p className="text-sm text-muted-foreground -mt-1 mb-1">{historyDebtor.customer.name}</p>
              )}
              {loadingHistory ? (
                <div className="space-y-2">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-20" />)}</div>
              ) : historySales.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
                  <Clock className="h-8 w-8 mb-2 opacity-30" />
                  <p className="text-sm">{t('payments.no_sales_for_customer')}</p>
                </div>
              ) : (
                <div className="space-y-3 pr-1">
              {historySales.map(sale => {
                const salePayments = historyPayments.filter(p => p.sale_id === sale.id)
                const isOpen = expandedSaleId === sale.id
                const statusVariant = STATUS_VARIANTS[sale.payment_status] || ('outline' as any)
                const statusLabel = sale.payment_status === 'paid' ? t('status.paid') : sale.payment_status === 'partial' ? t('status.partial') : t('status.pending')
                const paidPct = sale.total > 0 ? Math.min(100, (sale.amount_paid / sale.total) * 100) : 0
                return (
                  <div key={sale.id} className="border rounded-xl overflow-hidden">
                    <button
                      className="w-full flex items-start justify-between gap-2 p-3 bg-muted/40 hover:bg-accent transition-colors text-left"
                      onClick={() => setExpandedSaleId(isOpen ? null : sale.id)}
                    >
                      <div className="space-y-0.5 flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono text-sm font-bold text-stockshop-blue dark:text-blue-400">#{sale.sale_number}</span>
                          <Badge variant={statusVariant} className="text-[10px]">{statusLabel}</Badge>
                          <Badge variant="outline" className="text-[10px]">{t(`payment.${sale.payment_method}` as any) || sale.payment_method}</Badge>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {format(new Date(sale.created_at), "dd MMM yyyy 'à' HH:mm", { locale: fr })}
                          {sale.cashier_name && <> · par <strong>{sale.cashier_name}</strong></>}
                        </p>
                        <DebtGauge pct={paidPct} remaining={sale.balance > 0 ? sale.balance : undefined} fmt={fmt} t={t} />
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className="text-sm font-bold">{fmt(sale.total)}</p>
                        {sale.balance > 0
                          ? <p className="text-xs text-red-500">{t('payment.remaining')}: {fmt(sale.balance)}</p>
                          : <p className="text-xs text-green-600">{t('payments.paid_off')} ✓</p>
                        }
                      </div>
                    </button>

                    {isOpen && (
                      <div className="divide-y">
                        {sale.sale_items.length > 0 && (
                          <div className="px-3 py-2 bg-card space-y-0.5">
                            <p className="text-[10px] font-semibold text-muted-foreground uppercase mb-1">{t('sales.items')}</p>
                            {sale.sale_items.map((item, i) => (
                              <div key={i} className="flex justify-between text-[11px] text-muted-foreground">
                                <span>{item.product_name} × {item.quantity}</span>
                                <span>{fmt(item.subtotal)}</span>
                              </div>
                            ))}
                          </div>
                        )}
                        <div className="px-3 py-2 bg-card">
                          <p className="text-[10px] font-semibold text-muted-foreground uppercase mb-2">
                            {t('payments.payments_received')} ({salePayments.length})
                          </p>
                          {salePayments.length === 0 ? (
                            <p className="text-xs text-muted-foreground italic">{t('payments.no_payments_recorded')}</p>
                          ) : (
                            <div className="space-y-1.5">
                              {salePayments.map(p => (
                                <div key={p.id} className="flex items-start justify-between gap-2 rounded-lg bg-green-50 dark:bg-green-950/20 border border-green-100 dark:border-green-900 px-2.5 py-2">
                                  <div className="space-y-0.5">
                                    <div className="flex items-center gap-1.5 flex-wrap">
                                      <Badge variant="outline" className="text-[10px] px-1.5 bg-card">
                                        {t(`payment.${p.method}` as any) || p.method}
                                      </Badge>
                                      {p.received_by_name && (
                                        <span className="text-[11px] text-muted-foreground">par <strong>{p.received_by_name}</strong></span>
                                      )}
                                    </div>
                                    <p className="text-[11px] text-muted-foreground">
                                      {format(new Date(p.paid_at), "dd MMM yyyy 'à' HH:mm", { locale: fr })}
                                    </p>
                                    {p.reference && <p className="text-[11px] text-muted-foreground">{t('payments.ref_label')}: {p.reference}</p>}
                                    {p.notes && <p className="text-[11px] text-muted-foreground italic">{p.notes}</p>}
                                  </div>
                                  <span className="font-bold text-green-600 text-sm flex-shrink-0">+{fmt(p.amount)}</span>
                                </div>
                              ))}
                              <div className="flex justify-between text-xs pt-1 border-t">
                                <span className="text-muted-foreground">{t('payments.total_paid')}</span>
                                <span className="font-semibold text-green-600">{fmt(sale.amount_paid)}</span>
                              </div>
                              {sale.balance > 0 && (
                                <div className="flex justify-between text-xs">
                                  <span className="text-muted-foreground">{t('payments.remaining_due')}</span>
                                  <span className="font-semibold text-red-600">{fmt(sale.balance)}</span>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
                </div>
              )}
            </PremiumDialogBody>
          </div>
          <PremiumDialogFooter
            onCancel={() => { setHistoryDebtor(null); setHistorySales([]); setHistoryPayments([]) }}
            cancelLabel={t('actions.close')}
          />
        </div>
      </PremiumDialog>

      {/* ── Supplier Repayment Dialog ── */}
      <PremiumDialog
        open={!!repaySupplier}
        onOpenChange={open => { if (!open) setRepaySupplier(null) }}
        category={t('nav.payments')}
        title={t('payments.record_payment_title')}
        icon={<Banknote className="h-4 w-4" />}
      >
        <PremiumDialogBody>
          {repaySupplier && (
            <div className="flex items-center gap-2 -mt-1 mb-1">
              <Store className="h-4 w-4 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">{repaySupplier.supplier.name}</p>
              <Badge variant="warning" className="text-[10px]">{fmt(repaySupplier.totalOwed)}</Badge>
            </div>
          )}

          {/* Amount input */}
          <div className="space-y-1">
            <Label>{t('payment.amount_given')}</Label>
            <div className="flex rounded-md border border-input overflow-hidden focus-within:ring-2 focus-within:ring-ring">
              <span className="flex items-center px-3 bg-muted border-r text-sm font-medium text-muted-foreground whitespace-nowrap select-none">
                {symbol}
              </span>
              <input type="text" inputMode="numeric"
                value={formatInputValue(supplierRepayAmount, symbol)}
                onChange={e => setSupplierRepayAmount(e.target.value.replace(/\D/g, ''))}
                className="flex-1 h-12 px-3 text-lg font-bold bg-card outline-none" placeholder="0" autoFocus />
            </div>
          </div>

          {/* FIFO breakdown preview */}
          {repaySupplier && supplierAmount > 0 && supplierFifoLines.length > 0 && (
            <div className="rounded-lg border bg-muted/30 overflow-hidden">
              <div className="px-3 py-2 border-b bg-muted/60">
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
                  {t('payments.payment_breakdown')} — FIFO
                </p>
              </div>
              <div className="divide-y">
                {supplierFifoLines.map(({ po, applying, fullyCovered }) => (
                  <div key={po.id} className="flex items-center justify-between gap-2 px-3 py-2">
                    <div className="min-w-0">
                      <span className="font-mono text-xs font-semibold text-stockshop-blue dark:text-blue-400">{po.reference}</span>
                      <span className="text-[10px] text-muted-foreground ml-2">
                        {format(new Date(po.created_at), 'dd/MM/yy')}
                      </span>
                      {fullyCovered && (
                        <Badge variant="success" className="ml-2 text-[9px] px-1 py-0">✓ {t('payments.paid_off')}</Badge>
                      )}
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="text-xs font-bold text-green-600">+{fmt(applying)}</p>
                      {!fullyCovered && (
                        <p className="text-[10px] text-amber-600">{t('payment.remaining')}: {fmt(po.balance - applying)}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              <div className={`flex items-center justify-between px-3 py-2 border-t ${supplierRemaining <= 0 ? 'bg-green-50 dark:bg-green-950/20' : 'bg-orange-50 dark:bg-orange-950/20'}`}>
                <span className="text-xs font-semibold">
                  {supplierRemaining <= 0 ? `✓ ${t('payment.debt_settled')}` : t('payment.remaining')}
                </span>
                <span className={`text-sm font-bold ${supplierRemaining <= 0 ? 'text-green-600' : 'text-orange-600'}`}>
                  {supplierRemaining <= 0 ? t('payments.fully_settled') : fmt(supplierRemaining)}
                </span>
              </div>
            </div>
          )}

          {/* Payment method */}
          <div className="space-y-1">
            <Label>{t('payment.method')}</Label>
            <div className="grid grid-cols-3 gap-2.5">
              {getCountry(shop?.country).paymentMethods
                .filter(m => m.type !== 'credit')
                .map(m => (
                  <button key={m.id} onClick={() => setSupplierRepayMethod(m.id)}
                    className={`relative rounded-2xl border-2 py-4 px-2 flex flex-col items-center gap-2 transition-all duration-200 active:scale-95 ${
                      supplierRepayMethod === m.id
                        ? 'border-blue-500 bg-gradient-to-b from-blue-50 to-blue-100/60 dark:from-blue-950/60 dark:to-blue-900/30 shadow-lg shadow-blue-200/60 dark:shadow-blue-900/40'
                        : 'border-input bg-card hover:border-blue-300 dark:hover:border-blue-700 hover:shadow-md hover:-translate-y-0.5'
                    }`}>
                    {supplierRepayMethod === m.id && (
                      <span className="absolute top-1.5 right-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-blue-500 text-white text-[9px] font-bold">✓</span>
                    )}
                    <div className={`rounded-xl p-2 transition-colors ${supplierRepayMethod === m.id ? 'bg-white dark:bg-white/15 shadow-sm' : 'bg-muted/40 dark:bg-white/5'}`}>
                      {m.logo
                        ? <img src={m.logo} alt={m.label} className="h-12 w-12 object-contain" />
                        : <span className="text-3xl leading-none block">{m.icon}</span>
                      }
                    </div>
                    <span className={`text-xs font-semibold text-center leading-tight ${supplierRepayMethod === m.id ? 'text-blue-600 dark:text-blue-400' : 'text-muted-foreground'}`}>
                      {m.label}
                    </span>
                  </button>
                ))}
            </div>
          </div>

          {getMethodType(supplierRepayMethod, getCountry(shop?.country)) !== 'cash' && (
            <div className="space-y-1">
              <Label>{t('payment.reference')}</Label>
              <Input value={supplierRepayRef} onChange={e => setSupplierRepayRef(e.target.value)} placeholder={t('payment.reference_placeholder')} />
            </div>
          )}

          <div className="space-y-1">
            <Label>{t('sales.note_label')} <span className="text-muted-foreground font-normal">({t('form.optional')})</span></Label>
            <Input value={supplierRepayNotes} onChange={e => setSupplierRepayNotes(e.target.value)} placeholder={t('payment.notes_placeholder')} />
          </div>
        </PremiumDialogBody>
        <PremiumDialogFooter
          onCancel={() => setRepaySupplier(null)}
          cancelLabel={t('actions.cancel')}
          onConfirm={recordSupplierPayment}
          confirmLabel={savingSupplierPayment ? t('payment.saving') : `✓ ${t('payment.confirm_repayment')}`}
          confirmDisabled={savingSupplierPayment || !repaySupplier || supplierAmount <= 0}
          confirmLoading={savingSupplierPayment}
        />
      </PremiumDialog>

      {/* ── Supplier History Dialog ── */}
      <PremiumDialog
        open={!!historySupplier}
        onOpenChange={open => { if (!open) { setHistorySupplier(null); setHistoryPOs([]); setHistorySupplierPayments([]) } }}
        category={t('nav.payments')}
        title={t('payments.payment_history_title')}
        icon={<History className="h-4 w-4" />}
        maxWidth="max-w-lg"
      >
        <div className="flex flex-col max-h-[65vh]">
          <div className="flex-1 overflow-y-auto">
            <PremiumDialogBody>
              {historySupplier && (
                <p className="text-sm text-muted-foreground -mt-1 mb-1">{historySupplier.supplier.name}</p>
              )}
              {loadingSupplierHistory ? (
                <div className="space-y-2">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-20" />)}</div>
              ) : historyPOs.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
                  <Clock className="h-8 w-8 mb-2 opacity-30" />
                  <p className="text-sm">{t('payments.no_orders_for_supplier')}</p>
                </div>
              ) : (
                <div className="space-y-3 pr-1">
                  {historyPOs.map(po => {
                    const poPayments = historySupplierPayments.filter(p => p.purchase_order_id === po.id)
                    const isOpen = expandedPoId === po.id
                    const statusLabel = po.payment_status === 'paid' ? t('payments.solde_badge') : po.payment_status === 'partial' ? t('payments.partial_label') : t('payments.unpaid_label')
                    const statusVariant = po.payment_status === 'paid' ? 'success' : po.payment_status === 'partial' ? 'warning' : 'destructive'
                    const paidPct = po.total_amount > 0 ? Math.min(100, (po.amount_paid / po.total_amount) * 100) : 0
                    return (
                      <div key={po.id} className="border rounded-xl overflow-hidden">
                        <button
                          className="w-full flex items-start justify-between gap-2 p-3 bg-muted/40 hover:bg-accent transition-colors text-left"
                          onClick={() => setExpandedPoId(isOpen ? null : po.id)}
                        >
                          <div className="space-y-0.5 flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-mono text-sm font-bold text-stockshop-blue dark:text-blue-400">{po.reference}</span>
                              <Badge variant={statusVariant as any} className="text-[10px]">{statusLabel}</Badge>
                            </div>
                            <p className="text-xs text-muted-foreground">
                              {format(new Date(po.created_at), "dd MMM yyyy", { locale: fr })}
                            </p>
                            <DebtGauge pct={paidPct} remaining={po.balance > 0 ? po.balance : undefined} fmt={fmt} t={t} />
                          </div>
                          <div className="text-right flex-shrink-0">
                            <p className="text-sm font-bold">{fmt(po.total_amount)}</p>
                            {po.balance > 0
                              ? <p className="text-xs text-amber-600">{t('payment.remaining')}: {fmt(po.balance)}</p>
                              : <p className="text-xs text-green-600">{t('payments.paid_off')} ✓</p>
                            }
                          </div>
                        </button>

                        {isOpen && (
                          <div className="divide-y">
                            {po.purchase_order_items && po.purchase_order_items.length > 0 && (
                              <div className="px-3 py-2 bg-card space-y-0.5">
                                <p className="text-[10px] font-semibold text-muted-foreground uppercase mb-1">{t('sales.items')}</p>
                                {po.purchase_order_items.map((item, i) => (
                                  <div key={i} className="flex justify-between text-[11px] text-muted-foreground">
                                    <span>{item.product_name} × {item.quantity_received ?? item.quantity_ordered}</span>
                                    <span>{fmt((item.unit_price || 0) * (item.quantity_received ?? item.quantity_ordered))}</span>
                                  </div>
                                ))}
                              </div>
                            )}
                            <div className="px-3 py-2 bg-card">
                              <p className="text-[10px] font-semibold text-muted-foreground uppercase mb-2">
                                {t('payments.payments_received')} ({poPayments.length})
                              </p>
                              {poPayments.length === 0 ? (
                                <p className="text-xs text-muted-foreground italic">{t('payments.no_payments_recorded')}</p>
                              ) : (
                                <div className="space-y-1.5">
                                  {poPayments.map(p => (
                                    <div key={p.id} className="flex items-start justify-between gap-2 rounded-lg bg-green-50 dark:bg-green-950/20 border border-green-100 dark:border-green-900 px-2.5 py-2">
                                      <div className="space-y-0.5">
                                        <div className="flex items-center gap-1.5 flex-wrap">
                                          <Badge variant="outline" className="text-[10px] px-1.5 bg-card">
                                            {t(`payment.${p.method}` as any) || p.method}
                                          </Badge>
                                          {p.paid_by_name && (
                                            <span className="text-[11px] text-muted-foreground">par <strong>{p.paid_by_name}</strong></span>
                                          )}
                                        </div>
                                        <p className="text-[11px] text-muted-foreground">
                                          {format(new Date(p.paid_at), "dd MMM yyyy 'à' HH:mm", { locale: fr })}
                                        </p>
                                        {p.reference && <p className="text-[11px] text-muted-foreground">{t('payments.ref_label')}: {p.reference}</p>}
                                        {p.notes && <p className="text-[11px] text-muted-foreground italic">{p.notes}</p>}
                                      </div>
                                      <span className="font-bold text-green-600 text-sm flex-shrink-0">+{fmt(p.amount)}</span>
                                    </div>
                                  ))}
                                  <div className="flex justify-between text-xs pt-1 border-t">
                                    <span className="text-muted-foreground">{t('payments.total_paid')}</span>
                                    <span className="font-semibold text-green-600">{fmt(po.amount_paid)}</span>
                                  </div>
                                  {po.balance > 0 && (
                                    <div className="flex justify-between text-xs">
                                      <span className="text-muted-foreground">{t('payments.remaining_due')}</span>
                                      <span className="font-semibold text-amber-600">{fmt(po.balance)}</span>
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </PremiumDialogBody>
          </div>
          <PremiumDialogFooter
            onCancel={() => { setHistorySupplier(null); setHistoryPOs([]); setHistorySupplierPayments([]) }}
            cancelLabel={t('actions.close')}
          />
        </div>
      </PremiumDialog>
    </div>
  )
}

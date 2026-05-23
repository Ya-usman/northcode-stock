'use client'

import { useState, useEffect, useRef, useMemo } from 'react'
import { useTranslations } from 'next-intl'
import { useAuthContext as useAuth } from '@/lib/contexts/auth-context'
import { generateDebtReceiptPDFBlob } from '@/lib/utils/pdf'
import { sharePDFNative, printPDFNative, isCapacitor } from '@/lib/utils/native-share'
import { useToast } from '@/components/ui/use-toast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { PremiumDialog, PremiumDialogBody, PremiumDialogFooter } from '@/components/ui/premium-dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { useCurrency } from '@/lib/hooks/use-currency'
import type { Customer } from '@/lib/types/database'
import {
  ChevronDown, ChevronUp, Clock, CheckCircle2,
  History, User, RefreshCw, Banknote, Store,
  Printer, Share2, Search,
} from 'lucide-react'
import { DebtGauge } from '@/components/dashboard/recent-sales-feed'
import { getCountry, getMethodType } from '@/lib/saas/countries'
import { formatInputValue } from '@/lib/utils/currency'
import { format } from 'date-fns'
import { fr } from 'date-fns/locale'
import { setPageCache, getPageCache } from '@/lib/offline/page-cache'

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
            <Button size="sm" className="flex-1 h-9 text-xs bg-stockshop-blue hover:bg-stockshop-blue-light gap-1"
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

export default function DettesPage() {
  const t = useTranslations()
  const { shop, profile, effectiveShopIds, userShops } = useAuth()
  const isMultiShop = effectiveShopIds.length > 1
  const { fmt, symbol } = useCurrency()
  const { toast } = useToast()

  const [debtors, setDebtors] = useState<CustomerDebt[]>([])
  const [loading, setLoading] = useState(true)
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

  // ── Fetch ────────────────────────────────────────────────
  const fetchDebtors = async (quiet = false) => {
    if (!effectiveShopIds.length) return
    const cacheKey = `debtors_${effectiveShopIds.join(',')}`
    if (!quiet) {
      const cached = getPageCache<any[]>(cacheKey)
      if (cached) { setDebtors(cached); setLoading(false); setRefreshing(true) }
      else setLoading(true)
    } else {
      setRefreshing(true)
    }
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

  const totalOutstanding = debtors.reduce((s, d) => s + d.totalDebt, 0)

  const filteredDebtors = useMemo(() => {
    if (!search.trim()) return debtors
    const q = search.toLowerCase()
    return debtors.filter(d =>
      d.customer.name.toLowerCase().includes(q) ||
      d.customer.phone?.includes(q) ||
      d.customer.city?.toLowerCase().includes(q)
    )
  }, [debtors, search])

  // ── FIFO preview ─────────────────────────────────────────
  const amount = Number(repayAmount) || 0
  const fifoLines = useMemo(
    () => repayDebtor ? calcFifo(amount, repayDebtor.unpaidSales) : [],
    [amount, repayDebtor]
  )
  const remaining = repayDebtor ? Math.max(0, repayDebtor.totalDebt - amount) : 0

  // ── Open repay dialog ────────────────────────────────────
  const openRepayDialog = (debtor: CustomerDebt) => {
    setHistoryDebtor(null)
    setRepayDebtor(debtor)
    setRepayAmount(String(Math.round(debtor.totalDebt)))
    setRepayMethod('cash')
    setRepayRef('')
    setRepayNotes('')
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
      const res = await fetch('/api/payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          unpaid_sale_ids: repayDebtor.unpaidSales.map(s => s.id),
          amount,
          method: repayMethod,
          reference: repayRef || null,
          notes: repayNotes || null,
          shop_id: shop!.id,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
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

  // ── Render ───────────────────────────────────────────────
  return (
    <div className="space-y-4">

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
              <Button className="w-full h-11 rounded-xl font-semibold bg-stockshop-blue hover:bg-stockshop-blue-light"
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
                  <p className="text-sm text-orange-700">La dette de {fmt(repayDebtor.totalDebt)} est enregistrée mais aucune facture impayée n&apos;est trouvée.</p>
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
                <div className="grid grid-cols-2 gap-2">
                  {getCountry(shop?.country).paymentMethods
                    .filter(m => m.type !== 'credit')
                    .map(m => (
                      <button key={m.id} onClick={() => setRepayMethod(m.id)}
                        className={`rounded-lg border p-2.5 text-sm font-medium transition-colors ${
                          repayMethod === m.id
                            ? 'border-blue-500 bg-stockshop-blue-muted dark:bg-blue-950/40 text-stockshop-blue dark:text-blue-400'
                            : 'border-input bg-card text-muted-foreground hover:bg-muted'
                        }`}>
                        {m.icon} {m.label}
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
    </div>
  )
}

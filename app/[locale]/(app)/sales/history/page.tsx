'use client'

import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import {
  Search, FileDown, ChevronDown, ChevronUp,
  XCircle, CheckCircle2, Store, Printer,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useAuthContext as useAuth } from '@/lib/contexts/auth-context'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Skeleton } from '@/components/ui/skeleton'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { useToast } from '@/components/ui/use-toast'
import { useCurrency } from '@/lib/hooks/use-currency'
import { generateReceiptPDF } from '@/lib/utils/pdf'
import { format, startOfDay, endOfDay, subDays, startOfWeek, startOfMonth } from 'date-fns'
import type { Sale } from '@/lib/types/database'

const supabase = createClient() as any

const statusVariant: Record<string, any> = {
  paid: 'success', partial: 'warning', pending: 'danger',
}

type DialogType = 'cancel' | 'validate'

export default function SalesHistoryPage() {
  const t = useTranslations()
  const { profile, shop, userShops } = useAuth()

  const printSale = (sale: Sale) => {
    if (!shop) return
    generateReceiptPDF({
      sale: sale as any,
      shop,
      cashierName: cashierMap[(sale as any).cashier_id] || t('sales.cashier'),
      customerName: (sale as any).customers?.name || undefined,
    })
  }
  const { fmt: formatNaira } = useCurrency()
  const { toast } = useToast()

  const [sales, setSales] = useState<Sale[]>([])
  const [cashierMap, setCashierMap] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [dateFilter, setDateFilter] = useState('today')
  const [methodFilter, setMethodFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [saleStatusFilter, setSaleStatusFilter] = useState<'all' | 'active' | 'cancelled'>('all')
  const [expandedId, setExpandedId] = useState<string | null>(null)

  // Multi-shop filter for owners
  const [selectedShopId, setSelectedShopId] = useState<string | null>(null)
  const shopId = selectedShopId || shop?.id

  // Dialog state
  const [dialog, setDialog] = useState<{ type: DialogType; sale: Sale } | null>(null)
  const [cancelReason, setCancelReason] = useState('')
  const [validateAmount, setValidateAmount] = useState('')
  const [validateMethod, setValidateMethod] = useState('cash')
  const [actionLoading, setActionLoading] = useState(false)

  const isOwner = profile?.role === 'owner' || profile?.role === 'super_admin'
  const isCashier = profile?.role === 'cashier'

  const fetchSales = async () => {
    if (!shopId) return
    setLoading(true)

    const now = new Date()
    let start: Date, end: Date = endOfDay(now)
    switch (dateFilter) {
      case 'today': start = startOfDay(now); break
      case 'week': start = startOfWeek(now); break
      case 'month': start = startOfMonth(now); break
      default: start = subDays(now, 30)
    }

    let query = supabase
      .from('sales')
      .select('*, customers(name, phone), sale_items(product_name, quantity, unit_price, subtotal)')
      .eq('shop_id', shopId)
      .gte('created_at', start.toISOString())
      .lte('created_at', end.toISOString())
      .order('created_at', { ascending: false })

    if (isCashier) query = query.eq('cashier_id', profile!.id)
    if (methodFilter !== 'all') query = query.eq('payment_method', methodFilter)
    if (statusFilter !== 'all') query = query.eq('payment_status', statusFilter)
    if (saleStatusFilter !== 'all') query = query.eq('sale_status', saleStatusFilter)

    const { data } = await query
    const salesData = (data || []) as Sale[]
    setSales(salesData)

    // Fetch cashier names
    const ids = Array.from(new Set(salesData.map((s: any) => s.cashier_id).filter(Boolean))) as string[]
    if (ids.length > 0) {
      const { data: profiles } = await supabase.from('profiles').select('id, full_name').in('id', ids)
      const map: Record<string, string> = {}
      for (const p of (profiles || [])) map[p.id] = p.full_name
      setCashierMap(map)
    } else {
      setCashierMap({})
    }
    setLoading(false)
  }

  useEffect(() => { fetchSales() }, [shopId, dateFilter, methodFilter, statusFilter, saleStatusFilter])

  // Refresh when tab regains focus (e.g. after recording a payment on the debts page)
  useEffect(() => {
    const onFocus = () => { if (document.visibilityState === 'visible') fetchSales() }
    document.addEventListener('visibilitychange', onFocus)
    return () => document.removeEventListener('visibilitychange', onFocus)
  }, [shopId, dateFilter, methodFilter, statusFilter, saleStatusFilter])

  const filtered = sales.filter(s => {
    if (!search) return true
    const q = search.toLowerCase()
    return (
      s.sale_number?.toLowerCase().includes(q) ||
      (s as any).customers?.name?.toLowerCase().includes(q)
    )
  })

  const exportCSV = () => {
    const rows = [
      [t('sales.sale_number'), t('sales.date'), t('sales.customer'), t('sales.total'), t('payment.amount_paid'), t('payment.balance'), t('payment.method'), t('status.paid'), t('status.active')],
      ...filtered.map(s => [
        s.sale_number,
        format(new Date(s.created_at), 'dd/MM/yyyy HH:mm'),
        (s as any).customers?.name || t('sales.walk_in'),
        s.total, s.amount_paid, s.balance,
        s.payment_method, s.payment_status,
        s.sale_status || 'active',
      ]),
    ]
    const csv = rows.map(r => r.join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `ventes-${dateFilter}-${Date.now()}.csv`; a.click()
  }

  const doAction = async () => {
    if (!dialog) return
    setActionLoading(true)
    try {
      if (dialog.type === 'cancel') {
        const res = await fetch('/api/sales/cancel', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sale_id: dialog.sale.id, reason: cancelReason }),
        })
        const json = await res.json()
        if (!res.ok) throw new Error(json.error)
        toast({ title: json.message, variant: 'success' })
      } else if (dialog.type === 'validate') {
        const res = await fetch('/api/sales/validate-payment', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sale_id: dialog.sale.id, amount: validateAmount, method: validateMethod }),
        })
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

  return (
    <div className="space-y-4">
      {/* Filters row */}
      <div className="flex flex-wrap gap-2">
        <div className="relative flex-1 min-w-[160px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input value={search} onChange={e => setSearch(e.target.value)} placeholder={t('sales.search_history')} className="pl-9 h-9" />
        </div>

        {/* Multi-shop selector for owners */}
        {isOwner && userShops.length > 1 && (
          <Select value={selectedShopId || 'current'} onValueChange={v => setSelectedShopId(v === 'current' ? null : v)}>
            <SelectTrigger className="w-[150px] h-9">
              <Store className="h-3.5 w-3.5 mr-1.5" />
              <SelectValue placeholder="Boutique" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="current">{t('dashboard.active_shop')}</SelectItem>
              {userShops.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
            </SelectContent>
          </Select>
        )}

        <Select value={dateFilter} onValueChange={setDateFilter}>
          <SelectTrigger className="w-[120px] h-9"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="today">{t('sales.filter_today')}</SelectItem>
            <SelectItem value="week">{t('sales.filter_week')}</SelectItem>
            <SelectItem value="month">{t('sales.filter_month')}</SelectItem>
            <SelectItem value="custom">{t('sales.filter_30days')}</SelectItem>
          </SelectContent>
        </Select>

        <Select value={methodFilter} onValueChange={setMethodFilter}>
          <SelectTrigger className="w-[120px] h-9"><SelectValue placeholder="Méthode" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('sales.all_methods')}</SelectItem>
            <SelectItem value="cash">{t('payment.cash')}</SelectItem>
            <SelectItem value="transfer">{t('payment.transfer')}</SelectItem>
            <SelectItem value="credit">{t('payment.credit')}</SelectItem>
            <SelectItem value="paystack">{t('payment.paystack')}</SelectItem>
          </SelectContent>
        </Select>

        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[110px] h-9"><SelectValue placeholder="Statut" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('sales.all_statuses')}</SelectItem>
            <SelectItem value="paid">{t('status.paid')}</SelectItem>
            <SelectItem value="partial">{t('status.partial')}</SelectItem>
            <SelectItem value="pending">{t('status.pending')}</SelectItem>
          </SelectContent>
        </Select>

        <Select value={saleStatusFilter} onValueChange={v => setSaleStatusFilter(v as any)}>
          <SelectTrigger className="w-[110px] h-9"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('sales.filter_all')}</SelectItem>
            <SelectItem value="active">{t('sales.filter_active')}</SelectItem>
            <SelectItem value="cancelled">{t('sales.filter_cancelled')}</SelectItem>
          </SelectContent>
        </Select>

        {isOwner && (
          <Button variant="outline" size="sm" onClick={exportCSV} className="h-9 gap-1">
            <FileDown className="h-3.5 w-3.5" /> CSV
          </Button>
        )}
      </div>

      {/* Summary */}
      {isOwner && (
        <div className="flex gap-4 text-sm flex-wrap">
          <span className="text-muted-foreground">
            {filtered.filter(s => (s.sale_status || 'active') === 'active').length} {t('sales.sales_count_label')} ·{' '}
            <span className="font-semibold text-foreground">
              {formatNaira(filtered.filter(s => (s.sale_status || 'active') === 'active').reduce((s, sale) => s + Number(sale.total), 0))}
            </span>
          </span>
          <span className="text-red-500">
            {t('sales.balance_summary')}: {formatNaira(filtered.filter(s => (s.sale_status || 'active') === 'active').reduce((s, sale) => s + Number(sale.balance), 0))}
          </span>
        </div>
      )}

      {/* Table */}
      <div className="rounded-lg border bg-card shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-4 space-y-2">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
        ) : filtered.length === 0 ? (
          <div className="flex h-32 items-center justify-center text-muted-foreground text-sm">
            {t('sales.no_sales')}
          </div>
        ) : (
          <Table>
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
            <TableBody>
              {filtered.map(sale => {
                const isCancelled = sale.sale_status === 'cancelled'
                const isPending = sale.payment_status === 'pending' || sale.payment_status === 'partial'
                const canCancelThis = !isCancelled && (
                  isOwner ||
                  (isCashier && sale.cashier_id === profile?.id && new Date(sale.created_at) >= startOfDay(new Date()))
                )

                return (
                  <>
                    <TableRow
                      key={sale.id}
                      className={`cursor-pointer ${isCancelled ? 'opacity-50 bg-red-50/30 dark:bg-red-950/20' : 'hover:bg-muted/30'}`}
                      onClick={() => setExpandedId(expandedId === sale.id ? null : sale.id)}
                    >
                      <TableCell className="font-mono text-xs font-medium text-blue-600 dark:text-blue-400">
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
                            {t(`payment.${sale.payment_method}` as any) || sale.payment_method}
                          </Badge>
                        </div>
                      </TableCell>
                      <TableCell>
                        {expandedId === sale.id ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                      </TableCell>
                    </TableRow>

                    {/* Expanded: items + action buttons */}
                    {expandedId === sale.id && (
                      <TableRow key={`${sale.id}-expand`}>
                        <TableCell colSpan={9} className="bg-muted/20 p-0">
                          <div className="p-3 space-y-2">
                            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{t('sales.items')}</p>
                            {(sale as any).sale_items?.map((item: any) => (
                              <div key={item.id} className="flex justify-between text-xs">
                                <span>{item.product_name} × {item.quantity} @ {formatNaira(item.unit_price)}</span>
                                <span className="font-medium">{formatNaira(item.subtotal)}</span>
                              </div>
                            ))}
                            {sale.notes && (
                              <p className="text-xs text-muted-foreground pt-2 border-t">{t('sales.note_label')}: {sale.notes}</p>
                            )}
                            {isCancelled && sale.cancel_reason && (
                              <p className="text-xs text-red-500 pt-2 border-t">{t('sales.cancel_reason_label')}: {sale.cancel_reason}</p>
                            )}

                            {/* Action buttons */}
                            <div className="flex flex-wrap gap-2 pt-2 border-t" onClick={e => e.stopPropagation()}>
                              {/* Validate payment */}
                              {!isCancelled && isPending && (isOwner || isCashier) && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="gap-1.5 text-xs h-7 border-green-300 text-green-600 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-950/40"
                                  onClick={() => { setDialog({ type: 'validate', sale }); setValidateAmount(String(sale.balance)) }}
                                >
                                  <CheckCircle2 className="h-3 w-3" /> {t('sales.validate_payment_action')}
                                </Button>
                              )}
                              {/* Cancel */}
                              {canCancelThis && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="gap-1.5 text-xs h-7 border-amber-300 text-amber-600 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-950/40"
                                  onClick={() => { setDialog({ type: 'cancel', sale }); setCancelReason('') }}
                                >
                                  <XCircle className="h-3 w-3" /> {t('actions.cancel')}
                                </Button>
                              )}
                              {/* Print receipt */}
                              {!isCancelled && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="gap-1.5 text-xs h-7"
                                  onClick={() => printSale(sale)}
                                >
                                  <Printer className="h-3 w-3" /> {t('actions.print')}
                                </Button>
                              )}
                            </div>
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </>
                )
              })}
            </TableBody>
          </Table>
        )}
      </div>

      {/* Action dialog */}
      <Dialog open={!!dialog} onOpenChange={open => !open && setDialog(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {dialog?.type === 'cancel' && `⚠️ ${t('sales.cancel_sale_dialog_title')}`}
              {dialog?.type === 'validate' && `✅ ${t('sales.validate_payment_dialog_title')}`}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-3">
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
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" size="sm" onClick={() => setDialog(null)}>{t('actions.cancel')}</Button>
            <Button
              size="sm"
              loading={actionLoading}
              onClick={doAction}
              className={
                dialog?.type === 'cancel' ? 'bg-amber-600 hover:bg-amber-700' :
                'bg-green-600 hover:bg-green-700'
              }
            >
              {dialog?.type === 'cancel' && t('actions.confirm')}
              {dialog?.type === 'validate' && t('sales.validate_payment_action')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

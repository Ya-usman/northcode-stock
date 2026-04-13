'use client'

import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import {
  Search, FileDown, ChevronDown, ChevronUp,
  XCircle, Trash2, CheckCircle2, Store,
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
import { format, startOfDay, endOfDay, subDays, startOfWeek, startOfMonth } from 'date-fns'
import type { Sale } from '@/lib/types/database'

const supabase = createClient() as any

const statusVariant: Record<string, any> = {
  paid: 'success', partial: 'warning', pending: 'danger',
}
const methodLabels: Record<string, string> = {
  cash: 'Cash', transfer: 'Virement', credit: 'Crédit', paystack: 'Paystack',
}

type DialogType = 'cancel' | 'delete' | 'validate'

export default function SalesHistoryPage() {
  const t = useTranslations()
  const { profile, shop, userShops } = useAuth()
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

  // can_delete_sales permission for current user
  const [canDelete, setCanDelete] = useState(false)

  const isOwner = profile?.role === 'owner' || profile?.role === 'super_admin'
  const isCashier = profile?.role === 'cashier'

  useEffect(() => {
    if (!shopId || !profile) return
    // Check can_delete_sales
    if (!isOwner) {
      supabase.from('shop_members')
        .select('can_delete_sales')
        .eq('shop_id', shopId)
        .eq('user_id', profile.id)
        .single()
        .then(({ data }: any) => setCanDelete(!!data?.can_delete_sales))
    } else {
      setCanDelete(true)
    }
  }, [shopId, profile?.id, isOwner])

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
      ['Vente #', 'Date', 'Client', 'Total', 'Payé', 'Solde', 'Méthode', 'Statut paiement', 'Statut vente'],
      ...filtered.map(s => [
        s.sale_number,
        format(new Date(s.created_at), 'dd/MM/yyyy HH:mm'),
        (s as any).customers?.name || 'Passant',
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
      } else if (dialog.type === 'delete') {
        const res = await fetch('/api/sales/delete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sale_id: dialog.sale.id }),
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
          <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Chercher vente # ou client…" className="pl-9 h-9" />
        </div>

        {/* Multi-shop selector for owners */}
        {isOwner && userShops.length > 1 && (
          <Select value={selectedShopId || 'current'} onValueChange={v => setSelectedShopId(v === 'current' ? null : v)}>
            <SelectTrigger className="w-[150px] h-9">
              <Store className="h-3.5 w-3.5 mr-1.5" />
              <SelectValue placeholder="Boutique" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="current">Boutique active</SelectItem>
              {userShops.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
            </SelectContent>
          </Select>
        )}

        <Select value={dateFilter} onValueChange={setDateFilter}>
          <SelectTrigger className="w-[120px] h-9"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="today">Aujourd'hui</SelectItem>
            <SelectItem value="week">Cette semaine</SelectItem>
            <SelectItem value="month">Ce mois</SelectItem>
            <SelectItem value="custom">30 derniers jours</SelectItem>
          </SelectContent>
        </Select>

        <Select value={methodFilter} onValueChange={setMethodFilter}>
          <SelectTrigger className="w-[120px] h-9"><SelectValue placeholder="Méthode" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Toutes méthodes</SelectItem>
            <SelectItem value="cash">Cash</SelectItem>
            <SelectItem value="transfer">Virement</SelectItem>
            <SelectItem value="credit">Crédit</SelectItem>
            <SelectItem value="paystack">Paystack</SelectItem>
          </SelectContent>
        </Select>

        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[110px] h-9"><SelectValue placeholder="Statut" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tous statuts</SelectItem>
            <SelectItem value="paid">Payé</SelectItem>
            <SelectItem value="partial">Partiel</SelectItem>
            <SelectItem value="pending">En attente</SelectItem>
          </SelectContent>
        </Select>

        <Select value={saleStatusFilter} onValueChange={v => setSaleStatusFilter(v as any)}>
          <SelectTrigger className="w-[110px] h-9"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Toutes ventes</SelectItem>
            <SelectItem value="active">Actives</SelectItem>
            <SelectItem value="cancelled">Annulées</SelectItem>
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
            {filtered.filter(s => (s.sale_status || 'active') === 'active').length} ventes ·{' '}
            <span className="font-semibold text-foreground">
              {formatNaira(filtered.filter(s => (s.sale_status || 'active') === 'active').reduce((s, sale) => s + Number(sale.total), 0))}
            </span>
          </span>
          <span className="text-red-500">
            Solde dû: {formatNaira(filtered.filter(s => (s.sale_status || 'active') === 'active').reduce((s, sale) => s + Number(sale.balance), 0))}
          </span>
        </div>
      )}

      {/* Table */}
      <div className="rounded-lg border bg-white shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-4 space-y-2">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
        ) : filtered.length === 0 ? (
          <div className="flex h-32 items-center justify-center text-muted-foreground text-sm">
            Aucune vente trouvée
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Vente #</TableHead>
                <TableHead>Client</TableHead>
                <TableHead className="hidden lg:table-cell">Caissier</TableHead>
                <TableHead className="hidden sm:table-cell">Date</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="hidden md:table-cell text-right">Payé</TableHead>
                <TableHead className="hidden md:table-cell text-right">Solde</TableHead>
                <TableHead>Statut</TableHead>
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
                const canDeleteThis = canDelete && !isCancelled

                return (
                  <>
                    <TableRow
                      key={sale.id}
                      className={`cursor-pointer ${isCancelled ? 'opacity-50 bg-red-50/30' : 'hover:bg-muted/30'}`}
                      onClick={() => setExpandedId(expandedId === sale.id ? null : sale.id)}
                    >
                      <TableCell className="font-mono text-xs font-medium text-northcode-blue">
                        #{sale.sale_number}
                        {isCancelled && (
                          <span className="ml-1.5 text-[10px] font-semibold text-red-500 bg-red-50 border border-red-200 rounded px-1">ANNULÉ</span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm">{(sale as any).customers?.name || 'Passant'}</TableCell>
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
                            {methodLabels[sale.payment_method] || sale.payment_method}
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
                            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Articles</p>
                            {(sale as any).sale_items?.map((item: any) => (
                              <div key={item.id} className="flex justify-between text-xs">
                                <span>{item.product_name} × {item.quantity} @ {formatNaira(item.unit_price)}</span>
                                <span className="font-medium">{formatNaira(item.subtotal)}</span>
                              </div>
                            ))}
                            {sale.notes && (
                              <p className="text-xs text-muted-foreground pt-2 border-t">Note: {sale.notes}</p>
                            )}
                            {isCancelled && sale.cancel_reason && (
                              <p className="text-xs text-red-500 pt-2 border-t">Motif annulation: {sale.cancel_reason}</p>
                            )}

                            {/* Action buttons */}
                            <div className="flex flex-wrap gap-2 pt-2 border-t" onClick={e => e.stopPropagation()}>
                              {/* Validate payment */}
                              {!isCancelled && isPending && (isOwner || isCashier) && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="gap-1.5 text-xs h-7 border-green-300 text-green-700 hover:bg-green-50"
                                  onClick={() => { setDialog({ type: 'validate', sale }); setValidateAmount(String(sale.balance)) }}
                                >
                                  <CheckCircle2 className="h-3 w-3" /> Valider paiement
                                </Button>
                              )}
                              {/* Cancel */}
                              {canCancelThis && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="gap-1.5 text-xs h-7 border-amber-300 text-amber-700 hover:bg-amber-50"
                                  onClick={() => { setDialog({ type: 'cancel', sale }); setCancelReason('') }}
                                >
                                  <XCircle className="h-3 w-3" /> Annuler
                                </Button>
                              )}
                              {/* Delete */}
                              {canDeleteThis && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="gap-1.5 text-xs h-7 border-red-300 text-red-600 hover:bg-red-50"
                                  onClick={() => setDialog({ type: 'delete', sale })}
                                >
                                  <Trash2 className="h-3 w-3" /> Supprimer
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
              {dialog?.type === 'cancel' && '⚠️ Annuler la vente'}
              {dialog?.type === 'delete' && '🗑️ Supprimer définitivement'}
              {dialog?.type === 'validate' && '✅ Valider le paiement'}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-3">
            {dialog?.type === 'cancel' && (
              <>
                <p className="text-sm text-muted-foreground">
                  La vente <strong>#{dialog.sale.sale_number}</strong> sera marquée "Annulée" et le stock sera restauré.
                </p>
                <div className="space-y-1">
                  <Label className="text-xs">Motif (optionnel)</Label>
                  <Input
                    value={cancelReason}
                    onChange={e => setCancelReason(e.target.value)}
                    placeholder="Erreur de caisse, retour client…"
                    autoFocus
                  />
                </div>
              </>
            )}

            {dialog?.type === 'delete' && (
              <p className="text-sm text-muted-foreground">
                Supprimer définitivement la vente <strong>#{dialog.sale.sale_number}</strong> ?
                Cette action est <strong className="text-red-600">irréversible</strong>.
                Le stock sera restauré.
              </p>
            )}

            {dialog?.type === 'validate' && dialog.sale && (
              <>
                <p className="text-sm text-muted-foreground">
                  Solde restant: <strong>{formatNaira(dialog.sale.balance)}</strong>
                </p>
                <div className="space-y-1">
                  <Label className="text-xs">Montant reçu</Label>
                  <Input
                    type="number"
                    value={validateAmount}
                    onChange={e => setValidateAmount(e.target.value)}
                    autoFocus
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Méthode</Label>
                  <Select value={validateMethod} onValueChange={setValidateMethod}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="cash">Cash</SelectItem>
                      <SelectItem value="transfer">Virement</SelectItem>
                      <SelectItem value="paystack">Paystack</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </>
            )}
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" size="sm" onClick={() => setDialog(null)}>Annuler</Button>
            <Button
              size="sm"
              loading={actionLoading}
              onClick={doAction}
              className={
                dialog?.type === 'delete' ? 'bg-red-600 hover:bg-red-700' :
                dialog?.type === 'cancel' ? 'bg-amber-600 hover:bg-amber-700' :
                'bg-green-600 hover:bg-green-700'
              }
            >
              {dialog?.type === 'cancel' && 'Confirmer annulation'}
              {dialog?.type === 'delete' && 'Supprimer définitivement'}
              {dialog?.type === 'validate' && 'Valider paiement'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

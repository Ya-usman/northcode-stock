'use client'

import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { useAuthContext as useAuth } from '@/lib/contexts/auth-context'
import { useToast } from '@/components/ui/use-toast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { useCurrency } from '@/lib/hooks/use-currency'
import type { Customer } from '@/lib/types/database'
import {
  ChevronDown, ChevronUp, Clock, CheckCircle2,
  History, User, RefreshCw, Banknote,
} from 'lucide-react'
import { format } from 'date-fns'
import { fr } from 'date-fns/locale'

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

const METHOD_LABELS: Record<string, string> = {
  cash: 'Espèces',
  transfer: 'Virement',
  mobile_money: 'Mobile Money',
  paystack: 'Paystack',
  credit: 'Crédit',
}

const STATUS_LABELS: Record<string, { label: string; variant: 'destructive' | 'warning' | 'success' }> = {
  pending:  { label: 'Impayé',  variant: 'destructive' },
  partial:  { label: 'Partiel', variant: 'warning' },
  paid:     { label: 'Payé',    variant: 'success' },
}

export default function DettesPage() {
  const t = useTranslations()
  const { shop } = useAuth()
  const { fmt } = useCurrency()
  const { toast } = useToast()

  const [debtors, setDebtors] = useState<CustomerDebt[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  // ── Repayment dialog ────────────────────────────────────
  const [repayDebtor, setRepayDebtor] = useState<CustomerDebt | null>(null)
  const [repayAmount, setRepayAmount] = useState('')
  const [repayMethod, setRepayMethod] = useState('cash')
  const [repayRef, setRepayRef] = useState('')
  const [repayNotes, setRepayNotes] = useState('')
  const [saving, setSaving] = useState(false)

  // ── History dialog ──────────────────────────────────────
  const [historyDebtor, setHistoryDebtor] = useState<CustomerDebt | null>(null)
  const [historySales, setHistorySales] = useState<SaleRecord[]>([])
  const [historyPayments, setHistoryPayments] = useState<PaymentRecord[]>([])
  const [expandedSaleId, setExpandedSaleId] = useState<string | null>(null)
  const [loadingHistory, setLoadingHistory] = useState(false)

  // ── Fetch debtors ───────────────────────────────────────
  const fetchDebtors = async (quiet = false) => {
    if (!shop?.id) return
    if (!quiet) setLoading(true)
    else setRefreshing(true)
    try {
      const res = await fetch(`/api/payments/debts?shop_id=${shop.id}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setDebtors(data.debtors || [])
    } catch (e: any) {
      toast({ title: e.message, variant: 'destructive' })
      setDebtors([])
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  useEffect(() => { fetchDebtors() }, [shop?.id])

  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === 'visible') fetchDebtors(true) }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [shop?.id])

  const totalOutstanding = debtors.reduce((s, d) => s + d.totalDebt, 0)

  // ── Open repay dialog ───────────────────────────────────
  const openRepayDialog = (debtor: CustomerDebt) => {
    setRepayDebtor(debtor)
    setRepayAmount(String(Math.round(debtor.totalDebt)))
    setRepayMethod('cash')
    setRepayRef('')
    setRepayNotes('')
  }

  // ── Record repayment ────────────────────────────────────
  const recordRepayment = async () => {
    if (!repayDebtor || !repayAmount || Number(repayAmount) <= 0) {
      toast({ title: t('toast.payment_amount_required'), variant: 'destructive' })
      return
    }
    const amount = Number(repayAmount)
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
      setRepayDebtor(null)
      setRepayAmount('')
      setTimeout(() => fetchDebtors(true), 300)
    } catch (e: any) {
      toast({ title: e.message, variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  // ── Open history dialog ─────────────────────────────────
  const openHistory = async (debtor: CustomerDebt) => {
    setHistoryDebtor(debtor)
    setHistorySales([])
    setHistoryPayments([])
    setExpandedSaleId(null)
    setLoadingHistory(true)
    try {
      const res = await fetch(`/api/payments/history?shop_id=${shop!.id}&customer_id=${debtor.customer.id}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setHistorySales(data.sales || [])
      setHistoryPayments(data.payments || [])
    } catch (e: any) {
      toast({ title: e.message, variant: 'destructive' })
    } finally {
      setLoadingHistory(false)
    }
  }

  // ── Render ──────────────────────────────────────────────
  return (
    <div className="space-y-4">

      {/* Summary */}
      <Card className="border-0 shadow-sm bg-northcode-blue text-white">
        <CardContent className="p-4">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm opacity-80">Total des dettes en cours</p>
              <p className="text-3xl font-bold mt-1">{fmt(totalOutstanding)}</p>
              <p className="text-sm opacity-70 mt-1">
                {debtors.length} client{debtors.length !== 1 ? 's' : ''} avec dette en cours
              </p>
            </div>
            <button
              onClick={() => fetchDebtors(true)}
              className="p-2 rounded-full bg-white/20 hover:bg-white/30 transition-colors"
              disabled={refreshing}
            >
              <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </CardContent>
      </Card>

      {/* Debtors list */}
      {loading ? (
        <div className="space-y-3">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-28" />)}
        </div>
      ) : debtors.length === 0 ? (
        <div className="flex h-48 flex-col items-center justify-center text-muted-foreground">
          <CheckCircle2 className="h-12 w-12 mb-3 opacity-30" />
          <p className="font-medium">Aucune dette en cours</p>
          <p className="text-sm mt-1 opacity-70">Tous les clients sont à jour</p>
        </div>
      ) : (
        <div className="space-y-3">
          {debtors.map(({ customer, unpaidSales, totalDebt }) => {
            const isExpanded = expandedId === customer.id
            return (
              <Card key={customer.id} className="border-0 shadow-sm overflow-hidden">
                <CardContent className="p-0">
                  <div className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <div className="h-9 w-9 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0">
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
                        <p className="text-xs text-muted-foreground">
                          {unpaidSales.length} facture{unpaidSales.length !== 1 ? 's' : ''} impayée{unpaidSales.length !== 1 ? 's' : ''}
                        </p>
                      </div>
                    </div>
                    <div className="flex gap-2 mt-3">
                      <Button size="sm" className="flex-1 h-9 text-xs bg-northcode-blue hover:bg-northcode-blue-light gap-1"
                        onClick={() => openRepayDialog({ customer, unpaidSales, totalDebt })}>
                        <Banknote className="h-3.5 w-3.5" /> Rembourser
                      </Button>
                      <Button size="sm" variant="outline" className="flex-1 h-9 text-xs gap-1"
                        onClick={() => openHistory({ customer, unpaidSales, totalDebt })}>
                        <History className="h-3.5 w-3.5" /> Historique
                      </Button>
                      <Button size="sm" variant="ghost" className="h-9 w-9 p-0 flex-shrink-0"
                        onClick={() => setExpandedId(isExpanded ? null : customer.id)}>
                        {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                      </Button>
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="border-t bg-gray-50 px-4 py-3 space-y-2">
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Factures impayées</p>
                      {unpaidSales.map(sale => (
                        <div key={sale.id} className="bg-white rounded-lg border p-3 space-y-1">
                          <div className="flex items-center justify-between">
                            <span className="font-mono text-northcode-blue font-semibold text-sm">#{sale.sale_number}</span>
                            <Badge variant={sale.payment_status === 'partial' ? 'warning' : 'destructive'} className="text-[10px]">
                              {sale.payment_status === 'partial' ? 'Partiel' : 'Impayé'}
                            </Badge>
                          </div>
                          <div className="flex items-center justify-between text-xs text-muted-foreground">
                            <span>{format(new Date(sale.created_at), 'dd MMM yyyy', { locale: fr })}</span>
                            <span>Total: {fmt(sale.total)}</span>
                          </div>
                          {sale.amount_paid > 0 && (
                            <div className="flex items-center justify-between text-xs">
                              <span className="text-green-600">Déjà payé: {fmt(sale.amount_paid)}</span>
                              <span className="font-bold text-red-600">Reste: {fmt(sale.balance)}</span>
                            </div>
                          )}
                          {sale.amount_paid === 0 && (
                            <div className="flex justify-end">
                              <span className="text-xs font-bold text-red-600">Dû: {fmt(sale.balance)}</span>
                            </div>
                          )}
                          {sale.cashier_name && (
                            <p className="text-[11px] text-muted-foreground">Vente par : <strong>{sale.cashier_name}</strong></p>
                          )}
                          {sale.sale_items && sale.sale_items.length > 0 && (
                            <div className="pt-1 border-t space-y-0.5">
                              {sale.sale_items.map((item, idx) => (
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
          })}
        </div>
      )}

      {/* ── Repayment Dialog ── */}
      <Dialog open={!!repayDebtor} onOpenChange={open => !open && setRepayDebtor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Enregistrer un remboursement</DialogTitle>
            {repayDebtor && (
              <div className="flex items-center gap-2 mt-1">
                <User className="h-4 w-4 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">{repayDebtor.customer.name}</p>
                <Badge variant="destructive" className="text-[10px]">Dette: {fmt(repayDebtor.totalDebt)}</Badge>
              </div>
            )}
          </DialogHeader>

          <div className="space-y-4">
            {repayDebtor && repayDebtor.unpaidSales.length === 0 ? (
              <div className="rounded-lg bg-orange-50 border border-orange-200 p-3">
                <p className="text-xs font-semibold text-orange-700 uppercase tracking-wide mb-1">Données à corriger</p>
                <p className="text-sm text-orange-700">
                  La dette de {fmt(repayDebtor.totalDebt)} est enregistrée mais aucune facture impayée n&apos;est trouvée.
                  Contactez un administrateur pour corriger les données.
                </p>
              </div>
            ) : repayDebtor ? (
              <div className="rounded-lg bg-red-50 border border-red-200 p-3 space-y-1">
                <p className="text-xs font-semibold text-red-700 uppercase tracking-wide">Dette totale</p>
                <p className="text-2xl font-bold text-red-600">{fmt(repayDebtor.totalDebt)}</p>
                <p className="text-xs text-red-500">
                  {repayDebtor.unpaidSales.length} facture{repayDebtor.unpaidSales.length !== 1 ? 's' : ''} impayée{repayDebtor.unpaidSales.length !== 1 ? 's' : ''} — du plus ancien au plus récent
                </p>
              </div>
            ) : null}

            <div className="space-y-1">
              <Label>Montant donné par le client *</Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm font-medium">
                  {shop?.currency || '₦'}
                </span>
                <Input type="number" value={repayAmount} onChange={e => setRepayAmount(e.target.value)}
                  className="pl-8 h-12 text-lg font-bold" min={1} placeholder="0" autoFocus />
              </div>
              {repayDebtor && Number(repayAmount) > 0 && (
                <p className="text-xs text-muted-foreground">
                  Reste :{' '}
                  <strong className={Number(repayAmount) >= repayDebtor.totalDebt ? 'text-green-600' : 'text-orange-600'}>
                    {fmt(Math.max(0, repayDebtor.totalDebt - Number(repayAmount)))}
                  </strong>
                  {Number(repayAmount) >= repayDebtor.totalDebt && ' ✓ Dette soldée'}
                </p>
              )}
            </div>

            <div className="space-y-1">
              <Label>Mode de paiement</Label>
              <div className="grid grid-cols-2 gap-2">
                {(['cash', 'transfer', 'mobile_money', 'paystack'] as const).map(m => (
                  <button key={m} onClick={() => setRepayMethod(m)}
                    className={`rounded-lg border p-2.5 text-sm font-medium transition-colors ${
                      repayMethod === m
                        ? 'border-northcode-blue bg-northcode-blue-muted text-northcode-blue'
                        : 'border-input bg-white text-muted-foreground hover:bg-muted'
                    }`}>
                    {m === 'cash' ? '💵 Espèces' : m === 'transfer' ? '🏦 Virement' : m === 'mobile_money' ? '📱 Mobile Money' : '💳 Paystack'}
                  </button>
                ))}
              </div>
            </div>

            {repayMethod !== 'cash' && (
              <div className="space-y-1">
                <Label>Référence de paiement</Label>
                <Input value={repayRef} onChange={e => setRepayRef(e.target.value)} placeholder="Numéro de transaction…" />
              </div>
            )}

            <div className="space-y-1">
              <Label>Note <span className="text-muted-foreground font-normal">(optionnel)</span></Label>
              <Input value={repayNotes} onChange={e => setRepayNotes(e.target.value)} placeholder="Contexte, remarque…" />
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setRepayDebtor(null)}>Annuler</Button>
            <Button onClick={recordRepayment}
              disabled={saving || !repayDebtor || repayDebtor.unpaidSales.length === 0}
              className="bg-northcode-blue hover:bg-northcode-blue-light flex-1">
              {saving ? 'Enregistrement…' : '✓ Confirmer le remboursement'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── History Dialog ── */}
      <Dialog open={!!historyDebtor} onOpenChange={open => { if (!open) { setHistoryDebtor(null); setHistorySales([]); setHistoryPayments([]) } }}>
        <DialogContent className="max-w-lg max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Historique des paiements</DialogTitle>
            {historyDebtor && <p className="text-sm text-muted-foreground">{historyDebtor.customer.name}</p>}
          </DialogHeader>

          {loadingHistory ? (
            <div className="space-y-2">
              {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-20" />)}
            </div>
          ) : historySales.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
              <Clock className="h-8 w-8 mb-2 opacity-30" />
              <p className="text-sm">Aucune vente trouvée pour ce client</p>
            </div>
          ) : (
            <div className="space-y-3 overflow-y-auto flex-1 pr-1">
              {historySales.map(sale => {
                const salePayments = historyPayments.filter(p => p.sale_id === sale.id)
                const isOpen = expandedSaleId === sale.id
                const statusInfo = STATUS_LABELS[sale.payment_status] || { label: sale.payment_status, variant: 'outline' as any }
                return (
                  <div key={sale.id} className="border rounded-xl overflow-hidden">
                    {/* Sale header */}
                    <button
                      className="w-full flex items-start justify-between gap-2 p-3 bg-gray-50 hover:bg-gray-100 transition-colors text-left"
                      onClick={() => setExpandedSaleId(isOpen ? null : sale.id)}
                    >
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono text-sm font-bold text-northcode-blue">#{sale.sale_number}</span>
                          <Badge variant={statusInfo.variant} className="text-[10px]">{statusInfo.label}</Badge>
                          <Badge variant="outline" className="text-[10px]">{METHOD_LABELS[sale.payment_method] || sale.payment_method}</Badge>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {format(new Date(sale.created_at), 'dd MMM yyyy', { locale: fr })}
                          {sale.cashier_name && <> · par <strong>{sale.cashier_name}</strong></>}
                        </p>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className="text-sm font-bold">{fmt(sale.total)}</p>
                        {sale.balance > 0 && (
                          <p className="text-xs text-red-500">Reste: {fmt(sale.balance)}</p>
                        )}
                        {sale.balance <= 0 && (
                          <p className="text-xs text-green-600">Soldée ✓</p>
                        )}
                      </div>
                    </button>

                    {/* Payments on this sale */}
                    {isOpen && (
                      <div className="divide-y">
                        {/* Sale items */}
                        {sale.sale_items.length > 0 && (
                          <div className="px-3 py-2 bg-white space-y-0.5">
                            <p className="text-[10px] font-semibold text-muted-foreground uppercase mb-1">Articles</p>
                            {sale.sale_items.map((item, i) => (
                              <div key={i} className="flex justify-between text-[11px] text-muted-foreground">
                                <span>{item.product_name} × {item.quantity}</span>
                                <span>{fmt(item.subtotal)}</span>
                              </div>
                            ))}
                          </div>
                        )}

                        {/* Payment breakdown */}
                        <div className="px-3 py-2 bg-white">
                          <p className="text-[10px] font-semibold text-muted-foreground uppercase mb-2">
                            Paiements reçus ({salePayments.length})
                          </p>
                          {salePayments.length === 0 ? (
                            <p className="text-xs text-muted-foreground italic">Aucun paiement enregistré</p>
                          ) : (
                            <div className="space-y-1.5">
                              {salePayments.map(p => (
                                <div key={p.id} className="flex items-start justify-between gap-2 rounded-lg bg-green-50 border border-green-100 px-2.5 py-2">
                                  <div className="space-y-0.5">
                                    <div className="flex items-center gap-1.5 flex-wrap">
                                      <Badge variant="outline" className="text-[10px] px-1.5 bg-white">
                                        {METHOD_LABELS[p.method] || p.method}
                                      </Badge>
                                      {p.received_by_name && (
                                        <span className="text-[11px] text-muted-foreground">par <strong>{p.received_by_name}</strong></span>
                                      )}
                                    </div>
                                    <p className="text-[11px] text-muted-foreground">
                                      {format(new Date(p.paid_at), "dd MMM yyyy 'à' HH:mm", { locale: fr })}
                                    </p>
                                    {p.reference && <p className="text-[11px] text-muted-foreground">Réf: {p.reference}</p>}
                                    {p.notes && <p className="text-[11px] text-muted-foreground italic">{p.notes}</p>}
                                  </div>
                                  <span className="font-bold text-green-600 text-sm flex-shrink-0">+{fmt(p.amount)}</span>
                                </div>
                              ))}
                              {/* Running total */}
                              <div className="flex justify-between text-xs pt-1 border-t">
                                <span className="text-muted-foreground">Total payé</span>
                                <span className="font-semibold text-green-600">{fmt(sale.amount_paid)}</span>
                              </div>
                              {sale.balance > 0 && (
                                <div className="flex justify-between text-xs">
                                  <span className="text-muted-foreground">Reste dû</span>
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

          <DialogFooter className="pt-2">
            <Button variant="outline" className="w-full" onClick={() => { setHistoryDebtor(null); setHistorySales([]); setHistoryPayments([]) }}>
              Fermer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

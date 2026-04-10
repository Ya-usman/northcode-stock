'use client'

import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { CreditCard, Plus } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useAuthContext as useAuth } from '@/lib/contexts/auth-context'
import { useToast } from '@/components/ui/use-toast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { useCurrency } from '@/lib/hooks/use-currency'
import type { Customer, Sale } from '@/lib/types/database'

interface CustomerDebt {
  customer: Customer
  unpaidSales: Sale[]
  totalDebt: number
}

export default function PaymentsPage() {
  const t = useTranslations()
  const { shop, profile } = useAuth()
  const { fmt: formatNaira } = useCurrency()
  const supabase = createClient() as any
  const { toast } = useToast()

  const [debtors, setDebtors] = useState<CustomerDebt[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerDebt | null>(null)
  const [selectedSaleId, setSelectedSaleId] = useState('')
  const [paymentAmount, setPaymentAmount] = useState('')
  const [paymentMethod, setPaymentMethod] = useState('cash')
  const [paymentRef, setPaymentRef] = useState('')
  const [saving, setSaving] = useState(false)

  const fetchDebtors = async () => {
    if (!shop?.id) return
    const { data: customers } = await supabase
      .from('customers')
      .select('*')
      .eq('shop_id', shop.id)
      .gt('total_debt', 0)
      .order('total_debt', { ascending: false })

    if (!customers?.length) { setDebtors([]); setLoading(false); return }

    const debtorData: CustomerDebt[] = []
    for (const customer of customers) {
      const { data: sales } = await supabase
        .from('sales')
        .select('*, sale_items(product_name, quantity, subtotal)')
        .eq('customer_id', customer.id)
        .neq('payment_status', 'paid')
        .eq('sale_status', 'active')
        .order('created_at', { ascending: false })
      debtorData.push({
        customer,
        unpaidSales: (sales || []) as unknown as Sale[],
        totalDebt: Number(customer.total_debt),
      })
    }
    setDebtors(debtorData)
    setLoading(false)
  }

  useEffect(() => { fetchDebtors() }, [shop?.id])

  const totalOutstanding = debtors.reduce((s, d) => s + d.totalDebt, 0)

  const recordPayment = async () => {
    if (!selectedCustomer || !selectedSaleId || !paymentAmount) {
      toast({ title: 'Please fill all fields', variant: 'destructive' })
      return
    }
    setSaving(true)
    const { error } = await supabase.from('payments').insert({
      sale_id: selectedSaleId,
      amount: Number(paymentAmount),
      method: paymentMethod,
      reference: paymentRef || null,
      received_by: profile!.id,
    })
    setSaving(false)
    if (error) { toast({ title: error.message, variant: 'destructive' }); return }
    toast({ title: t('payments.payment_received'), variant: 'success' })
    setSelectedCustomer(null)
    setPaymentAmount('')
    setPaymentRef('')
    fetchDebtors()
  }

  return (
    <div className="space-y-4">
      {/* Summary */}
      <Card className="border-0 shadow-sm bg-northcode-blue text-white">
        <CardContent className="p-4">
          <p className="text-sm opacity-80">{t('payments.total_debt')}</p>
          <p className="text-3xl font-bold mt-1">{formatNaira(totalOutstanding)}</p>
          <p className="text-sm opacity-70 mt-1">{debtors.length} customer{debtors.length !== 1 ? 's' : ''} with outstanding debt</p>
        </CardContent>
      </Card>

      {/* Debtors list */}
      {loading ? (
        <div className="space-y-3">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-20" />)}</div>
      ) : debtors.length === 0 ? (
        <div className="flex h-48 flex-col items-center justify-center text-muted-foreground">
          <CreditCard className="h-12 w-12 mb-3 opacity-30" />
          <p>{t('payments.no_debts')}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {debtors.map(({ customer, unpaidSales, totalDebt }) => (
            <Card key={customer.id} className="border-0 shadow-sm">
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-semibold text-sm">{customer.name}</p>
                      {customer.phone && (
                        <span className="text-xs text-muted-foreground">{customer.phone}</span>
                      )}
                      {customer.city && (
                        <Badge variant="outline" className="text-[10px] px-1.5">{customer.city}</Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      {unpaidSales.length} unpaid invoice{unpaidSales.length !== 1 ? 's' : ''}
                    </p>
                    {/* Sale list */}
                    <div className="mt-2 space-y-1">
                      {unpaidSales.slice(0, 3).map(sale => (
                        <div key={sale.id} className="flex items-center gap-2 text-xs">
                          <span className="font-mono text-northcode-blue">#{sale.sale_number}</span>
                          <span className="text-muted-foreground">{formatNaira(sale.total)}</span>
                          <Badge variant="warning" className="text-[10px] px-1">
                            Due: {formatNaira(sale.balance)}
                          </Badge>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-lg font-bold text-red-600">{formatNaira(totalDebt)}</p>
                    <Button
                      size="sm"
                      className="mt-2 h-8 text-xs bg-northcode-blue hover:bg-northcode-blue-light"
                      onClick={() => {
                        setSelectedCustomer({ customer, unpaidSales, totalDebt })
                        setSelectedSaleId(unpaidSales[0]?.id || '')
                        setPaymentAmount(String(unpaidSales[0]?.balance || ''))
                      }}
                    >
                      <Plus className="h-3 w-3 mr-1" />
                      {t('payments.record_payment')}
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Record Payment Modal */}
      <Dialog open={!!selectedCustomer} onOpenChange={open => !open && setSelectedCustomer(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('payments.record_payment')} — {selectedCustomer?.customer.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1">
              <Label>Invoice</Label>
              <Select value={selectedSaleId} onValueChange={id => {
                setSelectedSaleId(id)
                const sale = selectedCustomer?.unpaidSales.find(s => s.id === id)
                if (sale) setPaymentAmount(String(sale.balance))
              }}>
                <SelectTrigger>
                  <SelectValue placeholder="Select invoice" />
                </SelectTrigger>
                <SelectContent>
                  {selectedCustomer?.unpaidSales.map(sale => (
                    <SelectItem key={sale.id} value={sale.id}>
                      #{sale.sale_number} — Due {formatNaira(sale.balance)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>{t('payment.amount')} *</Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-xs">{shop?.currency || '₦'}</span>
                <Input
                  type="number"
                  value={paymentAmount}
                  onChange={e => setPaymentAmount(e.target.value)}
                  className="pl-7"
                  min={1}
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label>{t('payment.method')}</Label>
              <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="cash">{t('payment.cash')}</SelectItem>
                  <SelectItem value="transfer">{t('payment.transfer')}</SelectItem>
                  <SelectItem value="paystack">Paystack</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {paymentMethod !== 'cash' && (
              <div className="space-y-1">
                <Label>{t('payment.reference')}</Label>
                <Input value={paymentRef} onChange={e => setPaymentRef(e.target.value)} placeholder="Reference number" />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSelectedCustomer(null)}>{t('actions.cancel')}</Button>
            <Button onClick={recordPayment} loading={saving} className="bg-northcode-blue">
              {t('actions.record_payment')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

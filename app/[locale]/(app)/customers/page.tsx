'use client'

import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { Search, Plus, Edit2, Trash2, Phone, MapPin } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useAuthContext as useAuth } from '@/lib/contexts/auth-context'
import { useToast } from '@/components/ui/use-toast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { useCurrency } from '@/lib/hooks/use-currency'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { customerSchema, type CustomerFormData } from '@/lib/validations/customer'
import type { Customer } from '@/lib/types/database'

export default function CustomersPage() {
  const t = useTranslations()
  const { profile, shop } = useAuth()
  const { fmt: formatNaira } = useCurrency()
  const supabase = createClient()
  const { toast } = useToast()

  const [customers, setCustomers] = useState<Customer[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null)
  const [saving, setSaving] = useState(false)

  const form = useForm<CustomerFormData>({ resolver: zodResolver(customerSchema) })

  const fetchCustomers = async () => {
    if (!shop?.id) return
    const { data } = await supabase
      .from('customers').select('*').eq('shop_id', shop.id).order('name')
    setCustomers((data || []) as Customer[])
    setLoading(false)
  }

  useEffect(() => { fetchCustomers() }, [shop?.id])

  const filtered = customers.filter(c => {
    if (!search) return true
    const q = search.toLowerCase()
    return c.name.toLowerCase().includes(q) || c.phone?.includes(q) || c.city?.toLowerCase().includes(q)
  })

  const onSubmit = async (data: CustomerFormData) => {
    setSaving(true)
    if (editingCustomer) {
      const { error } = await supabase.from('customers').update(data).eq('id', editingCustomer.id)
      if (error) { toast({ title: error.message, variant: 'destructive' }) }
      else { toast({ title: t('toast.customer_updated'), variant: 'success' }) }
    } else {
      const { error } = await supabase.from('customers').insert({ ...data, shop_id: shop!.id })
      if (error) { toast({ title: error.message, variant: 'destructive' }) }
      else { toast({ title: t('toast.customer_added'), variant: 'success' }) }
    }
    setSaving(false)
    setShowModal(false)
    setEditingCustomer(null)
    form.reset()
    fetchCustomers()
  }

  const deleteCustomer = async (c: Customer) => {
    if (c.total_debt > 0) {
      toast({ title: t('toast.customer_has_debt', { name: c.name, amount: formatNaira(c.total_debt) }), variant: 'destructive' })
      return
    }
    if (!confirm(t('confirm.delete_customer'))) return
    await supabase.from('customers').delete().eq('id', c.id)
    toast({ title: t('toast.customer_deleted') })
    fetchCustomers()
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input value={search} onChange={e => setSearch(e.target.value)} placeholder={t('actions.search')} className="pl-9 h-9" />
        </div>
        {(profile?.role === 'owner' || profile?.role === 'cashier') && (
          <Button
            className="h-9 gap-1 bg-blue-600 hover:bg-blue-700 dark:bg-blue-500"
            size="sm"
            onClick={() => { form.reset(); setEditingCustomer(null); setShowModal(true) }}
          >
            <Plus className="h-4 w-4" />
            {t('customers.add_customer')}
          </Button>
        )}
      </div>

      {loading ? (
        <div className="space-y-2">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-16" />)}</div>
      ) : filtered.length === 0 ? (
        <div className="flex h-32 items-center justify-center text-muted-foreground text-sm">
          {t('customers.no_customers')}
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(customer => (
            <div key={customer.id} className="rounded-lg border bg-card shadow-sm p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-semibold text-sm">{customer.name}</p>
                    {customer.total_debt > 0 && (
                      <Badge variant="danger" className="text-[10px]">
                        {t('customers.total_debt')}: {formatNaira(customer.total_debt)}
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-3 mt-1 flex-wrap">
                    {customer.phone && (
                      <span className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Phone className="h-3 w-3" />{customer.phone}
                      </span>
                    )}
                    {customer.city && (
                      <span className="flex items-center gap-1 text-xs text-muted-foreground">
                        <MapPin className="h-3 w-3" />{customer.city}
                      </span>
                    )}
                  </div>
                </div>
                {profile?.role === 'owner' && (
                  <div className="flex gap-1">
                    <Button
                      variant="ghost" size="sm" className="h-8 w-8 p-0"
                      onClick={() => {
                        setEditingCustomer(customer)
                        form.reset({ name: customer.name, phone: customer.phone || '', city: customer.city || '' })
                        setShowModal(true)
                      }}
                    >
                      <Edit2 className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost" size="sm"
                      className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
                      onClick={() => deleteCustomer(customer)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={showModal} onOpenChange={open => { if (!open) { setShowModal(false); setEditingCustomer(null) } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingCustomer ? t('actions.edit') : t('customers.add_customer')}</DialogTitle>
          </DialogHeader>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div className="space-y-1">
              <Label>{t('customers.name')} *</Label>
              <Input {...form.register('name')} placeholder={t('customers.name_placeholder')} />
              {form.formState.errors.name && <p className="text-xs text-destructive">{form.formState.errors.name.message}</p>}
            </div>
            <div className="space-y-1">
              <Label>{t('customers.phone')}</Label>
              <Input {...form.register('phone')} placeholder="08012345678" type="tel" />
              {form.formState.errors.phone && <p className="text-xs text-destructive">{form.formState.errors.phone.message}</p>}
            </div>
            <div className="space-y-1">
              <Label>{t('customers.city')}</Label>
              <Input {...form.register('city')} placeholder={t('customers.city_placeholder')} />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShowModal(false)}>{t('actions.cancel')}</Button>
              <Button type="submit" loading={saving} className="bg-blue-600 dark:bg-blue-500">{t('actions.save')}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
